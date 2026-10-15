package com.bandadau.events.domain.saga;

import java.time.Duration;
import java.util.List;

/**
 * Timing rules (decisiones-clave D2/D15): a 30 s window per forward step with business resends at fixed offsets
 * (5/10/20 s); compensations are resent without limit with exponential backoff and alert after {@code alertAfter}.
 */
public record SagaPolicy(Duration stepTimeout, List<Duration> resendOffsets, Duration compensationBackoffBase,
                         Duration compensationBackoffCap, Duration alertAfter) {

    public static SagaPolicy defaults() {
        return new SagaPolicy(Duration.ofSeconds(30),
                List.of(Duration.ofSeconds(5), Duration.ofSeconds(10), Duration.ofSeconds(20)),
                Duration.ofSeconds(5), Duration.ofSeconds(60), Duration.ofMinutes(2));
    }

    public Duration compensationBackoff(int attempt) {
        long factor = 1L << Math.min(Math.max(attempt, 0), 20);
        Duration d = compensationBackoffBase.multipliedBy(factor);
        return d.compareTo(compensationBackoffCap) > 0 ? compensationBackoffCap : d;
    }
}
