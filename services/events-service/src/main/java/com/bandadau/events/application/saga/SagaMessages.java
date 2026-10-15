package com.bandadau.events.application.saga;

import com.bandadau.events.application.port.OutboxMessage;
import com.bandadau.events.domain.event.EventCancelled;
import com.bandadau.events.domain.event.EventPublished;
import com.bandadau.events.domain.registration.RegistrationCancelled;
import com.bandadau.events.domain.registration.RegistrationConfirmed;
import com.bandadau.events.domain.registration.RegistrationFailed;
import com.bandadau.events.domain.saga.SagaCommand;
import com.bandadau.events.domain.saga.SagaContext;
import com.bandadau.events.domain.saga.SagaInstance;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/** Builds the AsyncAPI payloads of commands and integration events. */
public final class SagaMessages {
    private SagaMessages() { }

    public static OutboxMessage command(SagaInstance saga, SagaCommand command, UUID causationId) {
        SagaContext ctx = saga.context();
        Map<String, Object> d = new LinkedHashMap<>();
        d.put("sagaId", saga.id().value());
        d.put("registrationId", saga.registrationId().value());
        d.put("idempotencyKey", saga.idempotencyKey(command.step()));
        String type;
        switch (command) {
            case SagaCommand.DebitCredits c -> {
                type = "bandada.wallet.cmd.debit-credits.v1";
                d.put("userId", ctx.userId());
                d.put("eventId", ctx.eventId());
                d.put("amountCredits", c.amountCredits());
                String description = "Inscripción: " + ctx.eventTitle();
                d.put("description", description.length() > 200 ? description.substring(0, 200) : description);
            }
            case SagaCommand.RefundCredits c -> {
                type = "bandada.wallet.cmd.refund-credits.v1";
                d.put("userId", ctx.userId());
                d.put("amountCredits", c.amountCredits());
                d.put("reason", c.reason().name());
            }
            case SagaCommand.IssueTicket c -> {
                type = "bandada.ticketing.cmd.issue-ticket.v1";
                d.put("eventId", ctx.eventId());
                d.put("userId", ctx.userId());
                d.put("eventTitle", ctx.eventTitle());
                d.put("eventStartsAt", ctx.eventStartsAt());
                d.put("venue", ctx.venue());
            }
            case SagaCommand.VoidTicket c -> {
                type = "bandada.ticketing.cmd.void-ticket.v1";
                d.put("ticketId", c.ticketId());
                d.put("reason", c.reason().name());
            }
        }
        d.put("deadlineAt", saga.deadlineAt() == null ? saga.updatedAt().plusSeconds(30) : saga.deadlineAt());
        return new OutboxMessage(OutboxMessage.COMMANDS, type, "registrations/" + saga.registrationId(),
                saga.registrationId().value(), saga.id().value(), causationId, ctx.correlationId(), d);
    }

    public static OutboxMessage registrationConfirmed(SagaInstance saga, RegistrationConfirmed e, UUID causation) {
        Map<String, Object> d = base(saga, e.registrationId(), e.eventId(), e.userId());
        d.put("ticketId", e.ticketId());
        d.put("priceCredits", e.priceCredits());
        d.put("occurredAt", e.occurredAt());
        return event(saga, "bandada.events.registration.confirmed.v1", e.registrationId(), causation, d);
    }

    public static OutboxMessage registrationFailed(SagaInstance saga, RegistrationFailed e, UUID causation) {
        Map<String, Object> d = base(saga, e.registrationId(), e.eventId(), e.userId());
        d.put("reason", e.reason().name());
        d.put("occurredAt", e.occurredAt());
        return event(saga, "bandada.events.registration.failed.v1", e.registrationId(), causation, d);
    }

    public static OutboxMessage registrationCancelled(SagaInstance saga, RegistrationCancelled e, UUID causation) {
        Map<String, Object> d = base(saga, e.registrationId(), e.eventId(), e.userId());
        d.put("refundedCredits", e.refundedCredits());
        d.put("occurredAt", e.occurredAt());
        return event(saga, "bandada.events.registration.cancelled.v1", e.registrationId(), causation, d);
    }

    private static Map<String, Object> base(SagaInstance saga, UUID registrationId, UUID eventId, UUID userId) {
        Map<String, Object> d = new LinkedHashMap<>();
        d.put("registrationId", registrationId);
        d.put("eventId", eventId);
        d.put("userId", userId);
        d.put("sagaId", saga.id().value());
        d.put("eventTitle", saga.context().eventTitle());
        d.put("eventStartsAt", saga.context().eventStartsAt());
        return d;
    }

    private static OutboxMessage event(SagaInstance saga, String type, UUID registrationId, UUID causation, Map<String, Object> d) {
        return new OutboxMessage(OutboxMessage.EVENTS, type, "registrations/" + registrationId, registrationId,
                saga.id().value(), causation, saga.context().correlationId(), d);
    }

    public static OutboxMessage eventPublished(EventPublished e, String correlationId) {
        Map<String, Object> d = new LinkedHashMap<>();
        d.put("eventId", e.eventId());
        d.put("organizerId", e.organizerId());
        d.put("title", e.title());
        d.put("startsAt", e.startsAt());
        d.put("venue", e.venue());
        d.put("capacity", e.capacity());
        d.put("priceCredits", e.priceCredits());
        d.put("occurredAt", e.occurredAt());
        return new OutboxMessage(OutboxMessage.EVENTS, "bandada.events.event.published.v1", "events/" + e.eventId(),
                e.eventId(), null, null, correlationId, d);
    }

    public static OutboxMessage eventCancelled(EventCancelled e, String correlationId) {
        Map<String, Object> d = new LinkedHashMap<>();
        d.put("eventId", e.eventId());
        d.put("organizerId", e.organizerId());
        d.put("title", e.title());
        d.put("startsAt", e.startsAt());
        d.put("reason", e.reason());
        d.put("confirmedRegistrations", e.confirmedRegistrations());
        d.put("occurredAt", e.occurredAt());
        return new OutboxMessage(OutboxMessage.EVENTS, "bandada.events.event.cancelled.v1", "events/" + e.eventId(),
                e.eventId(), null, null, correlationId, d);
    }
}
