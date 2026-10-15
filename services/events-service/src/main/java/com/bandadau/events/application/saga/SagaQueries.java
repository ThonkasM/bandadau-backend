package com.bandadau.events.application.saga;

import com.bandadau.events.domain.saga.*;
import com.bandadau.events.domain.shared.Page;
import java.time.Instant;
import java.util.Collection;

public class SagaQueries {
    private final SagaInstanceRepository sagas;

    public SagaQueries(SagaInstanceRepository sagas) {
        this.sagas = sagas;
    }

    public Page<SagaInstance> list(Collection<SagaStatus> statuses, SagaType type, Instant since, String cursor, int limit) {
        return sagas.list(statuses, type, since, cursor, limit);
    }
}
