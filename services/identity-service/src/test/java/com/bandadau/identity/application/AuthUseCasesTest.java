package com.bandadau.identity.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.bandadau.identity.application.port.in.RegisterUserUseCase.RegisterUserCommand;
import com.bandadau.identity.application.port.in.Session;
import com.bandadau.identity.domain.event.UserRegistered;
import com.bandadau.identity.domain.exception.DomainException;
import com.bandadau.identity.domain.model.*;
import java.time.Duration;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class AuthUseCasesTest {
    private static final String PASSWORD = "Cóndor-Illimani-2026";
    private World w;

    @BeforeEach
    void setUp() { w = new World(); }

    private RegisterUserCommand cmd(String email) {
        return new RegisterUserCommand(email, PASSWORD, w.umsa.id(), Language.ES);
    }

    private static String codeOf(DomainException e) { return e.code(); }

    // ---- UC-01 -----------------------------------------------------------------------------

    @Test
    void registerCreatesPendingUserAndSendsCodeWithoutPublishing() {
        var result = w.register.register(cmd("ana.quispe@umsa.bo"));
        assertThat(result.status()).isEqualTo(UserStatus.PENDING_VERIFICATION);
        assertThat(result.verificationExpiresIn()).isEqualTo(900);
        assertThat(w.sentCodes).hasSize(1);
        assertThat(w.lastCode()).matches("\\d{6}");
        assertThat(w.events).isEmpty();
    }

    @Test
    void registerRejectsForeignDomainWeakPasswordAndUnknownUniversity() {
        assertThatThrownBy(() -> w.register.register(cmd("ana@gmail.com"))).extracting(e -> codeOf((DomainException) e))
                .isEqualTo("EMAIL_DOMAIN_NOT_ALLOWED");
        assertThatThrownBy(() -> w.register.register(new RegisterUserCommand("ana@umsa.bo", "short", w.umsa.id(), Language.ES)))
                .extracting(e -> codeOf((DomainException) e)).isEqualTo("WEAK_PASSWORD");
        assertThatThrownBy(() -> w.register.register(new RegisterUserCommand("ana@umsa.bo", PASSWORD, w.id(), Language.ES)))
                .extracting(e -> codeOf((DomainException) e)).isEqualTo("UNIVERSITY_NOT_FOUND");
    }

    @Test
    void registeringAPendingEmailAgainReplacesTheCodeAndInvalidatesTheOldOne() {
        w.register.register(cmd("ana@umsa.bo"));
        String first = w.lastCode();
        w.register.register(cmd("ana@umsa.bo"));
        String second = w.lastCode();
        assertThat(w.users).hasSize(1);
        if (!first.equals(second)) {
            assertThatThrownBy(() -> w.verify.verify("ana@umsa.bo", first, TargetApp.APP))
                    .extracting(e -> codeOf((DomainException) e)).isEqualTo("INVALID_VERIFICATION_CODE");
        }
        assertThat(w.verify.verify("ana@umsa.bo", second, TargetApp.APP).user().isActive()).isTrue();
    }

    @Test
    void registeringAnActiveEmailConflictsByContractOrIsHiddenWhenConfigured() {
        w.activeUser("ana@umsa.bo", PASSWORD);
        assertThatThrownBy(() -> w.register.register(cmd("ana@umsa.bo"))).extracting(e -> codeOf((DomainException) e))
                .isEqualTo("EMAIL_ALREADY_REGISTERED");
    }

    @Test
    void verifyActivatesUserPublishesRegisteredEventAndReturnsTokens() {
        Session session = w.activeUser("ana.quispe@umsa.bo", PASSWORD);
        assertThat(session.user().status()).isEqualTo(UserStatus.ACTIVE);
        assertThat(session.refreshToken()).startsWith("rt_");
        assertThat(session.expiresIn()).isEqualTo(900);
        assertThat(w.events).singleElement().isInstanceOfSatisfying(UserRegistered.class, e -> {
            assertThat(e.displayName()).isEqualTo("Ana Quispe");
            assertThat(e.language()).isEqualTo(Language.ES);
        });
    }

    @Test
    void wrongCodesAreCountedAndTheFifthLocksVerification() {
        w.register.register(cmd("ana@umsa.bo"));
        String wrong = w.lastCode().equals("000000") ? "111111" : "000000";
        for (int remaining = 4; remaining >= 0; remaining--) {
            int expected = remaining;
            assertThatThrownBy(() -> w.verify.verify("ana@umsa.bo", wrong, TargetApp.APP))
                    .isInstanceOfSatisfying(DomainException.class, e -> {
                        assertThat(e.code()).isEqualTo("INVALID_VERIFICATION_CODE");
                        assertThat(e.params()).containsEntry("remainingAttempts", expected);
                    });
        }
        assertThatThrownBy(() -> w.verify.verify("ana@umsa.bo", w.lastCode(), TargetApp.APP))
                .extracting(e -> codeOf((DomainException) e)).isEqualTo("VERIFICATION_ATTEMPTS_EXCEEDED");
    }

    @Test
    void expiredCodeLooksLikeAWrongCodeAndUnknownEmailDoesNotLeak() {
        w.register.register(cmd("ana@umsa.bo"));
        String code = w.lastCode();
        w.now = w.now.plus(Duration.ofMinutes(16));
        assertThatThrownBy(() -> w.verify.verify("ana@umsa.bo", code, TargetApp.APP))
                .extracting(e -> codeOf((DomainException) e)).isEqualTo("INVALID_VERIFICATION_CODE");
        assertThatThrownBy(() -> w.verify.verify("nobody@umsa.bo", "123456", TargetApp.APP))
                .extracting(e -> codeOf((DomainException) e)).isEqualTo("INVALID_VERIFICATION_CODE");
    }

    @Test
    void resendIssuesANewCodeOnlyForPendingAccountsAndNeverFails() {
        w.register.register(cmd("ana@umsa.bo"));
        int before = w.sentCodes.size();
        w.resend.resend("ana@umsa.bo");
        w.resend.resend("ghost@umsa.bo");
        assertThat(w.sentCodes).hasSize(before + 1);
        w.verify.verify("ana@umsa.bo", w.lastCode(), TargetApp.APP);
        w.resend.resend("ana@umsa.bo");
        assertThat(w.sentCodes).hasSize(before + 1);
    }

    // ---- UC-02 -----------------------------------------------------------------------------

    @Test
    void loginRules() {
        w.register.register(cmd("ana@umsa.bo"));
        assertThatThrownBy(() -> w.login.login("ana@umsa.bo", PASSWORD, TargetApp.APP))
                .extracting(e -> codeOf((DomainException) e)).isEqualTo("EMAIL_NOT_VERIFIED");
        w.verify.verify("ana@umsa.bo", w.lastCode(), TargetApp.APP);
        assertThat(w.login.login("ana@umsa.bo", PASSWORD, TargetApp.APP).accessToken()).startsWith("access:");
        assertThatThrownBy(() -> w.login.login("ana@umsa.bo", "wrong-password", TargetApp.APP))
                .extracting(e -> codeOf((DomainException) e)).isEqualTo("INVALID_CREDENTIALS");
        assertThatThrownBy(() -> w.login.login("ghost@umsa.bo", PASSWORD, TargetApp.APP))
                .extracting(e -> codeOf((DomainException) e)).isEqualTo("INVALID_CREDENTIALS");
        assertThatThrownBy(() -> w.login.login("ana@umsa.bo", PASSWORD, TargetApp.ADMIN))
                .extracting(e -> codeOf((DomainException) e)).isEqualTo("FORBIDDEN");
    }

    @Test
    void fiveFailuresLockTheAccountEvenForTheRightPassword() {
        w.activeUser("ana@umsa.bo", PASSWORD);
        for (int i = 0; i < 5; i++) {
            assertThatThrownBy(() -> w.login.login("ana@umsa.bo", "wrong-password", TargetApp.APP))
                    .extracting(e -> codeOf((DomainException) e)).isEqualTo("INVALID_CREDENTIALS");
        }
        assertThatThrownBy(() -> w.login.login("ana@umsa.bo", PASSWORD, TargetApp.APP))
                .isInstanceOfSatisfying(DomainException.class, e -> {
                    assertThat(e.code()).isEqualTo("RATE_LIMITED");
                    assertThat(e.params()).containsKey("retryAfter");
                });
        w.now = w.now.plus(Duration.ofMinutes(2));
        assertThat(w.login.login("ana@umsa.bo", PASSWORD, TargetApp.APP).user().isActive()).isTrue();
    }

    @Test
    void suspendedUsersCannotLogInAndTheirRefreshTokensAreRevoked() {
        Session session = w.activeUser("ana@umsa.bo", PASSWORD);
        w.manageUsers.updateStatus(session.user().id(), UserStatus.SUSPENDED, "abuse", w.id());
        assertThatThrownBy(() -> w.login.login("ana@umsa.bo", PASSWORD, TargetApp.APP))
                .extracting(e -> codeOf((DomainException) e)).isEqualTo("ACCOUNT_SUSPENDED");
        assertThatThrownBy(() -> w.refresh.refresh(session.refreshToken()))
                .extracting(e -> codeOf((DomainException) e)).isEqualTo("REFRESH_TOKEN_REUSED");
    }

    // ---- refresh rotation and reuse detection (RN-02.2, RN-02.3) ----------------------------

    @Test
    void refreshRotatesAndReusingTheOldTokenRevokesTheWholeFamily() {
        Session first = w.activeUser("ana@umsa.bo", PASSWORD);
        Session second = w.refresh.refresh(first.refreshToken());
        assertThat(second.refreshToken()).isNotEqualTo(first.refreshToken());
        Session third = w.refresh.refresh(second.refreshToken());

        assertThatThrownBy(() -> w.refresh.refresh(first.refreshToken()))
                .extracting(e -> codeOf((DomainException) e)).isEqualTo("REFRESH_TOKEN_REUSED");
        // the legitimate holder of the newest token lost the family too
        assertThatThrownBy(() -> w.refresh.refresh(third.refreshToken()))
                .extracting(e -> codeOf((DomainException) e)).isEqualTo("REFRESH_TOKEN_REUSED");
        assertThat(w.refreshTokens.values()).allMatch(t -> t.revokedAt() != null);
    }

    @Test
    void unknownAndExpiredRefreshTokensAreInvalid() {
        Session session = w.activeUser("ana@umsa.bo", PASSWORD);
        assertThatThrownBy(() -> w.refresh.refresh("rt_does-not-exist-123456"))
                .extracting(e -> codeOf((DomainException) e)).isEqualTo("INVALID_REFRESH_TOKEN");
        w.now = w.now.plus(Duration.ofDays(31));
        assertThatThrownBy(() -> w.refresh.refresh(session.refreshToken()))
                .extracting(e -> codeOf((DomainException) e)).isEqualTo("INVALID_REFRESH_TOKEN");
    }

    @Test
    void logoutRevokesTheFamilyOnlyForTheOwner() {
        Session session = w.activeUser("ana@umsa.bo", PASSWORD);
        w.logout(w.id(), session.refreshToken());
        assertThat(w.refreshTokens.values()).noneMatch(t -> t.revokedAt() != null);
        w.logout(session.user().id(), session.refreshToken());
        assertThatThrownBy(() -> w.refresh.refresh(session.refreshToken()))
                .extracting(e -> codeOf((DomainException) e)).isEqualTo("REFRESH_TOKEN_REUSED");
    }

    // ---- UC-21 -----------------------------------------------------------------------------

    @Test
    void lastAdminCannotLoseTheRoleAndRoleChangesArePublishedOnce() {
        Session ana = w.activeUser("ana@umsa.bo", PASSWORD);
        var actor = w.id();
        w.manageUsers.updateRoles(ana.user().id(), Set.of(Role.STUDENT, Role.ADMIN), actor);
        assertThatThrownBy(() -> w.manageUsers.updateRoles(ana.user().id(), Set.of(Role.STUDENT), actor))
                .extracting(e -> codeOf((DomainException) e)).isEqualTo("LAST_ADMIN");
        int published = w.events.size();
        w.manageUsers.updateRoles(ana.user().id(), Set.of(Role.STUDENT, Role.ADMIN), actor);
        assertThat(w.events).hasSize(published);
    }

    @Test
    void suspendAndReactivatePublishEventsAndAreIdempotent() {
        Session ana = w.activeUser("ana@umsa.bo", PASSWORD);
        w.events.clear();
        w.manageUsers.updateStatus(ana.user().id(), UserStatus.SUSPENDED, "abuse", w.id());
        w.manageUsers.updateStatus(ana.user().id(), UserStatus.SUSPENDED, "abuse", w.id());
        w.manageUsers.updateStatus(ana.user().id(), UserStatus.ACTIVE, null, w.id());
        assertThat(w.events).extracting(e -> e.getClass().getSimpleName()).containsExactly("UserSuspended", "UserReactivated");
    }
}
