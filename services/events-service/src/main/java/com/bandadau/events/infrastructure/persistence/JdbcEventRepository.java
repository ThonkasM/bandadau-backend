package com.bandadau.events.infrastructure.persistence;

import com.bandadau.events.domain.event.*;
import com.bandadau.events.domain.shared.Errors;
import com.bandadau.events.domain.shared.Page;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.simple.JdbcClient;

public class JdbcEventRepository implements EventRepository {
    private static final String COLUMNS = "id, organizer_id, university_id, title, description, cover_media_id, venue, "
            + "starts_at, ends_at, capacity, seats_taken, price_credits, status, published_at, cancel_reason, "
            + "created_at, updated_at, version";

    private final JdbcClient jdbc;

    public JdbcEventRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    private static Event map(ResultSet rs, int n) throws SQLException {
        return Event.restore(new EventId(Sql.uuid(rs, "id")), Sql.uuid(rs, "organizer_id"), Sql.uuid(rs, "university_id"),
                rs.getString("title"), rs.getString("description"), Sql.uuid(rs, "cover_media_id"), rs.getString("venue"),
                new EventSchedule(Sql.instant(rs, "starts_at"), Sql.instant(rs, "ends_at")),
                new Capacity(rs.getInt("capacity")), new Credits(rs.getLong("price_credits")), rs.getInt("seats_taken"),
                EventStatus.valueOf(rs.getString("status")), Sql.instant(rs, "published_at"), rs.getString("cancel_reason"),
                Sql.instant(rs, "created_at"), Sql.instant(rs, "updated_at"), rs.getLong("version"));
    }

    @Override
    public Optional<Event> findById(EventId id) {
        return jdbc.sql("SELECT " + COLUMNS + " FROM events WHERE id = :id").param("id", id.value())
                .query(JdbcEventRepository::map).optional();
    }

    @Override
    public Optional<Event> findByIdForUpdate(EventId id) {
        return jdbc.sql("SELECT " + COLUMNS + " FROM events WHERE id = :id FOR UPDATE").param("id", id.value())
                .query(JdbcEventRepository::map).optional();
    }

    @Override
    public void insert(Event e) {
        jdbc.sql("""
                INSERT INTO events (id, organizer_id, university_id, title, description, cover_media_id, venue, starts_at,
                    ends_at, capacity, seats_taken, price_credits, status, published_at, cancel_reason, version,
                    created_at, updated_at)
                VALUES (:id, :org, :uni, :title, :descr, :cover, :venue, :starts, :ends, :cap, :seats, :price, :status,
                    :published, :cancel, 0, :created, :updated)
                """)
                .param("id", e.id().value()).param("org", e.organizerId()).param("uni", e.universityId())
                .param("title", e.title()).param("descr", e.description()).param("cover", e.coverMediaId())
                .param("venue", e.venue()).param("starts", Sql.ts(e.schedule().startsAt()))
                .param("ends", Sql.ts(e.schedule().endsAt())).param("cap", e.capacity().value())
                .param("seats", e.seatsTaken()).param("price", e.price().value()).param("status", e.status().name())
                .param("published", Sql.ts(e.publishedAt())).param("cancel", e.cancelReason())
                .param("created", Sql.ts(e.createdAt())).param("updated", Sql.ts(e.updatedAt())).update();
    }

    @Override
    public void update(Event e) {
        int rows = jdbc.sql("""
                UPDATE events SET seats_taken = :seats, status = :status, published_at = :published,
                    cancel_reason = :cancel, updated_at = :updated, version = version + 1
                WHERE id = :id AND version = :version
                """)
                .param("seats", e.seatsTaken()).param("status", e.status().name()).param("published", Sql.ts(e.publishedAt()))
                .param("cancel", e.cancelReason()).param("updated", Sql.ts(e.updatedAt())).param("id", e.id().value())
                .param("version", e.version()).update();
        if (rows == 0) throw Errors.concurrentModification();
    }

    @Override
    public Page<Event> list(EventQuery q, String cursor, int limit) {
        StringBuilder sql = new StringBuilder("SELECT " + COLUMNS + " FROM events WHERE 1 = 1");
        Map<String, Object> p = new HashMap<>();
        if (q.startsFrom() != null) { sql.append(" AND starts_at >= :from"); p.put("from", Sql.ts(q.startsFrom())); }
        if (q.startsTo() != null) { sql.append(" AND starts_at < :to"); p.put("to", Sql.ts(q.startsTo())); }
        if (q.statuses() != null && !q.statuses().isEmpty()) {
            sql.append(" AND status IN (:statuses)");
            p.put("statuses", q.statuses().stream().map(Enum::name).toList());
        }
        if (q.organizerId() != null) { sql.append(" AND organizer_id = :org"); p.put("org", q.organizerId()); }
        List<String> c = Sql.decodeCursor(cursor, 2);
        if (c != null) {
            try {
                p.put("cs", Sql.ts(Instant.parse(c.get(0))));
                p.put("cid", UUID.fromString(c.get(1)));
            } catch (RuntimeException e) {
                throw Errors.invalidCursor();
            }
            sql.append(" AND (starts_at, id) > (:cs, :cid)");
        }
        sql.append(" ORDER BY starts_at, id LIMIT :limit");
        p.put("limit", limit + 1);
        List<Event> rows = new ArrayList<>(jdbc.sql(sql.toString()).params(p).query(JdbcEventRepository::map).list());
        String next = null;
        if (rows.size() > limit) {
            rows = new ArrayList<>(rows.subList(0, limit));
            Event last = rows.get(rows.size() - 1);
            next = Sql.encodeCursor(last.schedule().startsAt().toString(), last.id().toString());
        }
        return new Page<>(rows, next);
    }
}
