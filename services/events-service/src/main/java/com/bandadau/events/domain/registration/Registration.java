package com.bandadau.events.domain.registration;

import com.bandadau.events.domain.event.Credits;
import com.bandadau.events.domain.event.EventId;
import com.bandadau.events.domain.shared.AggregateRoot;
import com.bandadau.events.domain.shared.Errors;
import java.time.Instant;
import java.util.UUID;

/** I4: PENDING -> CONFIRMED | FAILED; CONFIRMED -> CANCELLATION_PENDING -> CANCELLED (or back to CONFIRMED). */
public final class Registration extends AggregateRoot<RegistrationId> {
    private final RegistrationId id;
    private final EventId eventId;
    private final UUID userId;
    private RegistrationStatus status;
    private final Credits priceSnapshot;
    private FailureReason failureReason;
    private UUID ticketId;
    private final UUID idempotencyKey;
    private final Instant createdAt;
    private Instant updatedAt;
    private Instant confirmedAt;
    private Instant cancelledAt;
    private final long version;

    private Registration(RegistrationId id, EventId eventId, UUID userId, RegistrationStatus status, Credits price,
                         FailureReason failureReason, UUID ticketId, UUID idempotencyKey, Instant createdAt,
                         Instant updatedAt, Instant confirmedAt, Instant cancelledAt, long version) {
        this.id = id;
        this.eventId = eventId;
        this.userId = userId;
        this.status = status;
        this.priceSnapshot = price;
        this.failureReason = failureReason;
        this.ticketId = ticketId;
        this.idempotencyKey = idempotencyKey;
        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
        this.confirmedAt = confirmedAt;
        this.cancelledAt = cancelledAt;
        this.version = version;
    }

    /** RN-12.5: the price is frozen at admission. Aggregates reference each other by id only. */
    public static Registration request(RegistrationId id, EventId eventId, UUID userId, Credits price,
                                       UUID idempotencyKey, Instant now) {
        Registration r = new Registration(id, eventId, userId, RegistrationStatus.PENDING, price, null, null,
                idempotencyKey, now, now, null, null, 0);
        r.register(new RegistrationRequested(id.value(), eventId.value(), userId, now));
        return r;
    }

    public static Registration restore(RegistrationId id, EventId eventId, UUID userId, RegistrationStatus status,
                                       Credits price, FailureReason failureReason, UUID ticketId, UUID idempotencyKey,
                                       Instant createdAt, Instant updatedAt, Instant confirmedAt, Instant cancelledAt,
                                       long version) {
        return new Registration(id, eventId, userId, status, price, failureReason, ticketId, idempotencyKey, createdAt,
                updatedAt, confirmedAt, cancelledAt, version);
    }

    public void confirm(UUID newTicketId, Instant now) {
        require(RegistrationStatus.PENDING);
        status = RegistrationStatus.CONFIRMED;
        ticketId = newTicketId;
        confirmedAt = now;
        updatedAt = now;
        register(new RegistrationConfirmed(id.value(), eventId.value(), userId, newTicketId, priceSnapshot.value(), now));
    }

    public void fail(FailureReason reason, Instant now) {
        require(RegistrationStatus.PENDING);
        status = RegistrationStatus.FAILED;
        failureReason = reason;
        updatedAt = now;
        register(new RegistrationFailed(id.value(), eventId.value(), userId, reason, now));
    }

    /**
     * UC-13: only a CONFIRMED registration, and only until {@code deadline} (startsAt - 24 h), can be cancelled.
     * An event cancelled by its organizer passes {@code deadline = null} (no window).
     */
    public void requestCancellation(Instant now, Instant deadline) {
        if (status != RegistrationStatus.CONFIRMED) throw Errors.invalidRegistrationStatus(status.name());
        if (deadline != null && now.isAfter(deadline)) throw Errors.cancellationWindowClosed();
        status = RegistrationStatus.CANCELLATION_PENDING;
        updatedAt = now;
    }

    public void markCancelled(long refundedCredits, Instant now) {
        require(RegistrationStatus.CANCELLATION_PENDING);
        status = RegistrationStatus.CANCELLED;
        cancelledAt = now;
        updatedAt = now;
        register(new RegistrationCancelled(id.value(), eventId.value(), userId, refundedCredits, now));
    }

    /** The ticket was already USED, so the cancellation is rejected and the registration stays valid. */
    public void revertCancellation(Instant now) {
        require(RegistrationStatus.CANCELLATION_PENDING);
        status = RegistrationStatus.CONFIRMED;
        updatedAt = now;
    }

    /** retrySaga on a FAILED cancellation saga puts the registration back in flight. */
    public void resumeCancellation(Instant now) {
        require(RegistrationStatus.CONFIRMED);
        status = RegistrationStatus.CANCELLATION_PENDING;
        updatedAt = now;
    }

    private void require(RegistrationStatus expected) {
        if (status != expected) throw new IllegalRegistrationTransition(status, expected);
    }

    public static final class IllegalRegistrationTransition extends IllegalStateException {
        public IllegalRegistrationTransition(RegistrationStatus from, RegistrationStatus expected) {
            super("Registration is " + from + " but " + expected + " was required");
        }
    }

    @Override public RegistrationId id() { return id; }
    public EventId eventId() { return eventId; }
    public UUID userId() { return userId; }
    public RegistrationStatus status() { return status; }
    public Credits price() { return priceSnapshot; }
    public FailureReason failureReason() { return failureReason; }
    public UUID ticketId() { return ticketId; }
    public UUID idempotencyKey() { return idempotencyKey; }
    public Instant createdAt() { return createdAt; }
    public Instant updatedAt() { return updatedAt; }
    public Instant confirmedAt() { return confirmedAt; }
    public Instant cancelledAt() { return cancelledAt; }
    public long version() { return version; }
}
