package com.bandadau.identity.application.service;

import com.bandadau.identity.application.AuthSettings;
import com.bandadau.identity.application.port.in.RegisterUserUseCase;
import com.bandadau.identity.application.port.out.*;
import com.bandadau.identity.domain.exception.Errors;
import com.bandadau.identity.domain.model.*;
import com.bandadau.identity.domain.service.InstitutionalEmailPolicy;
import com.bandadau.identity.domain.service.PasswordPolicy;
import java.time.Instant;
import java.util.Optional;

public final class RegisterUserService implements RegisterUserUseCase {

    private record Outcome(User user, String code, boolean existingAccount) { }

    private final UserRepositoryPort users;
    private final UniversityRepositoryPort universities;
    private final CredentialRepositoryPort credentials;
    private final EmailVerificationRepositoryPort verifications;
    private final PasswordHasherPort hasher;
    private final SecretsPort secrets;
    private final VerificationCodeSenderPort sender;
    private final ClockPort clock;
    private final IdGeneratorPort ids;
    private final TransactionPort tx;
    private final AuthSettings settings;

    public RegisterUserService(UserRepositoryPort users, UniversityRepositoryPort universities,
                               CredentialRepositoryPort credentials, EmailVerificationRepositoryPort verifications,
                               PasswordHasherPort hasher, SecretsPort secrets, VerificationCodeSenderPort sender,
                               ClockPort clock, IdGeneratorPort ids, TransactionPort tx, AuthSettings settings) {
        this.users = users;
        this.universities = universities;
        this.credentials = credentials;
        this.verifications = verifications;
        this.hasher = hasher;
        this.secrets = secrets;
        this.sender = sender;
        this.clock = clock;
        this.ids = ids;
        this.tx = tx;
        this.settings = settings;
    }

    @Override
    public RegisteredUser register(RegisterUserCommand cmd) {
        Email email = Email.of(cmd.email());
        University university = universities.findById(cmd.universityId()).orElseThrow(Errors::universityNotFound);
        InstitutionalEmailPolicy.ensureAllowed(university, email);
        if (!PasswordPolicy.isAcceptable(cmd.password(), email)) throw Errors.weakPassword();

        String passwordHash = hasher.hash(cmd.password());
        String code = secrets.sixDigitCode();
        Outcome outcome = tx.inTransaction(() -> persist(email, university, cmd.language(), passwordHash, code));

        long expiresIn = settings.verificationTtl().toSeconds();
        if (outcome.existingAccount()) {
            if (!settings.hideExistingAccounts()) throw Errors.emailAlreadyRegistered();
            sender.sendExistingAccountNotice(email, outcome.user().language());
            return new RegisteredUser(outcome.user().id(), email.value(), UserStatus.PENDING_VERIFICATION, expiresIn);
        }
        sender.sendCode(email, outcome.code(), outcome.user().language());
        return new RegisteredUser(outcome.user().id(), email.value(), UserStatus.PENDING_VERIFICATION, expiresIn);
    }

    private Outcome persist(Email email, University university, Language language, String passwordHash, String code) {
        Instant now = clock.now();
        Optional<User> existing = users.findByEmail(email);
        if (existing.isPresent()) {
            User user = existing.get();
            if (user.status() != UserStatus.PENDING_VERIFICATION) return new Outcome(user, null, true);
            credentials.save(new Credential(user.id(), passwordHash, 0, null));
            issueVerification(user, code, now);
            return new Outcome(user, code, false);
        }
        User user = User.register(ids.newId(), email, university.id(), language, now);
        users.insert(user);
        credentials.save(new Credential(user.id(), passwordHash, 0, null));
        issueVerification(user, code, now);
        return new Outcome(user, code, false);
    }

    private void issueVerification(User user, String code, Instant now) {
        verifications.invalidateAll(user.id(), now);
        verifications.insert(new EmailVerification(ids.newId(), user.id(), secrets.sha256Hex(code),
                now.plus(settings.verificationTtl()), 0, null), now);
    }
}
