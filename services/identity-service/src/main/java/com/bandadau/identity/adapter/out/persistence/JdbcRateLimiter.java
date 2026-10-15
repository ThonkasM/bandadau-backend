package com.bandadau.identity.adapter.out.persistence;

import com.bandadau.identity.application.port.out.RateLimitPort;
import java.time.Duration;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;

/**
 * Fixed-window limiter shared by every instance (D-16): one row per key in {@code rate_limit_windows}, updated with an
 * atomic {@code INSERT .. ON CONFLICT DO UPDATE} that uses the database clock, so replicas never disagree about the window.
 * Rows are purged after they expire. If the database is unreachable it fails open (the edge limit of Traefik still applies).
 */
public class JdbcRateLimiter implements RateLimitPort {
    private static final Logger log = LoggerFactory.getLogger(JdbcRateLimiter.class);

    private static final String UPSERT = """
            INSERT INTO rate_limit_windows (limit_key, window_start, hits, expires_at)
            VALUES (:key, clock_timestamp(), 1, clock_timestamp() + make_interval(secs => :secs))
            ON CONFLICT (limit_key) DO UPDATE SET
                hits         = CASE WHEN rate_limit_windows.expires_at <= clock_timestamp() THEN 1
                                    ELSE rate_limit_windows.hits + 1 END,
                window_start = CASE WHEN rate_limit_windows.expires_at <= clock_timestamp() THEN clock_timestamp()
                                    ELSE rate_limit_windows.window_start END,
                expires_at   = CASE WHEN rate_limit_windows.expires_at <= clock_timestamp()
                                    THEN clock_timestamp() + make_interval(secs => :secs)
                                    ELSE rate_limit_windows.expires_at END
            RETURNING hits, CEIL(EXTRACT(EPOCH FROM (expires_at - clock_timestamp())))::bigint AS retry_after
            """;

    private final JdbcClient jdbc;

    public JdbcRateLimiter(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public long check(String key, int max, Duration window) {
        try {
            return jdbc.sql(UPSERT).param("key", key).param("secs", window.toMillis() / 1000.0)
                    .query((rs, row) -> rs.getInt("hits") > max ? Math.max(1, rs.getLong("retry_after")) : 0L).single();
        } catch (RuntimeException e) {
            log.warn("rate limit store unavailable, allowing the call: {}", e.getClass().getSimpleName());
            return 0;
        }
    }

    @Scheduled(fixedDelayString = "PT5M", initialDelayString = "PT1M")
    public void purgeExpired() {
        try {
            jdbc.sql("DELETE FROM rate_limit_windows WHERE expires_at < clock_timestamp() - interval '1 minute'").update();
        } catch (RuntimeException e) {
            log.warn("rate limit purge failed: {}", e.getClass().getSimpleName());
        }
    }
}
