package com.bandadau.events.application.registration;

import com.bandadau.events.application.port.TransactionRunner;
import com.bandadau.events.application.saga.RegistrationSagaOrchestrator;
import com.bandadau.events.domain.event.Event;
import com.bandadau.events.domain.event.EventId;
import com.bandadau.events.domain.event.EventRepository;
import com.bandadau.events.domain.registration.*;
import com.bandadau.events.application.port.IdGenerator;
import com.bandadau.events.domain.saga.CompensationReason;
import com.bandadau.events.domain.saga.SagaInstanceRepository;
import com.bandadau.events.domain.saga.SagaType;
import com.bandadau.events.domain.shared.Clock;
import com.bandadau.events.domain.shared.Errors;
import com.bandadau.events.domain.shared.Page;
import java.time.Duration;
import java.util.Optional;
import java.util.UUID;

/** UC-12 step 1 (local transaction: seat + Registration PENDING + SagaInstance + first command) and UC-13 start. */
public class RegistrationService {
    public record Accepted(Registration registration, Event event) { }

    private final EventRepository events;
    private final RegistrationRepository registrations;
    private final SagaInstanceRepository sagas;
    private final RegistrationSagaOrchestrator orchestrator;
    private final TransactionRunner tx;
    private final Clock clock;
    private final IdGenerator ids;
    private final Duration cancellationCutoff;

    public RegistrationService(EventRepository events, RegistrationRepository registrations,
                               SagaInstanceRepository sagas, RegistrationSagaOrchestrator orchestrator,
                               TransactionRunner tx, Clock clock, IdGenerator ids, Duration cancellationCutoff) {
        this.events = events;
        this.registrations = registrations;
        this.sagas = sagas;
        this.orchestrator = orchestrator;
        this.tx = tx;
        this.clock = clock;
        this.ids = ids;
        this.cancellationCutoff = cancellationCutoff;
    }

    public Accepted register(EventId eventId, UUID userId, UUID idempotencyKey, String correlationId) {
        return tx.run(() -> {
            var now = clock.now();
            Event event = events.findByIdForUpdate(eventId).orElseThrow(Errors::eventNotFound);
            Optional<Registration> existing = registrations.findActive(eventId, userId);
            // A re-execution after a crash between commit and idempotency completion returns the same registration.
            if (existing.isPresent() && idempotencyKey.equals(existing.get().idempotencyKey())) {
                return new Accepted(existing.get(), event);
            }
            RegistrationPolicy.ensureCanRegister(event, existing, now);
            event.reserveSeat(now);
            Registration registration = Registration.request(new RegistrationId(ids.newId()), eventId, userId,
                    event.price(), idempotencyKey, now);
            events.update(event);
            registrations.insert(registration);
            orchestrator.begin(registration, event, SagaType.REGISTRATION, null, correlationId);
            return new Accepted(registrations.findById(registration.id()).orElseThrow(), event);
        });
    }

    public Accepted cancel(RegistrationId id, UUID userId, String correlationId) {
        return tx.run(() -> {
            Registration registration = registrations.findByIdForUpdate(id).filter(r -> r.userId().equals(userId))
                    .orElseThrow(Errors::registrationNotFound);
            Event event = events.findById(registration.eventId()).orElseThrow(Errors::eventNotFound);
            if (registration.status() == RegistrationStatus.CANCELLATION_PENDING) return new Accepted(registration, event);
            registration.requestCancellation(clock.now(), event.schedule().cancellationDeadline(cancellationCutoff));
            registrations.update(registration);
            orchestrator.begin(registration, event, SagaType.CANCELLATION, CompensationReason.USER_CANCELLATION, correlationId);
            return new Accepted(registrations.findById(id).orElseThrow(), event);
        });
    }

    public Accepted get(RegistrationId id, UUID viewerId) {
        Registration registration = registrations.findById(id).filter(r -> r.userId().equals(viewerId))
                .orElseThrow(Errors::registrationNotFound);
        return new Accepted(registration, events.findById(registration.eventId()).orElseThrow());
    }

    public Page<Registration> listMine(UUID userId, RegistrationStatus status, String cursor, int limit) {
        return registrations.listByUser(userId, status, cursor, limit);
    }

    public Page<Registration> listByEvent(EventId eventId, RegistrationStatus status, String cursor, int limit) {
        events.findById(eventId).orElseThrow(Errors::eventNotFound);
        return registrations.listByEvent(eventId, status, cursor, limit);
    }

    public Event event(EventId id) { return events.findById(id).orElseThrow(Errors::eventNotFound); }
}
