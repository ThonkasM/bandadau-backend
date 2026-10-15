package com.bandadau.events.infrastructure.messaging;

import com.bandadau.events.application.port.SagaMetrics;
import com.bandadau.events.domain.saga.SagaInstance;
import com.bandadau.events.domain.saga.SagaStep;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import java.time.Duration;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class MicrometerSagaMetrics implements SagaMetrics {
    private static final Logger log = LoggerFactory.getLogger("saga");
    private final MeterRegistry registry;

    public MicrometerSagaMetrics(MeterRegistry registry) {
        this.registry = registry;
    }

    @Override
    public void transition(SagaInstance s) {
        log.info("event=saga.transition sagaId={} type={} status={} step={} attempt={}", s.id(), s.type(), s.status(),
                s.step(), s.attempt());
        if (s.status().isTerminal() && s.finishedAt() != null) {
            Timer.builder("saga_duration_seconds").tag("saga_type", s.type().name()).tag("outcome", s.status().name())
                    .register(registry).record(Duration.between(s.startedAt(), s.finishedAt()));
        }
        if (s.status() == com.bandadau.events.domain.saga.SagaStatus.COMPENSATING && s.attempt() == 0) {
            registry.counter("saga_compensations_total", "saga_type", s.type().name(), "step", s.step().name(),
                    "reason", s.failureReason() == null ? "NONE" : s.failureReason().name()).increment();
        }
    }

    @Override
    public void resend(SagaStep step) { registry.counter("saga_step_resends_total", "step", step.name()).increment(); }

    @Override
    public void compensationStuck(SagaInstance saga) {
        registry.counter("saga_compensation_stuck_total", "saga_type", saga.type().name()).increment();
    }
}
