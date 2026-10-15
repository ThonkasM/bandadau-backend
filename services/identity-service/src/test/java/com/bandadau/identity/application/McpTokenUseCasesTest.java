package com.bandadau.identity.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.bandadau.identity.domain.exception.DomainException;
import com.bandadau.identity.domain.model.Role;
import java.time.Duration;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** UC-22: createMcpToken / revokeMcpToken / status (jti registry used by insights-service). */
class McpTokenUseCasesTest {
    private static final String PASSWORD = "Cóndor-Illimani-2026";
    private World w;
    private UUID admin;

    @BeforeEach
    void setUp() {
        w = new World();
        admin = w.activeUser("root@umsa.bo", PASSWORD).user().id();
        w.manageUsers.updateRoles(admin, Set.of(Role.STUDENT, Role.ADMIN), UUID.randomUUID());
    }

    @Test
    void adminGetsAnEightHourTokenRegisteredByItsJti() {
        var issued = w.mcpTokens.create(admin, "  Claude Desktop  ");
        assertThat(issued.expiresIn()).isEqualTo(Duration.ofHours(8).toSeconds());
        assertThat(issued.accessToken()).contains(issued.token().id().toString());
        assertThat(issued.token().label()).isEqualTo("Claude Desktop");
        assertThat(issued.token().expiresAt()).isEqualTo(w.now.plus(Duration.ofHours(8)));
        assertThat(w.mcpTokens.status(issued.token().id()).revoked()).isFalse();
    }

    @Test
    void nonAdminsCannotCreateTokens() {
        UUID student = w.activeUser("ana@umsa.bo", PASSWORD).user().id();
        assertThatThrownBy(() -> w.mcpTokens.create(student, null)).isInstanceOfSatisfying(DomainException.class,
                e -> assertThat(e.kind()).isEqualTo(DomainException.Kind.FORBIDDEN));
    }

    @Test
    void labelLongerThanEightyCharactersIsRejected() {
        assertThatThrownBy(() -> w.mcpTokens.create(admin, "x".repeat(81))).isInstanceOf(DomainException.class);
    }

    @Test
    void revokingIsIdempotentAndUnknownIdsAreNotFound() {
        UUID id = w.mcpTokens.create(admin, null).token().id();
        w.mcpTokens.revoke(id);
        w.mcpTokens.revoke(id);
        assertThat(w.mcpTokens.status(id).revoked()).isTrue();
        assertThatThrownBy(() -> w.mcpTokens.revoke(UUID.randomUUID())).isInstanceOfSatisfying(DomainException.class,
                e -> assertThat(e.kind()).isEqualTo(DomainException.Kind.NOT_FOUND));
    }
}
