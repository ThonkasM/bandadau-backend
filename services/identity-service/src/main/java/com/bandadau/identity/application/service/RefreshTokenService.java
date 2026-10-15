package com.bandadau.identity.application.service;

import com.bandadau.identity.application.AuthSettings;
import com.bandadau.identity.application.port.in.LogoutUseCase;
import com.bandadau.identity.application.port.in.RefreshTokenUseCase;
import com.bandadau.identity.application.port.in.Session;
import com.bandadau.identity.application.port.out.*;
import com.bandadau.identity.domain.exception.Errors;
import com.bandadau.identity.domain.model.RefreshToken;
import com.bandadau.identity.domain.model.User;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public final class RefreshTokenService implements RefreshTokenUseCase, LogoutUseCase {
    private static final Logger log = LoggerFactory.getLogger(RefreshTokenService.class);

    private final RefreshTokenRepositoryPort refreshTokens;
    private final UserRepositoryPort users;
    private final SessionIssuer sessions;
    private final SecretsPort secrets;
    private final ClockPort clock;
    private final TransactionPort tx;

    public RefreshTokenService(RefreshTokenRepositoryPort refreshTokens, UserRepositoryPort users,
                               TokenIssuerPort tokens, SecretsPort secrets, ClockPort clock, IdGeneratorPort ids,
                               TransactionPort tx, AuthSettings settings) {
        this.refreshTokens = refreshTokens;
        this.users = users;
        this.sessions = new SessionIssuer(refreshTokens, tokens, secrets, ids, settings);
        this.secrets = secrets;
        this.clock = clock;
        this.tx = tx;
    }

    @Override
    public Session refresh(String presented) {
        String hash = secrets.sha256Hex(presented);
        return tx.inTransaction(() -> rotate(hash)).orThrow();
    }

    private Attempt<Session> rotate(String hash) {
        Instant now = clock.now();
        Optional<RefreshToken> found = refreshTokens.findByHashForUpdate(hash);
        if (found.isEmpty()) return Attempt.fail(Errors.invalidRefreshToken());
        RefreshToken token = found.get();
        if (token.isReuse()) {
            refreshTokens.revokeFamily(token.familyId(), now);
            log.warn("event=auth.refresh.reuse_detected userId={} familyId={}", token.userId(), token.familyId());
            return Attempt.fail(Errors.refreshTokenReused());
        }
        if (token.isExpired(now)) return Attempt.fail(Errors.invalidRefreshToken());
        Optional<User> user = users.findById(token.userId());
        if (user.isEmpty() || !user.get().isActive()) {
            refreshTokens.revokeFamily(token.familyId(), now);
            return Attempt.fail(Errors.accountSuspendedOnRefresh());
        }
        if (!user.get().canAccess(token.client())) {
            refreshTokens.revokeFamily(token.familyId(), now);
            return Attempt.fail(Errors.invalidRefreshToken());
        }
        refreshTokens.markUsed(token.id(), now);
        return Attempt.ok(sessions.rotate(user.get(), token, now));
    }

    @Override
    public void logout(UUID userId, String presented) {
        String hash = secrets.sha256Hex(presented);
        tx.inTransaction(() -> {
            refreshTokens.findByHashForUpdate(hash)
                    .filter(t -> t.userId().equals(userId))
                    .ifPresent(t -> refreshTokens.revokeFamily(t.familyId(), clock.now()));
        });
    }
}
