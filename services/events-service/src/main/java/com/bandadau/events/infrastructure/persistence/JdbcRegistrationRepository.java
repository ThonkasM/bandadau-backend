package com.bandadau.events.infrastructure.persistence;

import com.bandadau.events.domain.event.Credits;
import com.bandadau.events.domain.event.EventId;
import com.bandadau.events.domain.registration.*;
import com.bandadau.events.domain.shared.Errors;
import com.bandadau.events.domain.shared.Page;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.*;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.simple.JdbcClient;

public class JdbcRegistrationRepository implements RegistrationRepository {
    private static final String COLUMNS = "id, event_id, user_id, status, price_credits, failure_reason, ticket_id, "
            + "idempotency_key, created_at, updated_at, confirmed_at, cancelled_at, version";

    private final JdbcClient jdbc;

    public JdbcRegistrationRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    private static Registration map(ResultSet rs, int n) throws SQLException {
        String reason = rs.getString("failure_reason");
        return Registration.restore(new RegistrationId(Sql.uuid(rs, "id")), new EventId(Sql.uuid(rs, "event_id")),
                Sql.uuid(rs, "user_id"), RegistrationStatus.valueOf(rs.getString("status")),
                new Credits(rs.getLong("price_credits")), reason == null ? null : FailureReason.valueOf(reason),
                Sql.uuid(rs, "ticket_id"), Sql.uuid(rs, "idempotency_key"), Sql.instant(rs, "created_at"),
                Sql.instant(rs, "updated_at"), Sql.instant(rs, "confirmed_at"), Sql.instant(rs, "cancelled_at"),
                rs.getLong("version"));
    }

    @Override
    public Optional<Registration> findById(RegistrationId id) {
        return jdbc.sql("SELECT " + COLUMNS + " FROM registrations WHERE id = :id").param("id", id.value())
                .query(JdbcRegistrationRepository::map).optional();
    }

    @Override
    public Optional<Registration> findByIdForUpdate(RegistrationId id) {
        return jdbc.sql("SELECT " + COLUMNS + " FROM registrations WHERE id = :id FOR UPDATE").param("id", id.value())
                .query(JdbcRegistrationRepository::map).optional();
    }

    @Override
    public Optional<Registration> findActive(EventId eventId, UUID userId) {
        return jdbc.sql("SELECT " + COLUMNS + " FROM registrations WHERE event_id = :e AND user_id = :u "
                        + "AND status IN ('PENDING', 'CONFIRMED')")
                .param("e", eventId.value()).param("u", userId).query(JdbcRegistrationRepository::map).optional();
    }

    @Override
    public void insert(Registration r) {
        try {
            jdbc.sql("""
                    INSERT INTO registrations (id, event_id, user_id, status, price_credits, failure_reason, ticket_id,
                        idempotency_key, version, created_at, updated_at, confirmed_at, cancelled_at)
                    VALUES (:id, :event, :user, :status, :price, :reason, :ticket, :key, 0, :created, :updated, :confirmed, :cancelled)
                    """)
                    .param("id", r.id().value()).param("event", r.eventId().value()).param("user", r.userId())
                    .param("status", r.status().name()).param("price", r.price().value())
                    .param("reason", r.failureReason() == null ? null : r.failureReason().name())
                    .param("ticket", r.ticketId()).param("key", r.idempotencyKey()).param("created", Sql.ts(r.createdAt()))
                    .param("updated", Sql.ts(r.updatedAt())).param("confirmed", Sql.ts(r.confirmedAt()))
                    .param("cancelled", Sql.ts(r.cancelledAt())).update();
        } catch (DuplicateKeyException e) {
            UUID existing = findActive(r.eventId(), r.userId()).map(x -> x.id().value()).orElse(null);
            throw Errors.alreadyRegistered(existing);
        }
    }

    @Override
    public void update(Registration r) {
        int rows = jdbc.sql("""
                UPDATE registrations SET status = :status, failure_reason = :reason, ticket_id = :ticket,
                    updated_at = :updated, confirmed_at = :confirmed, cancelled_at = :cancelled, version = version + 1
                WHERE id = :id AND version = :version
                """)
                .param("status", r.status().name()).param("reason", r.failureReason() == null ? null : r.failureReason().name())
                .param("ticket", r.ticketId()).param("updated", Sql.ts(r.updatedAt()))
                .param("confirmed", Sql.ts(r.confirmedAt())).param("cancelled", Sql.ts(r.cancelledAt()))
                .param("id", r.id().value()).param("version", r.version()).update();
        if (rows == 0) throw Errors.concurrentModification();
    }

    @Override
    public Page<Registration> listByUser(UUID userId, RegistrationStatus status, String cursor, int limit) {
        return page("user_id = :owner", userId, status, cursor, limit);
    }

    @Override
    public Page<Registration> listByEvent(EventId eventId, RegistrationStatus status, String cursor, int limit) {
        return page("event_id = :owner", eventId.value(), status, cursor, limit);
    }

    private Page<Registration> page(String ownerClause, UUID owner, RegistrationStatus status, String cursor, int limit) {
        StringBuilder sql = new StringBuilder("SELECT " + COLUMNS + " FROM registrations WHERE " + ownerClause);
        Map<String, Object> p = new HashMap<>();
        p.put("owner", owner);
        if (status != null) { sql.append(" AND status = :status"); p.put("status", status.name()); }
        List<String> c = Sql.decodeCursor(cursor, 2);
        if (c != null) {
            try {
                p.put("cs", Sql.ts(Instant.parse(c.get(0))));
                p.put("cid", UUID.fromString(c.get(1)));
            } catch (RuntimeException e) {
                throw Errors.invalidCursor();
            }
            sql.append(" AND (created_at, id) < (:cs, :cid)");
        }
        sql.append(" ORDER BY created_at DESC, id DESC LIMIT :limit");
        p.put("limit", limit + 1);
        List<Registration> rows = new ArrayList<>(jdbc.sql(sql.toString()).params(p).query(JdbcRegistrationRepository::map).list());
        String next = null;
        if (rows.size() > limit) {
            rows = new ArrayList<>(rows.subList(0, limit));
            Registration last = rows.get(rows.size() - 1);
            next = Sql.encodeCursor(last.createdAt().toString(), last.id().toString());
        }
        return new Page<>(rows, next);
    }

    @Override
    public List<Registration> findConfirmedByEvent(EventId eventId, int limit) {
        return jdbc.sql("SELECT " + COLUMNS + " FROM registrations WHERE event_id = :e AND status = 'CONFIRMED' ORDER BY id LIMIT :l")
                .param("e", eventId.value()).param("l", limit).query(JdbcRegistrationRepository::map).list();
    }

    @Override
    public int countConfirmedByEvent(EventId eventId) {
        Integer n = jdbc.sql("SELECT count(*) FROM registrations WHERE event_id = :e AND status = 'CONFIRMED'")
                .param("e", eventId.value()).query(Integer.class).single();
        return n == null ? 0 : n;
    }
}
