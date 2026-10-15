package com.bandadau.events.domain.event;

import com.bandadau.events.domain.shared.Page;
import java.time.Instant;
import java.util.Collection;
import java.util.Optional;
import java.util.UUID;

public interface EventRepository {
    Optional<Event> findById(EventId id);

    /** Row lock: serializes seat reservations/releases of one event. Requires a transaction. */
    Optional<Event> findByIdForUpdate(EventId id);

    void insert(Event event);

    /** Optimistic update guarded by the version column. */
    void update(Event event);

    Page<Event> list(EventQuery query, String cursor, int limit);

    record EventQuery(Instant startsFrom, Instant startsTo, Collection<EventStatus> statuses, UUID organizerId) { }
}
