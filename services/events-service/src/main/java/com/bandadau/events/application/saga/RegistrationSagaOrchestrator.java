package com.bandadau.events.application.saga;

import com.bandadau.events.application.port.*;
import com.bandadau.events.domain.event.Event;
import com.bandadau.events.domain.event.EventRepository;
import com.bandadau.events.domain.event.EventStatus;
import com.bandadau.events.domain.registration.Registration;
import com.bandadau.events.domain.registration.RegistrationRepository;
import com.bandadau.events.domain.saga.*;
import com.bandadau.events.domain.shared.Clock;
import com.bandadau.events.domain.shared.DomainEvent;
import com.bandadau.events.domain.shared.Errors;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Process manager of the registration and cancellation sagas. Every public method runs in a single local
 * transaction (inbox + saga + registration + seat + outbox), so a crash leaves no half-applied step.
 */
public class RegistrationSagaOrchestrator {
    public static final String CONSUMER = "saga-replies";
    private static final Logger log = LoggerFactory.getLogger(RegistrationSagaOrchestrator.class);

    public enum ReplyResult { APPLIED, DUPLICATE, IGNORED, UNKNOWN_SAGA }

    private final SagaInstanceRepository sagas;
    private final RegistrationRepository registrations;
    private final EventRepository events;
    private final IntegrationEventOutbox outbox;
    private final Inbox inbox;
    private final TransactionRunner tx;
    private final Clock clock;
    private final IdGenerator ids;
    private final SagaMetrics metrics;
    private final SagaPolicy policy;

    public RegistrationSagaOrchestrator(SagaInstanceRepository sagas, RegistrationRepository registrations,
                                        EventRepository events, IntegrationEventOutbox outbox, Inbox inbox,
                                        TransactionRunner tx, Clock clock, IdGenerator ids, SagaMetrics metrics,
                                        SagaPolicy policy) {
        this.sagas = sagas;
        this.registrations = registrations;
        this.events = events;
        this.outbox = outbox;
        this.inbox = inbox;
        this.tx = tx;
        this.clock = clock;
        this.ids = ids;
        this.metrics = metrics;
        this.policy = policy;
    }

    /** Joins the caller's transaction: creates the saga for an already persisted registration and emits its first command. */
    public SagaInstance begin(Registration registration, Event event, SagaType type, CompensationReason cancelReason,
                              String correlationId) {
        var now = clock.now();
        SagaContext ctx = SagaContext.initial(event.id().value(), registration.userId(), registration.price().value(),
                event.title(), event.venue(), event.schedule().startsAt(), correlationId, registration.ticketId(), cancelReason);
        SagaInstance saga = SagaInstance.create(new SagaId(ids.newId()), registration.id(), type, ctx, now);
        SagaDecision decision = saga.start(policy, now);
        sagas.insert(saga);
        decision.commands().forEach(c -> outbox.append(SagaMessages.command(saga, c, null)));
        metrics.transition(saga);
        return saga;
    }

    public ReplyResult handleReply(UUID messageId, String type, Map<String, Object> data) {
        return tx.run(() -> {
            if (!inbox.tryMarkProcessed(messageId, CONSUMER)) {
                log.info("event=saga.reply.duplicate messageId={} type={}", messageId, type);
                return ReplyResult.DUPLICATE;
            }
            SagaReply reply = SagaReplyMapper.map(type, data).orElseThrow(() -> new IllegalArgumentException("Unknown saga reply " + type));
            UUID sagaId = SagaReplyMapper.sagaId(data);
            Optional<SagaInstance> found = sagaId == null ? Optional.empty() : sagas.findByIdForUpdate(new SagaId(sagaId));
            if (found.isEmpty()) {
                log.warn("event=saga.reply.unknown_saga sagaId={} type={}", sagaId, type);
                return ReplyResult.UNKNOWN_SAGA;
            }
            SagaInstance saga = found.get();
            SagaDecision decision = saga.onReply(reply, messageId, policy, clock.now());
            if (decision.ignored()) {
                log.info("event=saga.reply.ignored sagaId={} type={} status={}", saga.id(), type, saga.status());
                return ReplyResult.IGNORED;
            }
            apply(saga, decision, messageId);
            return ReplyResult.APPLIED;
        });
    }

    /** One scheduler step: locks a due saga (SKIP LOCKED) and applies its timeout. @return false when none was due. */
    public boolean sweepOne() {
        return tx.run(() -> {
            Optional<SagaInstance> due = sagas.lockNextDue(clock.now());
            if (due.isEmpty()) return false;
            SagaInstance saga = due.get();
            SagaDecision decision = saga.onTimeout(policy, clock.now());
            decision.commands().forEach(c -> metrics.resend(c.step()));
            apply(saga, decision, null);
            return true;
        });
    }

    public SagaInstance retry(SagaId id, UUID actorId) {
        return tx.run(() -> {
            SagaInstance saga = sagas.findByIdForUpdate(id).orElseThrow(Errors::sagaNotFound);
            SagaDecision decision = saga.retry(policy, clock.now());
            log.info("event=saga.retry sagaId={} actorId={} status={}", id, actorId, saga.status());
            if (decision.commands().isEmpty() && decision.outcome().type() == SagaDecision.OutcomeType.NONE) return saga;
            apply(saga, decision, null);
            return saga;
        });
    }

    private void apply(SagaInstance saga, SagaDecision decision, UUID causation) {
        var now = clock.now();
        sagas.update(saga);
        if (decision.alert()) {
            metrics.compensationStuck(saga);
            log.warn("event=saga.compensation.stuck sagaId={} step={} correlationId={}", saga.id(), saga.step(),
                    saga.context().correlationId());
        }
        var outcome = decision.outcome();
        if (outcome.type() != SagaDecision.OutcomeType.NONE) {
            Registration reg = registrations.findByIdForUpdate(saga.registrationId()).orElseThrow();
            Event lateCancelledEvent = null;
            switch (outcome.type()) {
                case CONFIRM -> {
                    reg.confirm(outcome.ticketId(), now);
                    Event event = events.findByIdForUpdate(reg.eventId()).orElseThrow();
                    if (event.status() == EventStatus.CANCELLED) {
                        // The event was cancelled while this registration was in flight: undo it right away.
                        lateCancelledEvent = event;
                    }
                }
                case FAIL -> reg.fail(outcome.reason(), now);
                case CANCELLED -> reg.markCancelled(outcome.refundedCredits(), now);
                case CANCELLATION_REJECTED -> reg.revertCancellation(now);
                case CANCELLATION_RESUMED -> reg.resumeCancellation(now);
                default -> { }
            }
            if (lateCancelledEvent == null) registrations.update(reg);
            for (DomainEvent e : reg.pullEvents()) {
                switch (e) {
                    case com.bandadau.events.domain.registration.RegistrationConfirmed c ->
                            outbox.append(SagaMessages.registrationConfirmed(saga, c, causation));
                    case com.bandadau.events.domain.registration.RegistrationFailed f ->
                            outbox.append(SagaMessages.registrationFailed(saga, f, causation));
                    case com.bandadau.events.domain.registration.RegistrationCancelled c ->
                            outbox.append(SagaMessages.registrationCancelled(saga, c, causation));
                    default -> { }
                }
            }
            if (decision.releasesSeat()) {
                Event event = events.findByIdForUpdate(reg.eventId()).orElseThrow();
                event.releaseSeat(now);
                events.update(event);
            }
            if (lateCancelledEvent != null) {
                reg.requestCancellation(now, null);
                registrations.update(reg);
                startCancellation(reg, lateCancelledEvent, saga.context().correlationId());
            }
        }
        decision.commands().forEach(c -> outbox.append(SagaMessages.command(saga, c, causation)));
        metrics.transition(saga);
    }

    private void startCancellation(Registration reg, Event event, String correlationId) {
        begin(reg, event, SagaType.CANCELLATION, CompensationReason.EVENT_CANCELLED, correlationId);
    }

    public SagaPolicy policy() { return policy; }
}
