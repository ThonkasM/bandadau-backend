package com.bandadau.events.infrastructure.persistence;

import com.bandadau.events.application.port.EventRankingQuery;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;

public class JdbcEventRankingQuery implements EventRankingQuery {
    private final JdbcClient jdbc;

    public JdbcEventRankingQuery(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public List<Row> rank(LocalDate from, LocalDate to, Metric metric, List<UUID> ids, int limit) {
        // the ORDER BY expression comes from a closed set (enum), never from user input
        String order = switch (metric) {
            case REGISTRATIONS -> "COUNT(r.id)";
            case REVENUE -> "COALESCE(SUM(r.price_credits), 0)";
            case FILL_RATE -> "ROUND(COUNT(r.id)::numeric / e.capacity, 4)";
        };
        Map<String, Object> p = new HashMap<>();
        p.put("from", Sql.ts(from.atStartOfDay().toInstant(ZoneOffset.UTC)));
        p.put("to", Sql.ts(to.plusDays(1).atStartOfDay().toInstant(ZoneOffset.UTC)));
        p.put("limit", limit);
        StringBuilder sql = new StringBuilder("""
                SELECT e.id, e.title, e.capacity, COUNT(r.id) AS registrations,
                       COALESCE(SUM(r.price_credits), 0) AS revenue
                  FROM events e
                  LEFT JOIN registrations r ON r.event_id = e.id AND r.status = 'CONFIRMED'
                       AND r.confirmed_at >= :from AND r.confirmed_at < :to
                 WHERE e.status <> 'DRAFT'""");
        if (ids != null) {
            sql.append(" AND e.id IN (:ids)");
            p.put("ids", ids);
        }
        sql.append(" GROUP BY e.id, e.title, e.capacity");
        if (ids == null) sql.append(" HAVING COUNT(r.id) > 0");
        sql.append(" ORDER BY ").append(order).append(" DESC, e.title, e.id LIMIT :limit");
        return jdbc.sql(sql.toString()).params(p).query((rs, n) -> {
            long regs = rs.getLong("registrations");
            int capacity = rs.getInt("capacity");
            long revenue = rs.getLong("revenue");
            BigDecimal value = switch (metric) {
                case REGISTRATIONS -> BigDecimal.valueOf(regs);
                case REVENUE -> BigDecimal.valueOf(revenue);
                case FILL_RATE -> BigDecimal.valueOf(regs).divide(BigDecimal.valueOf(capacity), 4, RoundingMode.HALF_UP);
            };
            return new Row(Sql.uuid(rs, "id"), rs.getString("title"), value, regs, capacity, revenue);
        }).list();
    }
}
