package com.bandadau.events.domain.saga;

import java.util.UUID;

/** What the orchestrator must send next (the idempotencyKey is {@code <sagaId>:<step>}). */
public sealed interface SagaCommand {
    SagaStep step();

    record DebitCredits(long amountCredits) implements SagaCommand {
        @Override public SagaStep step() { return SagaStep.DEBIT_CREDITS; }
    }

    record IssueTicket() implements SagaCommand {
        @Override public SagaStep step() { return SagaStep.ISSUE_TICKET; }
    }

    record VoidTicket(UUID ticketId, CompensationReason reason) implements SagaCommand {
        @Override public SagaStep step() { return SagaStep.VOID_TICKET; }
    }

    record RefundCredits(long amountCredits, CompensationReason reason) implements SagaCommand {
        @Override public SagaStep step() { return SagaStep.REFUND_CREDITS; }
    }
}
