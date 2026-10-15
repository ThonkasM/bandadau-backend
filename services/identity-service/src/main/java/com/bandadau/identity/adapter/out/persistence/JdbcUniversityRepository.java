package com.bandadau.identity.adapter.out.persistence;

import com.bandadau.identity.application.port.in.Page;
import com.bandadau.identity.application.port.out.UniversityRepositoryPort;
import com.bandadau.identity.domain.exception.Errors;
import com.bandadau.identity.domain.model.University;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.*;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.simple.JdbcClient;

public class JdbcUniversityRepository implements UniversityRepositoryPort {
    private static final String SELECT = """
            SELECT u.id, u.name, u.enabled,
                   COALESCE((SELECT array_agg(d.domain ORDER BY d.domain) FROM university_domains d
                             WHERE d.university_id = u.id), '{}') AS domains
            FROM universities u
            """;

    private final JdbcClient jdbc;

    public JdbcUniversityRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    private static University map(ResultSet rs, int row) throws SQLException {
        return new University(Sql.uuid(rs, "id"), rs.getString("name"), List.of(Sql.stringArray(rs, "domains")),
                rs.getBoolean("enabled"));
    }

    @Override
    public Optional<University> findById(UUID id) {
        return jdbc.sql(SELECT + " WHERE u.id = :id").param("id", id).query(JdbcUniversityRepository::map).optional();
    }

    @Override
    public void insert(University university) {
        try {
            jdbc.sql("INSERT INTO universities (id, name, enabled) VALUES (:id, :name, :enabled)")
                    .param("id", university.id()).param("name", university.name())
                    .param("enabled", university.enabled()).update();
            insertDomains(university);
        } catch (DuplicateKeyException e) {
            throw Errors.universityDomainTaken(String.join(",", university.allowedDomains()));
        }
    }

    @Override
    public void update(University university) {
        try {
            jdbc.sql("UPDATE universities SET name = :name, enabled = :enabled, updated_at = now() WHERE id = :id")
                    .param("name", university.name()).param("enabled", university.enabled())
                    .param("id", university.id()).update();
            jdbc.sql("DELETE FROM university_domains WHERE university_id = :id").param("id", university.id()).update();
            insertDomains(university);
        } catch (DuplicateKeyException e) {
            throw Errors.universityDomainTaken(String.join(",", university.allowedDomains()));
        }
    }

    private void insertDomains(University university) {
        for (String domain : university.allowedDomains()) {
            jdbc.sql("INSERT INTO university_domains (domain, university_id) VALUES (:d, :u)")
                    .param("d", domain).param("u", university.id()).update();
        }
    }

    @Override
    public Page<University> listEnabled(String cursor, int limit) {
        StringBuilder sql = new StringBuilder(SELECT + " WHERE u.enabled");
        Map<String, Object> params = new HashMap<>();
        List<String> decoded = Sql.decodeCursor(cursor, 2);
        if (decoded != null) {
            try {
                params.put("name", decoded.get(0));
                params.put("id", UUID.fromString(decoded.get(1)));
            } catch (IllegalArgumentException e) {
                throw Errors.invalidInput("INVALID_CURSOR");
            }
            sql.append(" AND (u.name, u.id) > (:name, :id)");
        }
        sql.append(" ORDER BY u.name, u.id LIMIT :limit");
        params.put("limit", limit + 1);
        List<University> rows = new ArrayList<>(jdbc.sql(sql.toString()).params(params)
                .query(JdbcUniversityRepository::map).list());
        String next = null;
        if (rows.size() > limit) {
            rows = new ArrayList<>(rows.subList(0, limit));
            University last = rows.get(rows.size() - 1);
            next = Sql.encodeCursor(last.name(), last.id().toString());
        }
        return new Page<>(rows, next);
    }

    @Override
    public List<String> domainsTakenByOthers(List<String> domains, UUID universityId) {
        if (domains.isEmpty()) return List.of();
        String sql = "SELECT domain FROM university_domains WHERE domain IN (:domains)"
                + (universityId == null ? "" : " AND university_id <> :self");
        JdbcClient.StatementSpec spec = jdbc.sql(sql).param("domains", domains);
        if (universityId != null) spec = spec.param("self", universityId);
        return spec.query(String.class).list();
    }
}
