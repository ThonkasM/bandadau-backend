package com.bandadau.identity.application.service;

import com.bandadau.identity.application.AuthSettings;
import com.bandadau.identity.application.port.in.LoginUseCase;
import com.bandadau.identity.application.port.in.Session;
import com.bandadau.identity.application.port.out.*;
import com.bandadau.identity.domain.exception.Errors;
import com.bandadau.identity.domain.model.*;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;

public final class LoginService implements LoginUseCase {
    private final UserRepositoryPort users;
    private final CredentialRepositoryPort credentials;
    private final PasswordHasherPort hasher;
    private final SessionIssuer sessions;
    private final ClockPort clock;
    private final TransactionPort tx;

    public LoginService(UserRepositoryPort users, CredentialRepositoryPort credentials, PasswordHasherPort hasher,
                        RefreshTokenRepositoryPort refreshTokens, TokenIssuerPort tokens, SecretsPort secrets,
                        ClockPort clock, IdGeneratorPort ids, TransactionPort tx, AuthSettings settings) {
        this.users = users;
        this.credentials = credentials;
        this.hasher = hasher;
        this.sessions = new SessionIssuer(refreshTokens, tokens, secrets, ids, settings);
        this.clock = clock;
        this.tx = tx;
    }

    @Override
    public Session login(String emailRaw, String password, TargetApp client) {
        Email email = Email.of(emailRaw);
        Optional<User> found = users.findByEmail(email);
        if (found.isEmpty()) {
            hasher.burn(password);
            throw Errors.invalidCredentials();
        }
        User user = found.get();
        Credential credential = credentials.findByUserId(user.id()).orElse(null);
        if (credential == null) {
            hasher.burn(password);
            throw Errors.invalidCredentials();
        }
        Instant now = clock.now();
        if (credential.isLocked(now)) {
            throw Errors.loginLocked(Math.max(1, Duration.between(now, credential.lockedUntil()).toSeconds()));
        }
        if (!hasher.matches(password, credential.passwordHash())) {
            tx.inTransaction(() -> {
                credential.registerFailure(now);
                credentials.save(credential);
            });
            throw Errors.invalidCredentials();
        }
        return tx.inTransaction(() -> {
            if (credential.failedAttempts() > 0) {
                credential.registerSuccess();
                credentials.save(credential);
            }
            switch (user.status()) {
                case PENDING_VERIFICATION -> throw Errors.emailNotVerified();
                case SUSPENDED -> throw Errors.accountSuspended();
                case DELETED -> throw Errors.invalidCredentials();
                default -> { }
            }
            if (!user.canAccess(client)) throw Errors.adminAccessForbidden();
            return sessions.newFamily(user, client, now);
        });
    }
}
