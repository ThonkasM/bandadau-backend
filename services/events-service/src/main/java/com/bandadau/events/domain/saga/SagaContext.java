package com.bandadau.events.domain.saga;

import java.time.Instant;
import java.util.UUID;

/** Snapshot of the data the saga needs (events can change while a saga runs: RN-12.5). Persisted as JSONB. */
public record SagaContext(UUID eventId, UUID userId, long priceCredits, String eventTitle, String venue,
                          Instant eventStartsAt, String correlationId, boolean debited, UUID ticketId,
                          UUID ledgerEntryId, CompensationReason cancelReason, Instant stepStartedAt,
                          Instant compensationStartedAt, boolean alerted, long refundedCredits,
                          UUID organizerId, Instant eventEndsAt) {

    public static SagaContext initial(UUID eventId, UUID userId, long priceCredits, String eventTitle, String venue,
                                      Instant eventStartsAt, String correlationId, UUID ticketId,
                                      CompensationReason cancelReason, UUID organizerId, Instant eventEndsAt) {
        return new SagaContext(eventId, userId, priceCredits, eventTitle, venue, eventStartsAt, correlationId, false,
                ticketId, null, cancelReason, null, null, false, 0, organizerId, eventEndsAt);
    }

    SagaContext debited(UUID ledgerEntry) {
        return new SagaContext(eventId, userId, priceCredits, eventTitle, venue, eventStartsAt, correlationId, true,
                ticketId, ledgerEntry, cancelReason, stepStartedAt, compensationStartedAt, alerted, refundedCredits, organizerId, eventEndsAt);
    }

    SagaContext stepStarted(Instant at) {
        return new SagaContext(eventId, userId, priceCredits, eventTitle, venue, eventStartsAt, correlationId, debited,
                ticketId, ledgerEntryId, cancelReason, at, compensationStartedAt, alerted, refundedCredits, organizerId, eventEndsAt);
    }

    SagaContext compensationStarted(Instant at) {
        return new SagaContext(eventId, userId, priceCredits, eventTitle, venue, eventStartsAt, correlationId, debited,
                ticketId, ledgerEntryId, cancelReason, stepStartedAt, compensationStartedAt == null ? at : compensationStartedAt,
                alerted, refundedCredits, organizerId, eventEndsAt);
    }

    SagaContext markAlerted() {
        return new SagaContext(eventId, userId, priceCredits, eventTitle, venue, eventStartsAt, correlationId, debited,
                ticketId, ledgerEntryId, cancelReason, stepStartedAt, compensationStartedAt, true, refundedCredits, organizerId, eventEndsAt);
    }

    SagaContext refunded(long amount) {
        return new SagaContext(eventId, userId, priceCredits, eventTitle, venue, eventStartsAt, correlationId, debited,
                ticketId, ledgerEntryId, cancelReason, stepStartedAt, compensationStartedAt, alerted, amount, organizerId, eventEndsAt);
    }

    SagaContext withTicket(UUID ticket) {
        return new SagaContext(eventId, userId, priceCredits, eventTitle, venue, eventStartsAt, correlationId, debited,
                ticket, ledgerEntryId, cancelReason, stepStartedAt, compensationStartedAt, alerted, refundedCredits, organizerId, eventEndsAt);
    }

    public boolean free() { return priceCredits == 0; }
}
