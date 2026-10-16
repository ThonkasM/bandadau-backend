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
        // Counters que solo se crean al primer fallo: se registran en 0 para que los paneles/alertas muestren 0 en vez de «sin datos».
        for (var type : com.bandadau.events.domain.saga.SagaType.values()) {
            registry.counter("saga_compensation_stuck_total", "saga_type", type.name());
        }
        for (var step : SagaStep.values()) {
            registry.counter("saga_step_resends_total", "step", step.name());
        }
    }

    /** Buckets (s) del histograma de duración: la ventana de la SAGA es de 30 s por paso, con compensaciones más largas. */
    private static final Duration[] DURATION_SLO = {Duration.ofMillis(100), Duration.ofMillis(250), Duration.ofMillis(500),
            Duration.ofSeconds(1), Duration.ofSeconds(2), Duration.ofSeconds(5), Duration.ofSeconds(10), Duration.ofSeconds(20),
            Duration.ofSeconds(30), Duration.ofSeconds(60), Duration.ofSeconds(120), Duration.ofMinutes(5)};

    @Override
    public void transition(SagaInstance s) {
        log.info("event=saga.transition sagaId={} type={} status={} step={} attempt={}", s.id(), s.type(), s.status(),
                s.step(), s.attempt());
        if (s.status().isTerminal() && s.finishedAt() != null) {
            Timer.builder("saga_duration_seconds").tag("saga_type", s.type().name()).tag("outcome", s.status().name())
                    .serviceLevelObjectives(DURATION_SLO)
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
