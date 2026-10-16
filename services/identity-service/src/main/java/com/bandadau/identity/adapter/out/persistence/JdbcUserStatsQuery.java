package com.bandadau.identity.adapter.out.persistence;

import com.bandadau.identity.application.port.out.UserStatsQueryPort;
import com.bandadau.identity.domain.model.UserStatus;
import java.time.Instant;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.simple.JdbcClient;

/** Read-only aggregates over {@code users}, {@code refresh_tokens} and {@code universities}. */
public class JdbcUserStatsQuery implements UserStatsQueryPort {
    private final JdbcClient jdbc;

    public JdbcUserStatsQuery(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public Map<UserStatus, Long> countByStatus() {
        Map<UserStatus, Long> out = new EnumMap<>(UserStatus.class);
        jdbc.sql("SELECT status, COUNT(*) AS n FROM users WHERE status <> 'DELETED' GROUP BY status")
                .query((rs, i) -> {
                    out.put(UserStatus.valueOf(rs.getString("status").trim()), rs.getLong("n"));
                    return null;
                }).list();
        return out;
    }

    @Override
    public long countActiveUsers(Instant from, Instant to) {
        return jdbc.sql("""
                SELECT COUNT(DISTINCT r.user_id) FROM refresh_tokens r JOIN users u ON u.id = r.user_id
                 WHERE u.status <> 'DELETED' AND r.created_at >= :from AND r.created_at < :to""")
                .param("from", Sql.ts(from)).param("to", Sql.ts(to)).query(Long.class).single();
    }

    @Override
    public long countCreatedUsers(Instant from, Instant to) {
        return jdbc.sql("SELECT COUNT(*) FROM users WHERE status <> 'DELETED' AND created_at >= :from AND created_at < :to")
                .param("from", Sql.ts(from)).param("to", Sql.ts(to)).query(Long.class).single();
    }

    @Override
    public List<UniversityUsers> usersByUniversity(int limit) {
        return jdbc.sql("""
                SELECT un.id, un.name, COUNT(*) AS n FROM users u JOIN universities un ON un.id = u.university_id
                 WHERE u.status <> 'DELETED' GROUP BY un.id, un.name ORDER BY n DESC, un.name, un.id LIMIT :limit""")
                .param("limit", limit)
                .query((rs, i) -> new UniversityUsers(Sql.uuid(rs, "id"), rs.getString("name"), rs.getLong("n"))).list();
    }
}
