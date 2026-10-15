package com.bandadau.identity.adapter.out.persistence;

import com.bandadau.identity.application.port.out.HandoffCodeRepositoryPort;
import com.bandadau.identity.domain.model.HandoffCode;
import com.bandadau.identity.domain.model.TargetApp;
import java.time.Instant;
import java.util.Optional;
import org.springframework.jdbc.core.simple.JdbcClient;

public class JdbcHandoffCodeRepository implements HandoffCodeRepositoryPort {
    private final JdbcClient jdbc;

    public JdbcHandoffCodeRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public void insert(HandoffCode c, Instant createdAt) {
        jdbc.sql("""
                INSERT INTO handoff_codes (code_hash, user_id, target_app, code_challenge, expires_at, created_ip, created_at)
                VALUES (:hash, :user, :target, :challenge, :exp, :ip, :created)
                """)
                .param("hash", c.codeHash()).param("user", c.userId()).param("target", c.targetApp().name())
                .param("challenge", c.codeChallenge()).param("exp", Sql.ts(c.expiresAt()))
                .param("ip", c.createdIp()).param("created", Sql.ts(createdAt)).update();
    }

    @Override
    public Optional<HandoffCode> consume(String codeHash, Instant now) {
        return jdbc.sql("""
                UPDATE handoff_codes SET used_at = :now
                WHERE code_hash = :hash AND used_at IS NULL AND expires_at > :now
                RETURNING code_hash, user_id, target_app, code_challenge, expires_at, used_at, created_ip
                """)
                .param("now", Sql.ts(now)).param("hash", codeHash)
                .query((rs, n) -> new HandoffCode(rs.getString("code_hash").trim(), Sql.uuid(rs, "user_id"),
                        TargetApp.valueOf(rs.getString("target_app")), rs.getString("code_challenge"),
                        Sql.instant(rs, "expires_at"), Sql.instant(rs, "used_at"), rs.getString("created_ip")))
                .optional();
    }
}
