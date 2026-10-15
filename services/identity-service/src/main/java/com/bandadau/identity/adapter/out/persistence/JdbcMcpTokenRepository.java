package com.bandadau.identity.adapter.out.persistence;

import com.bandadau.identity.application.port.out.McpTokenRepositoryPort;
import com.bandadau.identity.domain.model.McpToken;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;

public class JdbcMcpTokenRepository implements McpTokenRepositoryPort {
    private final JdbcClient jdbc;

    public JdbcMcpTokenRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public void insert(McpToken t) {
        jdbc.sql("INSERT INTO mcp_tokens (id, user_id, label, created_at, expires_at) VALUES (:id, :user, :label, :created, :expires)")
                .param("id", t.id()).param("user", t.userId()).param("label", t.label())
                .param("created", Sql.ts(t.createdAt())).param("expires", Sql.ts(t.expiresAt())).update();
    }

    @Override
    public Optional<McpToken> findById(UUID id) {
        return jdbc.sql("SELECT id, user_id, label, created_at, expires_at, revoked_at FROM mcp_tokens WHERE id = :id")
                .param("id", id).query((rs, row) -> new McpToken(Sql.uuid(rs, "id"), Sql.uuid(rs, "user_id"),
                        rs.getString("label"), Sql.instant(rs, "created_at"), Sql.instant(rs, "expires_at"),
                        Sql.instant(rs, "revoked_at"))).optional();
    }

    @Override
    public void revoke(UUID id, Instant at) {
        jdbc.sql("UPDATE mcp_tokens SET revoked_at = :at WHERE id = :id AND revoked_at IS NULL")
                .param("at", Sql.ts(at)).param("id", id).update();
    }
}
