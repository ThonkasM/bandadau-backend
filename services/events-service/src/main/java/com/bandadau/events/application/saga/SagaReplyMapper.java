package com.bandadau.events.application.saga;

import com.bandadau.events.domain.saga.SagaReply;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/** Translates the data of a participant response into a domain {@link SagaReply}. */
public final class SagaReplyMapper {
    private SagaReplyMapper() { }

    public static final String DEBITED = "bandada.wallet.credits-debited.v1";
    public static final String DEBIT_FAILED = "bandada.wallet.credits-debit-failed.v1";
    public static final String REFUNDED = "bandada.wallet.credits-refunded.v1";
    public static final String ISSUED = "bandada.ticketing.ticket-issued.v1";
    public static final String ISSUE_FAILED = "bandada.ticketing.ticket-issue-failed.v1";
    public static final String VOIDED = "bandada.ticketing.ticket-voided.v1";
    public static final String VOID_FAILED = "bandada.ticketing.ticket-void-failed.v1";

    /** @return empty when the type is not a saga response (permanent error for the listener). */
    public static Optional<SagaReply> map(String type, Map<String, Object> data) {
        return Optional.ofNullable(switch (type) {
            case DEBITED -> new SagaReply.CreditsDebited(uuid(data, "ledgerEntryId"));
            case DEBIT_FAILED -> new SagaReply.CreditsDebitFailed(text(data, "reason"));
            case REFUNDED -> new SagaReply.CreditsRefunded(number(data, "amountCredits"));
            case ISSUED -> new SagaReply.TicketIssued(uuid(data, "ticketId"));
            case ISSUE_FAILED -> new SagaReply.TicketIssueFailed(text(data, "reason"));
            case VOIDED -> new SagaReply.TicketVoided(uuid(data, "ticketId"));
            case VOID_FAILED -> new SagaReply.TicketVoidFailed(text(data, "reason"));
            default -> null;
        });
    }

    public static UUID sagaId(Map<String, Object> data) { return uuid(data, "sagaId"); }

    private static UUID uuid(Map<String, Object> d, String key) {
        Object v = d.get(key);
        return v == null ? null : UUID.fromString(String.valueOf(v));
    }

    private static String text(Map<String, Object> d, String key) {
        Object v = d.get(key);
        return v == null ? null : String.valueOf(v);
    }

    private static long number(Map<String, Object> d, String key) {
        Object v = d.get(key);
        return v instanceof Number n ? n.longValue() : 0;
    }
}
