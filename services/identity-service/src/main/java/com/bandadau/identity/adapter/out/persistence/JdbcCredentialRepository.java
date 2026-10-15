package com.bandadau.identity.adapter.out.persistence;

import com.bandadau.identity.application.port.out.CredentialRepositoryPort;
import com.bandadau.identity.domain.model.Credential;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;

public class JdbcCredentialRepository implements CredentialRepositoryPort {
    private final JdbcClient jdbc;

    public JdbcCredentialRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public Optional<Credential> findByUserId(UUID userId) {
        return jdbc.sql("SELECT user_id, password_hash, failed_attempts, locked_until FROM credentials WHERE user_id = :id")
                .param("id", userId)
                .query((rs, n) -> new Credential(Sql.uuid(rs, "user_id"), rs.getString("password_hash"),
                        rs.getInt("failed_attempts"), Sql.instant(rs, "locked_until")))
                .optional();
    }

    @Override
    public void save(Credential c) {
        jdbc.sql("""
                INSERT INTO credentials (user_id, password_hash, failed_attempts, locked_until, updated_at)
                VALUES (:id, :hash, :failed, :locked, now())
                ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash,
                    failed_attempts = EXCLUDED.failed_attempts, locked_until = EXCLUDED.locked_until, updated_at = now()
                """)
                .param("id", c.userId()).param("hash", c.passwordHash()).param("failed", c.failedAttempts())
                .param("locked", Sql.ts(c.lockedUntil())).update();
    }
}
