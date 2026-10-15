package com.bandadau.events.infrastructure.persistence;

import com.bandadau.events.application.port.RegistrationStatsQuery;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.*;
import org.springframework.jdbc.core.simple.JdbcClient;

public class JdbcStatsQuery implements RegistrationStatsQuery {
    private static final String AGG = """
            count(*) FILTER (WHERE r.status IN ('PENDING', 'CANCELLATION_PENDING')) AS pending,
            count(*) FILTER (WHERE r.status = 'CONFIRMED') AS confirmed,
            count(*) FILTER (WHERE r.status = 'FAILED') AS failed,
            count(*) FILTER (WHERE r.status = 'CANCELLED') AS cancelled,
            COALESCE(sum(r.price_credits) FILTER (WHERE r.status IN ('CONFIRMED', 'CANCELLATION_PENDING', 'CANCELLED')), 0) AS collected,
            COALESCE(sum(r.price_credits) FILTER (WHERE r.status = 'CANCELLED'), 0) AS refunded
            """;

    private final JdbcClient jdbc;

    public JdbcStatsQuery(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    private static Counts counts(ResultSet rs) throws SQLException {
        return new Counts(rs.getLong("pending"), rs.getLong("confirmed"), rs.getLong("failed"), rs.getLong("cancelled"),
                rs.getLong("collected"), rs.getLong("refunded"));
    }

    @Override
    public Stats stats(LocalDate from, LocalDate to, String groupBy, UUID eventId) {
        Map<String, Object> p = new HashMap<>();
        p.put("from", Sql.ts(from.atStartOfDay().toInstant(ZoneOffset.UTC)));
        p.put("to", Sql.ts(to.plusDays(1).atStartOfDay().toInstant(ZoneOffset.UTC)));
        String where = " WHERE r.created_at >= :from AND r.created_at < :to";
        if (eventId != null) { where += " AND r.event_id = :event"; p.put("event", eventId); }
        Counts totals = jdbc.sql("SELECT " + AGG + " FROM registrations r" + where).params(p)
                .query((rs, n) -> counts(rs)).single();
        List<Bucket> series;
        if ("event".equals(groupBy)) {
            series = jdbc.sql("SELECT r.event_id::text AS k, e.title AS label, " + AGG
                            + " FROM registrations r JOIN events e ON e.id = r.event_id" + where
                            + " GROUP BY r.event_id, e.title ORDER BY e.title")
                    .params(p).query((rs, n) -> new Bucket(rs.getString("k"), rs.getString("label"), counts(rs))).list();
        } else {
            series = jdbc.sql("SELECT to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS k, " + AGG
                            + " FROM registrations r" + where + " GROUP BY 1 ORDER BY 1")
                    .params(p).query((rs, n) -> new Bucket(rs.getString("k"), rs.getString("k"), counts(rs))).list();
        }
        return new Stats(from, to, groupBy, totals, series);
    }
}
