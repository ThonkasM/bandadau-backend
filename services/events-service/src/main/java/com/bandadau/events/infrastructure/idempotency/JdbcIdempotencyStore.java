package com.bandadau.events.infrastructure.idempotency;

import com.bandadau.events.application.port.IdempotencyStore;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.Optional;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

public class JdbcIdempotencyStore implements IdempotencyStore {
    private static final Duration TTL = Duration.ofHours(24);
    private static final Duration LOCK = Duration.ofSeconds(30);

    private record Row(String status, String hash, String principal, Instant lockExpiresAt, Instant expiresAt,
                       Integer responseStatus, String headers, String body) { }

    private final JdbcClient jdbc;
    private final TransactionTemplate tx;
    private final ObjectMapper mapper;
    private final java.time.Clock clock;

    public JdbcIdempotencyStore(JdbcClient jdbc, TransactionTemplate tx, ObjectMapper mapper, java.time.Clock clock) {
        this.jdbc = jdbc;
        this.tx = tx;
        this.mapper = mapper;
        this.clock = clock;
    }

    private static OffsetDateTime ts(Instant i) { return OffsetDateTime.ofInstant(i, ZoneOffset.UTC); }

    @Override
    public Outcome reserve(String key, String requestHash, String principal) {
        return tx.execute(status -> {
            Instant now = clock.instant();
            int inserted = jdbc.sql("""
                    INSERT INTO idempotency_keys (scope_key, status, request_hash, principal, lock_expires_at, expires_at)
                    VALUES (:k, 'IN_PROGRESS', :h, :p, :lock, :exp) ON CONFLICT (scope_key) DO NOTHING
                    """)
                    .param("k", key).param("h", requestHash).param("p", principal)
                    .param("lock", ts(now.plus(LOCK))).param("exp", ts(now.plus(TTL))).update();
            if (inserted == 1) return new Reserved();
            Optional<Row> existing = jdbc.sql("""
                    SELECT status, request_hash, principal, lock_expires_at, expires_at, response_status,
                           response_headers::text AS headers, response_body
                    FROM idempotency_keys WHERE scope_key = :k FOR UPDATE
                    """)
                    .param("k", key)
                    .query((rs, n) -> new Row(rs.getString("status"), rs.getString("request_hash").trim(),
                            rs.getString("principal"), rs.getObject("lock_expires_at", OffsetDateTime.class).toInstant(),
                            rs.getObject("expires_at", OffsetDateTime.class).toInstant(),
                            (Integer) rs.getObject("response_status"), rs.getString("headers"), rs.getString("response_body")))
                    .optional();
            if (existing.isEmpty()) return new InProgress();
            Row row = existing.get();
            if (row.expiresAt().isBefore(now)) {
                jdbc.sql("""
                        UPDATE idempotency_keys SET status = 'IN_PROGRESS', request_hash = :h, principal = :p,
                            lock_expires_at = :lock, expires_at = :exp, response_status = NULL, response_headers = NULL,
                            response_body = NULL, created_at = now() WHERE scope_key = :k
                        """)
                        .param("k", key).param("h", requestHash).param("p", principal)
                        .param("lock", ts(now.plus(LOCK))).param("exp", ts(now.plus(TTL))).update();
                return new Reserved();
            }
            if (!row.hash().equals(requestHash) || !row.principal().equals(principal)) return new KeyReused();
            if ("COMPLETED".equals(row.status())) {
                Map<String, String> headers = row.headers() == null ? Map.of()
                        : mapper.readValue(row.headers(), new TypeReference<Map<String, String>>() { });
                return new Replay(row.responseStatus(), headers, row.body());
            }
            if (row.lockExpiresAt().isBefore(now)) {
                jdbc.sql("UPDATE idempotency_keys SET lock_expires_at = :lock WHERE scope_key = :k")
                        .param("lock", ts(now.plus(LOCK))).param("k", key).update();
                return new Reserved();
            }
            return new InProgress();
        });
    }

    @Override
    public void complete(String key, int status, Map<String, String> headers, String body) {
        jdbc.sql("""
                UPDATE idempotency_keys SET status = 'COMPLETED', response_status = :s,
                    response_headers = CAST(:h AS jsonb), response_body = :b WHERE scope_key = :k
                """)
                .param("s", status).param("h", mapper.writeValueAsString(headers)).param("b", body).param("k", key).update();
    }

    @Override
    public void release(String key) {
        jdbc.sql("DELETE FROM idempotency_keys WHERE scope_key = :k AND status = 'IN_PROGRESS'").param("k", key).update();
    }
}
