package com.bandadau.events.domain.saga;

public enum SagaStatus {
    STARTED, AWAITING_DEBIT, AWAITING_TICKET, COMPENSATING, COMPLETED, COMPENSATED, FAILED;

    public boolean isTerminal() { return this == COMPLETED || this == COMPENSATED || this == FAILED; }
}
