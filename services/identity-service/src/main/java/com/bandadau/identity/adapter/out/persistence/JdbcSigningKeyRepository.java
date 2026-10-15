package com.bandadau.identity.adapter.out.persistence;

import com.bandadau.identity.application.port.out.SigningKeyRepositoryPort;
import com.bandadau.identity.domain.model.SigningKey;
import java.util.List;
import org.springframework.jdbc.core.simple.JdbcClient;

public class JdbcSigningKeyRepository implements SigningKeyRepositoryPort {
    private final JdbcClient jdbc;

    public JdbcSigningKeyRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public List<SigningKey> findAll() {
        return jdbc.sql("""
                SELECT kid, public_jwk::text AS public_jwk, private_key_enc, status, created_at, activated_at, retired_at
                FROM signing_keys ORDER BY created_at
                """)
                .query((rs, n) -> new SigningKey(rs.getString("kid"), rs.getString("public_jwk"),
                        rs.getBytes("private_key_enc"), SigningKey.Status.valueOf(rs.getString("status")),
                        Sql.instant(rs, "created_at"), Sql.instant(rs, "activated_at"), Sql.instant(rs, "retired_at")))
                .list();
    }

    @Override
    public void insert(SigningKey k) {
        jdbc.sql("""
                INSERT INTO signing_keys (kid, public_jwk, private_key_enc, status, created_at, activated_at, retired_at)
                VALUES (:kid, CAST(:jwk AS jsonb), :priv, :status, :created, :activated, :retired)
                """)
                .param("kid", k.kid()).param("jwk", k.publicJwk()).param("priv", k.privateKeyEnc())
                .param("status", k.status().name()).param("created", Sql.ts(k.createdAt()))
                .param("activated", Sql.ts(k.activatedAt())).param("retired", Sql.ts(k.retiredAt())).update();
    }

    @Override
    public void update(SigningKey k) {
        jdbc.sql("UPDATE signing_keys SET status = :status, activated_at = :activated, retired_at = :retired WHERE kid = :kid")
                .param("status", k.status().name()).param("activated", Sql.ts(k.activatedAt()))
                .param("retired", Sql.ts(k.retiredAt())).param("kid", k.kid()).update();
    }
}
