package com.bandadau.identity.application.service;

import com.bandadau.identity.application.AuthSettings;
import com.bandadau.identity.application.port.in.CreateHandoffCodeUseCase;
import com.bandadau.identity.application.port.in.ExchangeHandoffCodeUseCase;
import com.bandadau.identity.application.port.in.Session;
import com.bandadau.identity.application.port.out.*;
import com.bandadau.identity.domain.exception.Errors;
import com.bandadau.identity.domain.model.HandoffCode;
import com.bandadau.identity.domain.model.TargetApp;
import com.bandadau.identity.domain.model.User;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public final class HandoffService implements CreateHandoffCodeUseCase, ExchangeHandoffCodeUseCase {
    private static final Logger log = LoggerFactory.getLogger(HandoffService.class);

    private final HandoffCodeRepositoryPort codes;
    private final UserRepositoryPort users;
    private final SessionIssuer sessions;
    private final SecretsPort secrets;
    private final ClockPort clock;
    private final TransactionPort tx;
    private final AuthSettings settings;

    public HandoffService(HandoffCodeRepositoryPort codes, UserRepositoryPort users,
                          RefreshTokenRepositoryPort refreshTokens, TokenIssuerPort tokens, SecretsPort secrets,
                          ClockPort clock, IdGeneratorPort ids, TransactionPort tx, AuthSettings settings) {
        this.codes = codes;
        this.users = users;
        this.sessions = new SessionIssuer(refreshTokens, tokens, secrets, ids, settings);
        this.secrets = secrets;
        this.clock = clock;
        this.tx = tx;
        this.settings = settings;
    }

    @Override
    public HandoffCreated create(UUID userId, TargetApp targetApp, String codeChallenge, String createdIp) {
        // Roles are read from the database, not from the presented token (seguridad-y-sso.md section 11).
        User user = users.findById(userId).orElseThrow(Errors::userNotFound);
        if (!user.isActive()) throw Errors.accountSuspended();
        if (!user.canAccess(targetApp)) throw Errors.handoffTargetForbidden();
        Instant now = clock.now();
        String code = secrets.opaqueToken("hc_", 32);
        codes.insert(new HandoffCode(secrets.sha256Hex(code), userId, targetApp, codeChallenge,
                now.plus(settings.handoffTtl()), null, createdIp), now);
        String base = targetApp == TargetApp.ADMIN ? settings.adminBaseUrl() : settings.appBaseUrl();
        return new HandoffCreated(code, base + "/sso/callback?code=" + code, settings.handoffTtl().toSeconds());
    }

    @Override
    public Session exchange(String code, String codeVerifier) {
        Instant now = clock.now();
        // The code is consumed in its own committed transaction BEFORE the verifier is checked,
        // so a wrong verifier burns it (no brute force).
        Optional<HandoffCode> consumed = tx.inTransaction(() -> codes.consume(secrets.sha256Hex(code), now));
        HandoffCode handoff = consumed.orElseThrow(Errors::handoffCodeInvalid);
        if (!secrets.constantTimeEquals(secrets.pkceS256(codeVerifier), handoff.codeChallenge())) {
            log.warn("event=auth.handoff.pkce_mismatch userId={}", handoff.userId());
            throw Errors.handoffCodeInvalid();
        }
        return tx.inTransaction(() -> {
            User user = users.findById(handoff.userId()).orElseThrow(Errors::handoffCodeInvalid);
            if (!user.isActive()) throw Errors.accountSuspended();
            if (!user.canAccess(handoff.targetApp())) throw Errors.handoffTargetForbidden();
            return sessions.newFamily(user, handoff.targetApp(), now);
        });
    }
}
