package com.bandadau.identity.application;

import com.bandadau.identity.adapter.out.external.SecureSecretsAdapter;
import com.bandadau.identity.application.port.in.*;
import com.bandadau.identity.application.port.out.*;
import com.bandadau.identity.application.service.*;
import com.bandadau.identity.domain.event.DomainEvent;
import com.bandadau.identity.domain.exception.Errors;
import com.bandadau.identity.domain.model.*;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.function.Supplier;

/** In-memory doubles of every outbound port plus the wired use cases (no Spring, no Docker). */
public final class World {
    public static final Instant START = Instant.parse("2026-10-14T12:00:00Z");

    public final AuthSettings settings = new AuthSettings(Duration.ofMinutes(15), Duration.ofDays(30),
            Duration.ofHours(12), Duration.ofSeconds(60), Duration.ofMinutes(15), Duration.ofMinutes(5),
            "http://app.test", "http://admin.test", false);

    public Instant now = START;
    public final Map<UUID, User> users = new LinkedHashMap<>();
    public final Map<UUID, Credential> credentials = new HashMap<>();
    public final List<EmailVerification> verifications = new ArrayList<>();
    public final Map<UUID, University> universities = new LinkedHashMap<>();
    public final Map<String, RefreshToken> refreshTokens = new LinkedHashMap<>();
    public final Map<String, HandoffCode> handoffCodes = new HashMap<>();
    public final List<DomainEvent> events = new ArrayList<>();
    public final List<String[]> sentCodes = new ArrayList<>();
    public final University umsa;

    private long idCounter = 0;

    public final RegisterUserUseCase register;
    public final VerifyEmailUseCase verify;
    public final ResendVerificationCodeUseCase resend;
    public final LoginUseCase login;
    public final RefreshTokenService refresh;
    public final HandoffService handoff;
    public final ManageUsersUseCase manageUsers;

    public World() {
        umsa = new University(id(), "UMSA", List.of("umsa.bo"), true);
        universities.put(umsa.id(), umsa);

        ClockPort clock = () -> now;
        IdGeneratorPort ids = this::id;
        SecretsPort secrets = new SecureSecretsAdapter();
        TransactionPort tx = new TransactionPort() {
            @Override public <T> T inTransaction(Supplier<T> work) { return work.get(); }
        };
        PasswordHasherPort hasher = new PasswordHasherPort() {
            @Override public String hash(String raw) { return "hash:" + raw; }
            @Override public boolean matches(String raw, String hash) { return hash.equals("hash:" + raw); }
            @Override public void burn(String raw) { }
        };
        TokenIssuerPort tokens = new TokenIssuerPort() {
            @Override public String issueAccess(User u, TargetApp aud, Duration ttl) { return "access:" + u.id() + ":" + aud; }
            @Override public String issueService(String c, Set<String> s, Duration ttl) { return "service:" + c; }
            @Override public List<Map<String, Object>> publicKeys() { return List.of(); }
        };
        VerificationCodeSenderPort sender = new VerificationCodeSenderPort() {
            @Override public void sendCode(Email to, String code, Language l) { sentCodes.add(new String[] {to.value(), code}); }
            @Override public void sendExistingAccountNotice(Email to, Language l) { sentCodes.add(new String[] {to.value(), "NOTICE"}); }
        };
        EventPublisherPort publisher = events::add;

        UserRepositoryPort userRepo = new UserRepositoryPort() {
            @Override public Optional<User> findById(UUID id) { return Optional.ofNullable(users.get(id)); }
            @Override public Optional<User> findByEmail(Email e) {
                return users.values().stream().filter(u -> u.email().equals(e)).findFirst();
            }
            @Override public void insert(User u) {
                if (findByEmail(u.email()).isPresent()) throw Errors.emailAlreadyRegistered();
                users.put(u.id(), u);
            }
            @Override public void update(User u) { users.put(u.id(), u); }
            @Override public boolean existsOtherAdmin(UUID excluded) {
                return users.values().stream().anyMatch(u -> !u.id().equals(excluded) && u.roles().contains(Role.ADMIN));
            }
            @Override public void recordRoleChange(UUID u, UUID a, Set<Role> o, Set<Role> n) { }
            @Override public Page<User> search(ManageUsersUseCase.UserFilter f, String c, int limit) {
                return new Page<>(List.copyOf(users.values()), null);
            }
        };
        CredentialRepositoryPort credentialRepo = new CredentialRepositoryPort() {
            @Override public Optional<Credential> findByUserId(UUID id) { return Optional.ofNullable(credentials.get(id)); }
            @Override public void save(Credential c) { credentials.put(c.userId(), c); }
        };
        EmailVerificationRepositoryPort verificationRepo = new EmailVerificationRepositoryPort() {
            @Override public Optional<EmailVerification> findLatestByUserId(UUID id) {
                return verifications.stream().filter(v -> v.userId().equals(id)).reduce((a, b) -> b);
            }
            @Override public void insert(EmailVerification v, Instant at) { verifications.add(v); }
            @Override public void update(EmailVerification v) { }
            @Override public void invalidateAll(UUID id, Instant now) {
                verifications.stream().filter(v -> v.userId().equals(id)).forEach(v -> v.invalidate(now));
            }
        };
        UniversityRepositoryPort universityRepo = new UniversityRepositoryPort() {
            @Override public Optional<University> findById(UUID id) { return Optional.ofNullable(universities.get(id)); }
            @Override public void insert(University u) { universities.put(u.id(), u); }
            @Override public void update(University u) { universities.put(u.id(), u); }
            @Override public Page<University> listEnabled(String c, int l) {
                return new Page<>(universities.values().stream().filter(University::enabled).toList(), null);
            }
            @Override public List<String> domainsTakenByOthers(List<String> d, UUID self) { return List.of(); }
        };
        RefreshTokenRepositoryPort refreshRepo = new RefreshTokenRepositoryPort() {
            @Override public void insert(RefreshToken t) { refreshTokens.put(t.tokenHash(), t); }
            @Override public Optional<RefreshToken> findByHashForUpdate(String h) { return Optional.ofNullable(refreshTokens.get(h)); }
            @Override public void markUsed(UUID id, Instant at) { replace(id, t -> new RefreshToken(t.id(), t.userId(),
                    t.familyId(), t.client(), t.tokenHash(), t.parentId(), t.expiresAt(), at, t.revokedAt(), t.createdAt())); }
            @Override public void revokeFamily(UUID f, Instant at) {
                refreshTokens.replaceAll((h, t) -> t.familyId().equals(f) && t.revokedAt() == null ? revoked(t, at) : t);
            }
            @Override public void revokeAllForUser(UUID u, Instant at) {
                refreshTokens.replaceAll((h, t) -> t.userId().equals(u) && t.revokedAt() == null ? revoked(t, at) : t);
            }
        };
        HandoffCodeRepositoryPort handoffRepo = new HandoffCodeRepositoryPort() {
            @Override public void insert(HandoffCode c, Instant at) { handoffCodes.put(c.codeHash(), c); }
            @Override public Optional<HandoffCode> consume(String hash, Instant at) {
                HandoffCode c = handoffCodes.get(hash);
                if (c == null || c.usedAt() != null || !c.expiresAt().isAfter(at)) return Optional.empty();
                HandoffCode used = new HandoffCode(c.codeHash(), c.userId(), c.targetApp(), c.codeChallenge(),
                        c.expiresAt(), at, c.createdIp());
                handoffCodes.put(hash, used);
                return Optional.of(used);
            }
        };

        register = new RegisterUserService(userRepo, universityRepo, credentialRepo, verificationRepo, hasher, secrets,
                sender, clock, ids, tx, settings);
        verify = new VerifyEmailService(userRepo, verificationRepo, publisher, refreshRepo, tokens, secrets, clock, ids,
                tx, settings);
        resend = new ResendVerificationCodeService(userRepo, verificationRepo, sender, secrets, clock, ids, tx, settings);
        login = new LoginService(userRepo, credentialRepo, hasher, refreshRepo, tokens, secrets, clock, ids, tx, settings);
        refresh = new RefreshTokenService(refreshRepo, userRepo, tokens, secrets, clock, ids, tx, settings);
        handoff = new HandoffService(handoffRepo, userRepo, refreshRepo, tokens, secrets, clock, ids, tx, settings);
        manageUsers = new ManageUsersService(userRepo, refreshRepo, publisher, clock, tx);
    }

    private static RefreshToken revoked(RefreshToken t, Instant at) {
        return new RefreshToken(t.id(), t.userId(), t.familyId(), t.client(), t.tokenHash(), t.parentId(), t.expiresAt(),
                t.usedAt(), at, t.createdAt());
    }

    private void replace(UUID id, java.util.function.UnaryOperator<RefreshToken> fn) {
        refreshTokens.replaceAll((h, t) -> t.id().equals(id) ? fn.apply(t) : t);
    }

    public void logout(UUID userId, String token) { refresh.logout(userId, token); }

    public UUID id() {
        return new UUID(0x0192000000007000L, 0x8000000000000000L + (++idCounter));
    }

    public String lastCode() { return sentCodes.get(sentCodes.size() - 1)[1]; }

    /** Registers and verifies a user, returning the active session. */
    public Session activeUser(String email, String password) {
        register.register(new RegisterUserUseCase.RegisterUserCommand(email, password, umsa.id(), Language.ES));
        return verify.verify(email, lastCode(), TargetApp.APP);
    }
}
