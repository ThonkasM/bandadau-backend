package com.bandadau.identity.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.bandadau.identity.adapter.out.external.SecureSecretsAdapter;
import com.bandadau.identity.application.port.in.CreateHandoffCodeUseCase.HandoffCreated;
import com.bandadau.identity.application.port.in.Session;
import com.bandadau.identity.domain.exception.DomainException;
import com.bandadau.identity.domain.model.Role;
import com.bandadau.identity.domain.model.TargetApp;
import java.time.Duration;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class HandoffUseCasesTest {
    private static final String VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    private final String challenge = new SecureSecretsAdapter().pkceS256(VERIFIER);
    private World w;
    private Session moderator;

    @BeforeEach
    void setUp() {
        w = new World();
        moderator = w.activeUser("mod@umsa.bo", "Cóndor-Illimani-2026");
        w.manageUsers.updateRoles(moderator.user().id(), Set.of(Role.STUDENT, Role.MODERATOR), w.id());
    }

    private static String code(Throwable t) { return ((DomainException) t).code(); }

    @Test
    void createdCodeIsHashedAndExchangesExactlyOnce() {
        HandoffCreated created = w.handoff.create(moderator.user().id(), TargetApp.ADMIN, challenge, "127.0.0.1");
        assertThat(created.expiresIn()).isEqualTo(60);
        assertThat(created.redirectUrl()).isEqualTo("http://admin.test/sso/callback?code=" + created.code());
        assertThat(w.handoffCodes.keySet()).doesNotContain(created.code());

        Session session = w.handoff.exchange(created.code(), VERIFIER);
        assertThat(session.accessToken()).endsWith(":ADMIN");
        assertThatThrownBy(() -> w.handoff.exchange(created.code(), VERIFIER)).satisfies(e -> assertThat(code(e)).isEqualTo("HANDOFF_CODE_INVALID"));
    }

    @Test
    void wrongVerifierBurnsTheCode() {
        HandoffCreated created = w.handoff.create(moderator.user().id(), TargetApp.ADMIN, challenge, "127.0.0.1");
        assertThatThrownBy(() -> w.handoff.exchange(created.code(), "x".repeat(43)))
                .satisfies(e -> assertThat(code(e)).isEqualTo("HANDOFF_CODE_INVALID"));
        assertThatThrownBy(() -> w.handoff.exchange(created.code(), VERIFIER))
                .satisfies(e -> assertThat(code(e)).isEqualTo("HANDOFF_CODE_INVALID"));
    }

    @Test
    void expiredAndUnknownCodesAreIndistinguishable() {
        HandoffCreated created = w.handoff.create(moderator.user().id(), TargetApp.ADMIN, challenge, "127.0.0.1");
        w.now = w.now.plus(Duration.ofSeconds(61));
        assertThatThrownBy(() -> w.handoff.exchange(created.code(), VERIFIER))
                .satisfies(e -> assertThat(code(e)).isEqualTo("HANDOFF_CODE_INVALID"));
        assertThatThrownBy(() -> w.handoff.exchange("hc_unknown-code-123456", VERIFIER))
                .satisfies(e -> assertThat(code(e)).isEqualTo("HANDOFF_CODE_INVALID"));
    }

    @Test
    void adminTargetRequiresModeratorOrAdminWhenCreatingAndExchanging() {
        Session student = w.activeUser("stu@umsa.bo", "Cóndor-Illimani-2026");
        assertThatThrownBy(() -> w.handoff.create(student.user().id(), TargetApp.ADMIN, challenge, "ip"))
                .satisfies(e -> assertThat(code(e)).isEqualTo("HANDOFF_TARGET_FORBIDDEN"));
        assertThat(w.handoff.create(student.user().id(), TargetApp.APP, challenge, "ip").code()).startsWith("hc_");

        HandoffCreated created = w.handoff.create(moderator.user().id(), TargetApp.ADMIN, challenge, "ip");
        w.manageUsers.updateRoles(moderator.user().id(), Set.of(Role.STUDENT, Role.ADMIN), UUID.randomUUID());
        w.manageUsers.updateRoles(moderator.user().id(), Set.of(Role.STUDENT, Role.ADMIN), UUID.randomUUID());
        assertThat(w.handoff.exchange(created.code(), VERIFIER).user().roles()).contains(Role.ADMIN);
    }

    @Test
    void exchangeIssuesAnIndependentFamilyForTheTargetApp() {
        HandoffCreated created = w.handoff.create(moderator.user().id(), TargetApp.ADMIN, challenge, "ip");
        Session session = w.handoff.exchange(created.code(), VERIFIER);
        var families = w.refreshTokens.values().stream().map(t -> t.familyId()).distinct().count();
        assertThat(families).isEqualTo(2);
        assertThat(w.refreshTokens.values()).anyMatch(t -> t.client() == TargetApp.ADMIN
                && t.expiresAt().equals(w.now.plus(w.settings.adminRefreshTtl())));
        assertThat(session.refreshExpiresIn()).isEqualTo(12 * 3600);
    }
}
