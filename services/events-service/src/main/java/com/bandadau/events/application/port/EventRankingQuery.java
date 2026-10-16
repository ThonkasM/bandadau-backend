package com.bandadau.events.application.port;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/** Read model: ranking of events over their CONFIRMED registrations (internal, MCP `get_event_ranking`; no personal data). */
public interface EventRankingQuery {

    enum Metric { REGISTRATIONS, REVENUE, FILL_RATE }

    /** {@code value} is a count, a credit sum or a 0-1 ratio with 4 decimals depending on the {@link Metric}. */
    record Row(UUID eventId, String title, BigDecimal value, long registrations, int capacity, long revenueCredits) { }

    /**
     * Non-DRAFT events ranked by {@code metric} (descending; ties by title then id) over registrations with
     * {@code confirmed_at} in {@code [from, to + 1 day)} UTC. Without {@code ids} only events with at least one such
     * registration are listed, cut at {@code limit}; with {@code ids} exactly those events are returned (0 registrations included).
     */
    List<Row> rank(LocalDate from, LocalDate to, Metric metric, List<UUID> ids, int limit);
}
