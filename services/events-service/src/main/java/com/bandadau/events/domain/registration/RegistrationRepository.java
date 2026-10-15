package com.bandadau.events.domain.registration;

import com.bandadau.events.domain.event.EventId;
import com.bandadau.events.domain.shared.Page;
import java.util.Optional;
import java.util.UUID;

public interface RegistrationRepository {
    Optional<Registration> findById(RegistrationId id);

    Optional<Registration> findByIdForUpdate(RegistrationId id);

    /** The PENDING/CONFIRMED registration of a user for an event (I3). */
    Optional<Registration> findActive(EventId eventId, UUID userId);

    /** @throws com.bandadau.events.domain.shared.DomainException ALREADY_REGISTERED when the partial unique index trips. */
    void insert(Registration registration);

    void update(Registration registration);

    Page<Registration> listByUser(UUID userId, RegistrationStatus status, String cursor, int limit);

    Page<Registration> listByEvent(EventId eventId, RegistrationStatus status, String cursor, int limit);

    /** Confirmed registrations of an event, for batch cancellation when the event is cancelled. */
    java.util.List<Registration> findConfirmedByEvent(EventId eventId, int limit);

    int countConfirmedByEvent(EventId eventId);
}
