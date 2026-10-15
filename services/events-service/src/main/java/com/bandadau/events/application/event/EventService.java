package com.bandadau.events.application.event;

import com.bandadau.events.application.event.EventCommands.CreateEventCommand;
import com.bandadau.events.application.port.*;
import com.bandadau.events.application.saga.RegistrationSagaOrchestrator;
import com.bandadau.events.application.saga.SagaMessages;
import com.bandadau.events.domain.event.*;
import com.bandadau.events.domain.registration.Registration;
import com.bandadau.events.domain.registration.RegistrationRepository;
import com.bandadau.events.domain.saga.CompensationReason;
import com.bandadau.events.domain.saga.SagaType;
import com.bandadau.events.domain.shared.Clock;
import com.bandadau.events.domain.shared.DomainEvent;
import com.bandadau.events.domain.shared.Errors;
import com.bandadau.events.domain.shared.Page;
import java.time.Duration;
import java.util.List;
import java.util.UUID;

/** UC-11: create, publish and cancel events; plus the read side of events. */
public class EventService {
    private static final int CANCEL_BATCH = 50;

    private final EventRepository events;
    private final RegistrationRepository registrations;
    private final RegistrationSagaOrchestrator orchestrator;
    private final IntegrationEventOutbox outbox;
    private final MediaCatalog media;
    private final TransactionRunner tx;
    private final Clock clock;
    private final IdGenerator ids;
    private final Duration defaultDuration;

    public EventService(EventRepository events, RegistrationRepository registrations,
                        RegistrationSagaOrchestrator orchestrator, IntegrationEventOutbox outbox, MediaCatalog media,
                        TransactionRunner tx, Clock clock, IdGenerator ids, Duration defaultDuration) {
        this.events = events;
        this.registrations = registrations;
        this.orchestrator = orchestrator;
        this.outbox = outbox;
        this.media = media;
        this.tx = tx;
        this.clock = clock;
        this.ids = ids;
        this.defaultDuration = defaultDuration;
    }

    public Event create(CreateEventCommand c) {
        if (c.coverMediaId() != null) media.ensureApprovedCover(c.coverMediaId(), c.organizerId());
        return tx.run(() -> {
            var now = clock.now();
            // The contract carries no end time: endsAt = startsAt + configured default duration.
            Event event = Event.create(new EventId(ids.newId()), c.organizerId(), c.universityId(), c.title().trim(),
                    c.description(), c.coverMediaId(), c.venue().trim(),
                    new EventSchedule(c.startsAt(), c.startsAt().plus(defaultDuration)), new Capacity(c.capacity()),
                    new Credits(c.priceCredits()), now);
            events.insert(event);
            return event;
        });
    }

    public Event publish(EventId id, UUID actorId, String correlationId) {
        return tx.run(() -> {
            Event event = events.findByIdForUpdate(id).orElseThrow(Errors::eventNotFound);
            if (!event.organizerId().equals(actorId)) throw Errors.notEventOrganizer();
            if (event.publish(clock.now())) {
                events.update(event);
                publishEvents(event, correlationId);
                return events.findById(id).orElseThrow();
            }
            return event;
        });
    }

    /** Organizer or ADMIN. Starts one CANCELLATION saga per CONFIRMED registration, in batches of 50 per transaction. */
    public Event cancel(EventId id, UUID actorId, boolean admin, String reason, String correlationId) {
        tx.runVoid(() -> {
            Event event = events.findByIdForUpdate(id).orElseThrow(Errors::eventNotFound);
            if (!admin && !event.organizerId().equals(actorId)) throw Errors.notEventOrganizer();
            event.cancel(reason, registrations.countConfirmedByEvent(id), clock.now());
            events.update(event);
            publishEvents(event, correlationId);
        });
        boolean more = true;
        while (more) {
            more = tx.run(() -> {
                Event event = events.findById(id).orElseThrow();
                List<Registration> batch = registrations.findConfirmedByEvent(id, CANCEL_BATCH);
                for (Registration r : batch) {
                    Registration locked = registrations.findByIdForUpdate(r.id()).orElseThrow();
                    locked.requestCancellation(clock.now(), null);
                    registrations.update(locked);
                    orchestrator.begin(locked, event, SagaType.CANCELLATION, CompensationReason.EVENT_CANCELLED, correlationId);
                }
                return batch.size() == CANCEL_BATCH;
            });
        }
        return events.findById(id).orElseThrow();
    }

    public Event get(EventId id, UUID viewerId, boolean viewerIsAdmin) {
        Event event = events.findById(id).orElseThrow(Errors::eventNotFound);
        if (event.status() == EventStatus.DRAFT && !viewerIsAdmin && !event.organizerId().equals(viewerId)) {
            throw Errors.eventNotFound();
        }
        return event;
    }

    public Page<Event> list(EventRepository.EventQuery query, String cursor, int limit) {
        return events.list(query, cursor, limit);
    }

    private void publishEvents(Event event, String correlationId) {
        for (DomainEvent e : event.pullEvents()) {
            if (e instanceof EventPublished p) outbox.append(SagaMessages.eventPublished(p, correlationId));
            if (e instanceof EventCancelled c) outbox.append(SagaMessages.eventCancelled(c, correlationId));
        }
    }
}
