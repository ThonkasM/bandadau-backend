package com.bandadau.identity.application.service;

import com.bandadau.identity.application.AuthSettings;
import com.bandadau.identity.application.port.in.Session;
import com.bandadau.identity.application.port.in.VerifyEmailUseCase;
import com.bandadau.identity.application.port.out.*;
import com.bandadau.identity.domain.event.UserRegistered;
import com.bandadau.identity.domain.exception.Errors;
import com.bandadau.identity.domain.model.*;
import java.time.Instant;
import java.util.Optional;

public final class VerifyEmailService implements VerifyEmailUseCase {
    private final UserRepositoryPort users;
    private final EmailVerificationRepositoryPort verifications;
    private final EventPublisherPort events;
    private final SessionIssuer sessions;
    private final SecretsPort secrets;
    private final ClockPort clock;
    private final TransactionPort tx;

    public VerifyEmailService(UserRepositoryPort users, EmailVerificationRepositoryPort verifications,
                              EventPublisherPort events, RefreshTokenRepositoryPort refreshTokens,
                              TokenIssuerPort tokens, SecretsPort secrets, ClockPort clock, IdGeneratorPort ids,
                              TransactionPort tx, AuthSettings settings) {
        this.users = users;
        this.verifications = verifications;
        this.events = events;
        this.sessions = new SessionIssuer(refreshTokens, tokens, secrets, ids, settings);
        this.secrets = secrets;
        this.clock = clock;
        this.tx = tx;
    }

    @Override
    public Session verify(String emailRaw, String code, TargetApp client) {
        Email email = Email.of(emailRaw);
        return tx.inTransaction(() -> attempt(email, code, client)).orThrow();
    }

    private Attempt<Session> attempt(Email email, String code, TargetApp client) {
        Instant now = clock.now();
        Optional<User> found = users.findByEmail(email);
        if (found.isEmpty()) return Attempt.fail(Errors.invalidVerificationCode(EmailVerification.MAX_ATTEMPTS - 1));
        User user = found.get();
        if (user.status() != UserStatus.PENDING_VERIFICATION) return Attempt.fail(Errors.emailAlreadyVerified());
        Optional<EmailVerification> latest = verifications.findLatestByUserId(user.id());
        if (latest.isEmpty()) return Attempt.fail(Errors.invalidVerificationCode(0));
        EmailVerification verification = latest.get();
        boolean matches = secrets.constantTimeEquals(secrets.sha256Hex(code), verification.codeHash());
        EmailVerification.Result result = verification.verify(matches, now);
        switch (result) {
            case VERIFIED -> {
                verifications.update(verification);
                user.verifyEmail(now);
                users.update(user);
                events.publish(new UserRegistered(user.id(), user.email(), user.universityId(),
                        displayName(user.email()), user.roles(), user.language(), now));
                return Attempt.ok(sessions.newFamily(user, client, now));
            }
            case ATTEMPTS_EXCEEDED -> {
                return Attempt.fail(Errors.verificationAttemptsExceeded());
            }
            case ALREADY_CONSUMED -> {
                return Attempt.fail(Errors.invalidVerificationCode(0));
            }
            default -> {
                verifications.update(verification);
                return Attempt.fail(Errors.invalidVerificationCode(verification.remainingAttempts()));
            }
        }
    }

    /** The contract has no display name at registration: it is derived from the email local part. */
    static String displayName(Email email) {
        StringBuilder out = new StringBuilder();
        for (String part : email.localPart().split("[._\\-+]+")) {
            if (part.isEmpty()) continue;
            if (out.length() > 0) out.append(' ');
            out.append(Character.toUpperCase(part.charAt(0))).append(part.substring(1));
        }
        String name = out.length() == 0 ? email.localPart() : out.toString();
        return name.length() > 80 ? name.substring(0, 80) : name;
    }
}
