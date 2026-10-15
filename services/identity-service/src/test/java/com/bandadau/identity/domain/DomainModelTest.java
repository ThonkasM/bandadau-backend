package com.bandadau.identity.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.bandadau.identity.domain.exception.DomainException;
import com.bandadau.identity.domain.model.*;
import com.bandadau.identity.domain.service.PasswordPolicy;
import java.time.Duration;
import java.time.Instant;
import java.util.EnumSet;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class DomainModelTest {
    private static final Instant NOW = Instant.parse("2026-10-14T12:00:00Z");
    private final University umsa = new University(UUID.randomUUID(), "UMSA", List.of("umsa.bo"), true);

    @Test
    void universityAcceptsExactDomainAndSubdomains() {
        assertThat(umsa.allows(Email.of("Ana@UMSA.bo"))).isTrue();
        assertThat(umsa.allows(Email.of("ana@est.umsa.bo"))).isTrue();
        assertThat(umsa.allows(Email.of("ana@gmail.com"))).isFalse();
        assertThat(umsa.allows(Email.of("ana@notumsa.bo"))).isFalse();
    }

    @Test
    void emailIsNormalizedAndValidated() {
        assertThat(Email.of("  Ana.Quispe@UMSA.bo ").value()).isEqualTo("ana.quispe@umsa.bo");
        assertThatThrownBy(() -> Email.of("not-an-email")).isInstanceOf(DomainException.class);
    }

    @Test
    void passwordPolicy() {
        Email email = Email.of("ana@umsa.bo");
        assertThat(PasswordPolicy.isAcceptable("short", email)).isFalse();
        assertThat(PasswordPolicy.isAcceptable("ana@umsa.bo", email)).isFalse();
        assertThat(PasswordPolicy.isAcceptable("Cóndor-Illimani-2026", email)).isTrue();
    }

    @Test
    void verificationCountsAttemptsAndExpires() {
        EmailVerification v = new EmailVerification(UUID.randomUUID(), UUID.randomUUID(), "h", NOW.plusSeconds(900), 0, null);
        for (int i = 0; i < 5; i++) assertThat(v.verify(false, NOW)).isEqualTo(EmailVerification.Result.WRONG_CODE);
        assertThat(v.verify(true, NOW)).isEqualTo(EmailVerification.Result.ATTEMPTS_EXCEEDED);

        EmailVerification expired = new EmailVerification(UUID.randomUUID(), UUID.randomUUID(), "h", NOW.minusSeconds(1), 0, null);
        assertThat(expired.verify(true, NOW)).isEqualTo(EmailVerification.Result.EXPIRED);

        EmailVerification ok = new EmailVerification(UUID.randomUUID(), UUID.randomUUID(), "h", NOW.plusSeconds(900), 2, null);
        assertThat(ok.verify(true, NOW)).isEqualTo(EmailVerification.Result.VERIFIED);
        assertThat(ok.verify(true, NOW)).isEqualTo(EmailVerification.Result.ALREADY_CONSUMED);
    }

    @Test
    void userLifecycle() {
        User user = User.register(UUID.randomUUID(), Email.of("ana@umsa.bo"), umsa.id(), Language.ES, NOW);
        assertThat(user.status()).isEqualTo(UserStatus.PENDING_VERIFICATION);
        assertThat(user.roles()).containsExactly(Role.STUDENT);
        assertThatThrownBy(() -> user.suspend("x", NOW)).isInstanceOf(DomainException.class);
        user.verifyEmail(NOW);
        assertThat(user.suspend("abuse", NOW)).isTrue();
        assertThat(user.suspend("abuse", NOW)).isFalse();
        assertThat(user.reactivate(NOW)).isTrue();
        assertThat(user.updatePreferences(Language.EN, ThemePreference.DARK, NOW)).isTrue();
        assertThat(user.updatePreferences(Language.EN, ThemePreference.DARK, NOW)).isFalse();
        assertThat(user.canAccess(TargetApp.ADMIN)).isFalse();
        user.changeRoles(EnumSet.of(Role.STUDENT, Role.MODERATOR), NOW);
        assertThat(user.canAccess(TargetApp.ADMIN)).isTrue();
    }

    @Test
    void credentialLocksProgressivelyAfterFiveFailures() {
        Credential c = new Credential(UUID.randomUUID(), "h", 0, null);
        for (int i = 0; i < 4; i++) c.registerFailure(NOW);
        assertThat(c.isLocked(NOW)).isFalse();
        c.registerFailure(NOW);
        assertThat(c.isLocked(NOW)).isTrue();
        assertThat(c.lockedUntil()).isEqualTo(NOW.plus(Duration.ofMinutes(1)));
        c.registerFailure(NOW);
        assertThat(c.lockedUntil()).isEqualTo(NOW.plus(Duration.ofMinutes(2)));
        c.registerSuccess();
        assertThat(c.isLocked(NOW)).isFalse();
    }
}
