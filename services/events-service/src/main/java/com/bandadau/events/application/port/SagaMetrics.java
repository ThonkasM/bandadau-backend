package com.bandadau.events.application.port;

import com.bandadau.events.domain.saga.SagaInstance;
import com.bandadau.events.domain.saga.SagaStep;

public interface SagaMetrics {
    void transition(SagaInstance saga);

    void resend(SagaStep step);

    void compensationStuck(SagaInstance saga);
}
