package com.bandadau.identity.application.service;

import com.bandadau.identity.application.AuthSettings;
import com.bandadau.identity.application.port.in.ResendVerificationCodeUseCase;
import com.bandadau.identity.application.port.out.*;
import com.bandadau.identity.domain.model.*;
import java.time.Instant;
import java.util.Optional;

public final class ResendVerificationCodeService implements ResendVerificationCodeUseCase {
    private final UserRepositoryPort users;
    private final EmailVerificationRepositoryPort verifications;
    private final VerificationCodeSenderPort sender;
    private final SecretsPort secrets;
    private final ClockPort clock;
    private final IdGeneratorPort ids;
    private final TransactionPort tx;
    private final AuthSettings settings;

    public ResendVerificationCodeService(UserRepositoryPort users, EmailVerificationRepositoryPort verifications,
                                         VerificationCodeSenderPort sender, SecretsPort secrets, ClockPort clock,
                                         IdGeneratorPort ids, TransactionPort tx, AuthSettings settings) {
        this.users = users;
        this.verifications = verifications;
        this.sender = sender;
        this.secrets = secrets;
        this.clock = clock;
        this.ids = ids;
        this.tx = tx;
        this.settings = settings;
    }

    @Override
    public void resend(String emailRaw) {
        Email email = Email.of(emailRaw);
        String code = secrets.sixDigitCode();
        Optional<User> pending = tx.inTransaction(() -> {
            Optional<User> user = users.findByEmail(email).filter(u -> u.status() == UserStatus.PENDING_VERIFICATION);
            user.ifPresent(u -> {
                Instant now = clock.now();
                verifications.invalidateAll(u.id(), now);
                verifications.insert(new EmailVerification(ids.newId(), u.id(), secrets.sha256Hex(code),
                        now.plus(settings.verificationTtl()), 0, null), now);
            });
            return user;
        });
        pending.ifPresent(u -> sender.sendCode(email, code, u.language()));
    }
}
