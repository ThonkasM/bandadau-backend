package com.bandadau.identity.adapter.out.persistence;

import com.bandadau.identity.application.port.out.EmailVerificationRepositoryPort;
import com.bandadau.identity.domain.model.EmailVerification;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;

public class JdbcEmailVerificationRepository implements EmailVerificationRepositoryPort {
    private final JdbcClient jdbc;

    public JdbcEmailVerificationRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public Optional<EmailVerification> findLatestByUserId(UUID userId) {
        return jdbc.sql("""
                SELECT id, user_id, code_hash, expires_at, attempts, consumed_at FROM email_verifications
                WHERE user_id = :id ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE
                """)
                .param("id", userId)
                .query((rs, n) -> new EmailVerification(Sql.uuid(rs, "id"), Sql.uuid(rs, "user_id"),
                        rs.getString("code_hash").trim(), Sql.instant(rs, "expires_at"), rs.getInt("attempts"),
                        Sql.instant(rs, "consumed_at")))
                .optional();
    }

    @Override
    public void insert(EmailVerification v, Instant createdAt) {
        jdbc.sql("""
                INSERT INTO email_verifications (id, user_id, code_hash, expires_at, attempts, consumed_at, created_at)
                VALUES (:id, :user, :hash, :exp, :att, :cons, :created)
                """)
                .param("id", v.id()).param("user", v.userId()).param("hash", v.codeHash())
                .param("exp", Sql.ts(v.expiresAt())).param("att", v.attempts()).param("cons", Sql.ts(v.consumedAt()))
                .param("created", Sql.ts(createdAt)).update();
    }

    @Override
    public void update(EmailVerification v) {
        jdbc.sql("UPDATE email_verifications SET attempts = :att, consumed_at = :cons WHERE id = :id")
                .param("att", v.attempts()).param("cons", Sql.ts(v.consumedAt())).param("id", v.id()).update();
    }

    @Override
    public void invalidateAll(UUID userId, Instant now) {
        jdbc.sql("UPDATE email_verifications SET consumed_at = :now WHERE user_id = :id AND consumed_at IS NULL")
                .param("now", Sql.ts(now)).param("id", userId).update();
    }
}
