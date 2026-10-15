package com.bandadau.events.infrastructure.messaging;

import com.bandadau.events.application.saga.RegistrationSagaOrchestrator;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;

/** SagaTimeoutScheduler: resends commands and starts compensations of due sagas (FOR UPDATE SKIP LOCKED per saga). */
public class SagaTimeoutJob {
    private static final Logger log = LoggerFactory.getLogger(SagaTimeoutJob.class);
    private static final int MAX_PER_SWEEP = 100;

    private final RegistrationSagaOrchestrator orchestrator;

    public SagaTimeoutJob(RegistrationSagaOrchestrator orchestrator) {
        this.orchestrator = orchestrator;
    }

    @Scheduled(fixedDelayString = "${bandada.saga.scheduler-interval:PT5S}")
    public void sweep() {
        try {
            for (int i = 0; i < MAX_PER_SWEEP && orchestrator.sweepOne(); i++) {
                // keep going while sagas are due
            }
        } catch (RuntimeException e) {
            log.warn("event=saga.sweep.failed error={}", e.toString());
        }
    }
}
