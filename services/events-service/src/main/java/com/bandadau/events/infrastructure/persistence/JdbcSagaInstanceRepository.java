package com.bandadau.events.infrastructure.persistence;

import com.bandadau.events.domain.registration.FailureReason;
import com.bandadau.events.domain.registration.RegistrationId;
import com.bandadau.events.domain.saga.*;
import com.bandadau.events.domain.shared.Errors;
import com.bandadau.events.domain.shared.Page;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.simple.JdbcClient;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

public class JdbcSagaInstanceRepository implements SagaInstanceRepository {
    private static final String COLUMNS = "id, registration_id, type, status, step, attempt, deadline_at, next_retry_at, "
            + "context::text AS context, failure_reason, history::text AS history, version, started_at, updated_at, finished_at";

    private final JdbcClient jdbc;
    private final ObjectMapper mapper;

    public JdbcSagaInstanceRepository(JdbcClient jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    private SagaInstance map(ResultSet rs, int n) throws SQLException {
        String reason = rs.getString("failure_reason");
        List<SagaInstance.Transition> history = mapper.readValue(rs.getString("history"),
                new TypeReference<List<SagaInstance.Transition>>() { });
        return SagaInstance.restore(new SagaId(Sql.uuid(rs, "id")), new RegistrationId(Sql.uuid(rs, "registration_id")),
                SagaType.valueOf(rs.getString("type")), SagaStatus.valueOf(rs.getString("status")),
                SagaStep.valueOf(rs.getString("step")), rs.getInt("attempt"), Sql.instant(rs, "deadline_at"),
                Sql.instant(rs, "next_retry_at"), mapper.readValue(rs.getString("context"), SagaContext.class),
                reason == null ? null : FailureReason.valueOf(reason), history, rs.getLong("version"),
                Sql.instant(rs, "started_at"), Sql.instant(rs, "updated_at"), Sql.instant(rs, "finished_at"));
    }

    @Override
    public Optional<SagaInstance> findByIdForUpdate(SagaId id) {
        return jdbc.sql("SELECT " + COLUMNS + " FROM saga_instances WHERE id = :id FOR UPDATE").param("id", id.value())
                .query(this::map).optional();
    }

    @Override
    public Optional<SagaInstance> findById(SagaId id) {
        return jdbc.sql("SELECT " + COLUMNS + " FROM saga_instances WHERE id = :id").param("id", id.value())
                .query(this::map).optional();
    }

    @Override
    public Optional<SagaInstance> findActiveByRegistration(RegistrationId registrationId, SagaType type) {
        return jdbc.sql("SELECT " + COLUMNS + " FROM saga_instances WHERE registration_id = :r AND type = :t "
                        + "AND status NOT IN ('COMPLETED', 'COMPENSATED', 'FAILED')")
                .param("r", registrationId.value()).param("t", type.name()).query(this::map).optional();
    }

    @Override
    public void insert(SagaInstance s) {
        jdbc.sql("""
                INSERT INTO saga_instances (id, registration_id, type, status, step, attempt, deadline_at, next_retry_at,
                    context, failure_reason, history, version, started_at, updated_at, finished_at)
                VALUES (:id, :reg, :type, :status, :step, :attempt, :deadline, :retry, CAST(:ctx AS jsonb), :reason,
                    CAST(:hist AS jsonb), 0, :started, :updated, :finished)
                """)
                .param("id", s.id().value()).param("reg", s.registrationId().value()).param("type", s.type().name())
                .param("status", s.status().name()).param("step", s.step().name()).param("attempt", s.attempt())
                .param("deadline", Sql.ts(s.deadlineAt())).param("retry", Sql.ts(s.nextRetryAt()))
                .param("ctx", mapper.writeValueAsString(s.context())).param("reason", s.failureReason() == null ? null : s.failureReason().name())
                .param("hist", mapper.writeValueAsString(s.history())).param("started", Sql.ts(s.startedAt()))
                .param("updated", Sql.ts(s.updatedAt())).param("finished", Sql.ts(s.finishedAt())).update();
    }

    @Override
    public void update(SagaInstance s) {
        int rows = jdbc.sql("""
                UPDATE saga_instances SET status = :status, step = :step, attempt = :attempt, deadline_at = :deadline,
                    next_retry_at = :retry, context = CAST(:ctx AS jsonb), failure_reason = :reason,
                    history = CAST(:hist AS jsonb), updated_at = :updated, finished_at = :finished, version = version + 1
                WHERE id = :id AND version = :version
                """)
                .param("status", s.status().name()).param("step", s.step().name()).param("attempt", s.attempt())
                .param("deadline", Sql.ts(s.deadlineAt())).param("retry", Sql.ts(s.nextRetryAt()))
                .param("ctx", mapper.writeValueAsString(s.context())).param("reason", s.failureReason() == null ? null : s.failureReason().name())
                .param("hist", mapper.writeValueAsString(s.history())).param("updated", Sql.ts(s.updatedAt()))
                .param("finished", Sql.ts(s.finishedAt())).param("id", s.id().value()).param("version", s.version()).update();
        if (rows == 0) throw Errors.concurrentModification();
    }

    @Override
    public Optional<SagaInstance> lockNextDue(Instant now) {
        return jdbc.sql("SELECT " + COLUMNS + " FROM saga_instances WHERE status NOT IN ('COMPLETED', 'COMPENSATED', 'FAILED') "
                        + "AND (deadline_at <= :now OR next_retry_at <= :now) ORDER BY LEAST(deadline_at, next_retry_at) "
                        + "LIMIT 1 FOR UPDATE SKIP LOCKED")
                .param("now", Sql.ts(now)).query(this::map).optional();
    }

    @Override
    public Page<SagaInstance> list(Collection<SagaStatus> statuses, SagaType type, Instant since, String cursor, int limit) {
        StringBuilder sql = new StringBuilder("SELECT " + COLUMNS + " FROM saga_instances WHERE 1 = 1");
        Map<String, Object> p = new HashMap<>();
        if (statuses != null && !statuses.isEmpty()) {
            sql.append(" AND status IN (:statuses)");
            p.put("statuses", statuses.stream().map(Enum::name).toList());
        }
        if (type != null) { sql.append(" AND type = :type"); p.put("type", type.name()); }
        if (since != null) { sql.append(" AND updated_at >= :since"); p.put("since", Sql.ts(since)); }
        List<String> c = Sql.decodeCursor(cursor, 2);
        if (c != null) {
            try {
                p.put("cs", Sql.ts(Instant.parse(c.get(0))));
                p.put("cid", UUID.fromString(c.get(1)));
            } catch (RuntimeException e) {
                throw Errors.invalidCursor();
            }
            sql.append(" AND (updated_at, id) < (:cs, :cid)");
        }
        sql.append(" ORDER BY updated_at DESC, id DESC LIMIT :limit");
        p.put("limit", limit + 1);
        List<SagaInstance> rows = new ArrayList<>(jdbc.sql(sql.toString()).params(p).query(this::map).list());
        String next = null;
        if (rows.size() > limit) {
            rows = new ArrayList<>(rows.subList(0, limit));
            SagaInstance last = rows.get(rows.size() - 1);
            next = Sql.encodeCursor(last.updatedAt().toString(), last.id().toString());
        }
        return new Page<>(rows, next);
    }

    @Override
    public long countByStatus(SagaStatus status) {
        Long n = jdbc.sql("SELECT count(*) FROM saga_instances WHERE status = :s").param("s", status.name())
                .query(Long.class).single();
        return n == null ? 0 : n;
    }
}
