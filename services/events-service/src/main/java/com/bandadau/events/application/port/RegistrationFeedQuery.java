package com.bandadau.events.application.port;

import com.bandadau.events.domain.registration.RegistrationStatus;
import com.bandadau.events.domain.shared.Page;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

/** Read model: registrations of every event, newest first (internal feed for insights-service, MCP `list_recent_registrations`). */
public interface RegistrationFeedQuery {

    record Row(UUID id, UUID eventId, String eventTitle, Instant eventStartsAt, Instant eventEndsAt, String venue,
               UUID userId, RegistrationStatus status, String failureReason, long priceCredits, UUID ticketId,
               Instant createdAt, Instant updatedAt, Instant confirmedAt, Instant cancelledAt) { }

    /**
     * {@code from}/{@code to}: inclusive UTC days applied to {@code confirmed_at} when {@code status == CONFIRMED}, else to
     * {@code created_at}; the order (descending, tie-break by id) uses the same column.
     */
    Page<Row> list(LocalDate from, LocalDate to, RegistrationStatus status, UUID eventId, String cursor, int limit);
}
