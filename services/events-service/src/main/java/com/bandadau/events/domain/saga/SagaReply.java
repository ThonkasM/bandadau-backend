package com.bandadau.events.domain.saga;

import java.util.UUID;

/** Responses from wallet-service and ticketing-service, already parsed from their CloudEvents. */
public sealed interface SagaReply {
    record CreditsDebited(UUID ledgerEntryId) implements SagaReply { }

    record CreditsDebitFailed(String reason) implements SagaReply { }

    record CreditsRefunded(long amountCredits) implements SagaReply { }

    record TicketIssued(UUID ticketId) implements SagaReply { }

    record TicketIssueFailed(String reason) implements SagaReply { }

    record TicketVoided(UUID ticketId) implements SagaReply { }

    record TicketVoidFailed(String reason) implements SagaReply { }
}
