package com.bandadau.events.domain.saga;

import com.bandadau.events.domain.registration.RegistrationId;
import com.bandadau.events.domain.shared.Page;
import java.time.Instant;
import java.util.Collection;
import java.util.Optional;

public interface SagaInstanceRepository {
    /** Row lock; requires a transaction. */
    Optional<SagaInstance> findByIdForUpdate(SagaId id);

    Optional<SagaInstance> findById(SagaId id);

    Optional<SagaInstance> findActiveByRegistration(RegistrationId registrationId, SagaType type);

    void insert(SagaInstance saga);

    /** Optimistic update guarded by the version column. */
    void update(SagaInstance saga);

    /** The scheduler's sweep: one due saga, locked with FOR UPDATE SKIP LOCKED. Requires a transaction. */
    Optional<SagaInstance> lockNextDue(Instant now);

    Page<SagaInstance> list(Collection<SagaStatus> statuses, SagaType type, Instant since, String cursor, int limit);

    long countByStatus(SagaStatus status);
}
