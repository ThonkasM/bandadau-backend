package com.bandadau.events.domain.saga;

import com.bandadau.events.domain.registration.FailureReason;
import java.util.List;
import java.util.UUID;

/** Pure result of a transition: commands to emit and what happens to the registration/seat. */
public record SagaDecision(List<SagaCommand> commands, Outcome outcome, boolean ignored, boolean alert) {

    public enum OutcomeType {
        /** Nothing changes for the registration. */
        NONE,
        /** Registration CONFIRMED. */
        CONFIRM,
        /** Registration FAILED and the seat is released. */
        FAIL,
        /** Registration CANCELLED and the seat is released. */
        CANCELLED,
        /** Ticket already used: the registration goes back to CONFIRMED. */
        CANCELLATION_REJECTED,
        /** A FAILED cancellation was re-driven: the registration is CANCELLATION_PENDING again. */
        CANCELLATION_RESUMED
    }

    public record Outcome(OutcomeType type, UUID ticketId, FailureReason reason, long refundedCredits) {
        static final Outcome NONE = new Outcome(OutcomeType.NONE, null, null, 0);
    }

    static SagaDecision none() { return new SagaDecision(List.of(), Outcome.NONE, false, false); }

    static SagaDecision ignore() { return new SagaDecision(List.of(), Outcome.NONE, true, false); }

    static SagaDecision send(SagaCommand command) { return new SagaDecision(List.of(command), Outcome.NONE, false, false); }

    static SagaDecision alertOnly() { return new SagaDecision(List.of(), Outcome.NONE, false, true); }

    static SagaDecision confirm(UUID ticketId) {
        return new SagaDecision(List.of(), new Outcome(OutcomeType.CONFIRM, ticketId, null, 0), false, false);
    }

    static SagaDecision fail(FailureReason reason) {
        return new SagaDecision(List.of(), new Outcome(OutcomeType.FAIL, null, reason, 0), false, false);
    }

    static SagaDecision cancelled(long refunded) {
        return new SagaDecision(List.of(), new Outcome(OutcomeType.CANCELLED, null, null, refunded), false, false);
    }

    static SagaDecision rejected() {
        return new SagaDecision(List.of(), new Outcome(OutcomeType.CANCELLATION_REJECTED, null, null, 0), false, false);
    }

    static SagaDecision resumed(SagaCommand command) {
        return new SagaDecision(List.of(command), new Outcome(OutcomeType.CANCELLATION_RESUMED, null, null, 0), false, false);
    }

    public boolean releasesSeat() {
        return outcome.type() == OutcomeType.FAIL || outcome.type() == OutcomeType.CANCELLED;
    }
}
