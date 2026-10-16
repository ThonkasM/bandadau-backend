package com.bandadau.events.infrastructure.persistence;

import com.bandadau.events.application.port.RegistrationFeedQuery;
import com.bandadau.events.domain.registration.RegistrationStatus;
import com.bandadau.events.domain.shared.Errors;
import com.bandadau.events.domain.shared.Page;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;

public class JdbcRegistrationFeedQuery implements RegistrationFeedQuery {
    private final JdbcClient jdbc;

    public JdbcRegistrationFeedQuery(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public Page<Row> list(LocalDate from, LocalDate to, RegistrationStatus status, UUID eventId, String cursor, int limit) {
        // the sort column is chosen from a closed set, never from user input
        String col = status == RegistrationStatus.CONFIRMED ? "r.confirmed_at" : "r.created_at";
        Map<String, Object> p = new HashMap<>();
        StringBuilder sql = new StringBuilder("""
                SELECT r.id, r.event_id, e.title, e.starts_at, e.ends_at, e.venue, r.user_id, r.status, r.failure_reason,
                       r.price_credits, r.ticket_id, r.created_at, r.updated_at, r.confirmed_at, r.cancelled_at
                  FROM registrations r JOIN events e ON e.id = r.event_id WHERE TRUE""");
        if (status != null) { sql.append(" AND r.status = :status"); p.put("status", status.name()); }
        if (status == RegistrationStatus.CONFIRMED) sql.append(" AND r.confirmed_at IS NOT NULL");
        if (eventId != null) { sql.append(" AND r.event_id = :event"); p.put("event", eventId); }
        if (from != null) { sql.append(" AND ").append(col).append(" >= :from"); p.put("from", Sql.ts(from.atStartOfDay().toInstant(ZoneOffset.UTC))); }
        if (to != null) { sql.append(" AND ").append(col).append(" < :to"); p.put("to", Sql.ts(to.plusDays(1).atStartOfDay().toInstant(ZoneOffset.UTC))); }
        List<String> c = Sql.decodeCursor(cursor, 2);
        if (c != null) {
            try {
                p.put("cs", Sql.ts(Instant.parse(c.get(0))));
                p.put("cid", UUID.fromString(c.get(1)));
            } catch (RuntimeException e) {
                throw Errors.invalidCursor();
            }
            sql.append(" AND (").append(col).append(", r.id) < (:cs, :cid)");
        }
        sql.append(" ORDER BY ").append(col).append(" DESC, r.id DESC LIMIT :limit");
        p.put("limit", limit + 1);
        List<Row> rows = new ArrayList<>(jdbc.sql(sql.toString()).params(p).query((rs, n) -> new Row(
                Sql.uuid(rs, "id"), Sql.uuid(rs, "event_id"), rs.getString("title"), Sql.instant(rs, "starts_at"),
                Sql.instant(rs, "ends_at"), rs.getString("venue"), Sql.uuid(rs, "user_id"),
                RegistrationStatus.valueOf(rs.getString("status")), rs.getString("failure_reason"), rs.getLong("price_credits"),
                Sql.uuid(rs, "ticket_id"), Sql.instant(rs, "created_at"), Sql.instant(rs, "updated_at"),
                Sql.instant(rs, "confirmed_at"), Sql.instant(rs, "cancelled_at"))).list());
        String next = null;
        if (rows.size() > limit) {
            rows = new ArrayList<>(rows.subList(0, limit));
            Row last = rows.get(rows.size() - 1);
            Instant key = status == RegistrationStatus.CONFIRMED ? last.confirmedAt() : last.createdAt();
            next = Sql.encodeCursor(key.toString(), last.id().toString());
        }
        return new Page<>(rows, next);
    }
}
