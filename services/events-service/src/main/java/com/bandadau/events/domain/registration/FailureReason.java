package com.bandadau.events.domain.registration;

/** Stable codes of RegistrationFailureReason (OpenAPI/AsyncAPI). */
public enum FailureReason {
    EVENT_FULL, INSUFFICIENT_FUNDS, WALLET_NOT_FOUND, TICKET_ISSUE_FAILED, TIMEOUT, SAGA_ABORTED;

    /** Maps the wallet's credits-debit-failed reason; anything unknown aborts the saga. */
    public static FailureReason fromWallet(String reason) {
        if (reason == null) return SAGA_ABORTED;
        return switch (reason) {
            case "INSUFFICIENT_FUNDS" -> INSUFFICIENT_FUNDS;
            case "WALLET_NOT_FOUND" -> WALLET_NOT_FOUND;
            default -> SAGA_ABORTED;
        };
    }
}
