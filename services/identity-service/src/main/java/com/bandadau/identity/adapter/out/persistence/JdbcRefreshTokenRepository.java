package com.bandadau.identity.adapter.out.persistence;

import com.bandadau.identity.application.port.out.RefreshTokenRepositoryPort;
import com.bandadau.identity.domain.model.RefreshToken;
import com.bandadau.identity.domain.model.TargetApp;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;

public class JdbcRefreshTokenRepository implements RefreshTokenRepositoryPort {
    private final JdbcClient jdbc;

    public JdbcRefreshTokenRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public void insert(RefreshToken t) {
        jdbc.sql("""
                INSERT INTO refresh_tokens (id, user_id, family_id, client, token_hash, parent_id, expires_at, used_at,
                                            revoked_at, created_at)
                VALUES (:id, :user, :family, :client, :hash, :parent, :exp, :used, :revoked, :created)
                """)
                .param("id", t.id()).param("user", t.userId()).param("family", t.familyId())
                .param("client", t.client().name()).param("hash", t.tokenHash()).param("parent", t.parentId())
                .param("exp", Sql.ts(t.expiresAt())).param("used", Sql.ts(t.usedAt()))
                .param("revoked", Sql.ts(t.revokedAt())).param("created", Sql.ts(t.createdAt())).update();
    }

    @Override
    public Optional<RefreshToken> findByHashForUpdate(String tokenHash) {
        return jdbc.sql("""
                SELECT id, user_id, family_id, client, token_hash, parent_id, expires_at, used_at, revoked_at, created_at
                FROM refresh_tokens WHERE token_hash = :hash FOR UPDATE
                """)
                .param("hash", tokenHash)
                .query((rs, n) -> new RefreshToken(Sql.uuid(rs, "id"), Sql.uuid(rs, "user_id"), Sql.uuid(rs, "family_id"),
                        TargetApp.valueOf(rs.getString("client")), rs.getString("token_hash").trim(),
                        Sql.uuid(rs, "parent_id"), Sql.instant(rs, "expires_at"), Sql.instant(rs, "used_at"),
                        Sql.instant(rs, "revoked_at"), Sql.instant(rs, "created_at")))
                .optional();
    }

    @Override
    public void markUsed(UUID id, Instant now) {
        jdbc.sql("UPDATE refresh_tokens SET used_at = :now WHERE id = :id").param("now", Sql.ts(now))
                .param("id", id).update();
    }

    @Override
    public void revokeFamily(UUID familyId, Instant now) {
        jdbc.sql("UPDATE refresh_tokens SET revoked_at = :now WHERE family_id = :f AND revoked_at IS NULL")
                .param("now", Sql.ts(now)).param("f", familyId).update();
    }

    @Override
    public void revokeAllForUser(UUID userId, Instant now) {
        jdbc.sql("UPDATE refresh_tokens SET revoked_at = :now WHERE user_id = :u AND revoked_at IS NULL")
                .param("now", Sql.ts(now)).param("u", userId).update();
    }
}
