package com.bandadau.identity.application.port.out;

import java.time.Duration;

/** Fixed-window rate limiter. Implementations: in memory (per instance) or PostgreSQL (shared by all instances). */
public interface RateLimitPort {

    /** @return seconds to wait when the limit is exceeded, or 0 when the call is allowed. */
    long check(String key, int max, Duration window);
}
