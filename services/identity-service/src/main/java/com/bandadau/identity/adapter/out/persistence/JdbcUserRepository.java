package com.bandadau.identity.adapter.out.persistence;

import com.bandadau.identity.application.port.in.ManageUsersUseCase.UserFilter;
import com.bandadau.identity.application.port.in.Page;
import com.bandadau.identity.application.port.out.UserRepositoryPort;
import com.bandadau.identity.domain.exception.Errors;
import com.bandadau.identity.domain.model.*;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.*;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.simple.JdbcClient;

public class JdbcUserRepository implements UserRepositoryPort {
    private static final String COLUMNS = "id, email, university_id, status, roles, locale, theme, email_verified_at, "
            + "suspended_reason, created_at, updated_at, version";

    private final JdbcClient jdbc;

    public JdbcUserRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    private static User map(ResultSet rs, int row) throws SQLException {
        Set<Role> roles = EnumSet.noneOf(Role.class);
        for (String r : Sql.stringArray(rs, "roles")) roles.add(Role.valueOf(r));
        return new User(Sql.uuid(rs, "id"), Email.of(rs.getString("email")), Sql.uuid(rs, "university_id"),
                UserStatus.valueOf(rs.getString("status")), roles, Language.fromCode(rs.getString("locale")),
                ThemePreference.valueOf(rs.getString("theme")), Sql.instant(rs, "email_verified_at"),
                rs.getString("suspended_reason"), Sql.instant(rs, "created_at"), Sql.instant(rs, "updated_at"),
                rs.getLong("version"));
    }

    private static String[] roleNames(Set<Role> roles) {
        return roles.stream().map(Role::name).sorted().toArray(String[]::new);
    }

    @Override
    public Optional<User> findById(UUID id) {
        return jdbc.sql("SELECT " + COLUMNS + " FROM users WHERE id = :id").param("id", id)
                .query(JdbcUserRepository::map).optional();
    }

    @Override
    public Optional<User> findByEmail(Email email) {
        return jdbc.sql("SELECT " + COLUMNS + " FROM users WHERE lower(email) = :email").param("email", email.value())
                .query(JdbcUserRepository::map).optional();
    }

    @Override
    public void insert(User u) {
        try {
            jdbc.sql("""
                    INSERT INTO users (id, email, university_id, status, roles, locale, theme, email_verified_at,
                                       suspended_reason, version, created_at, updated_at)
                    VALUES (:id, :email, :uni, :status, :roles, :locale, :theme, :verified, :reason, 0, :created, :updated)
                    """)
                    .param("id", u.id()).param("email", u.email().value()).param("uni", u.universityId())
                    .param("status", u.status().name()).param("roles", roleNames(u.roles()))
                    .param("locale", u.language().code()).param("theme", u.theme().name())
                    .param("verified", Sql.ts(u.emailVerifiedAt())).param("reason", u.suspendedReason())
                    .param("created", Sql.ts(u.createdAt())).param("updated", Sql.ts(u.updatedAt())).update();
        } catch (DuplicateKeyException e) {
            throw Errors.emailAlreadyRegistered();
        }
    }

    @Override
    public void update(User u) {
        int rows = jdbc.sql("""
                UPDATE users SET status = :status, roles = :roles, locale = :locale, theme = :theme,
                       email_verified_at = :verified, suspended_reason = :reason, updated_at = :updated,
                       version = version + 1
                WHERE id = :id AND version = :version
                """)
                .param("status", u.status().name()).param("roles", roleNames(u.roles()))
                .param("locale", u.language().code()).param("theme", u.theme().name())
                .param("verified", Sql.ts(u.emailVerifiedAt())).param("reason", u.suspendedReason())
                .param("updated", Sql.ts(u.updatedAt())).param("id", u.id()).param("version", u.version()).update();
        if (rows == 0) throw Errors.concurrentModification();
    }

    @Override
    public boolean existsOtherAdmin(UUID excludedUserId) {
        Integer count = jdbc.sql("SELECT count(*) FROM users WHERE 'ADMIN' = ANY(roles) AND id <> :id AND status <> 'DELETED'")
                .param("id", excludedUserId).query(Integer.class).single();
        return count != null && count > 0;
    }

    @Override
    public void recordRoleChange(UUID userId, UUID actorId, Set<Role> oldRoles, Set<Role> newRoles) {
        jdbc.sql("INSERT INTO role_changes (id, user_id, actor_id, old_roles, new_roles) VALUES (:id, :u, :a, :o, :n)")
                .param("id", UUID.randomUUID()).param("u", userId).param("a", actorId)
                .param("o", roleNames(oldRoles)).param("n", roleNames(newRoles)).update();
    }

    @Override
    public Page<User> search(UserFilter f, String cursor, int limit) {
        StringBuilder sql = new StringBuilder("SELECT " + COLUMNS + " FROM users WHERE 1 = 1");
        Map<String, Object> params = new HashMap<>();
        if (f.emailPrefix() != null && !f.emailPrefix().isBlank()) {
            sql.append(" AND lower(email) LIKE :prefix ESCAPE '\\'");
            params.put("prefix", f.emailPrefix().toLowerCase(Locale.ROOT).replace("\\", "\\\\").replace("%", "\\%")
                    .replace("_", "\\_") + "%");
        }
        if (f.status() != null) { sql.append(" AND status = :status"); params.put("status", f.status().name()); }
        if (f.role() != null) { sql.append(" AND :role = ANY(roles)"); params.put("role", f.role().name()); }
        if (f.universityId() != null) { sql.append(" AND university_id = :uni"); params.put("uni", f.universityId()); }
        if (f.ids() != null && !f.ids().isEmpty()) { sql.append(" AND id IN (:ids)"); params.put("ids", f.ids()); }
        List<String> decoded = Sql.decodeCursor(cursor, 1);
        if (decoded != null) {
            try {
                params.put("after", UUID.fromString(decoded.get(0)));
            } catch (IllegalArgumentException e) {
                throw Errors.invalidInput("INVALID_CURSOR");
            }
            sql.append(" AND id > :after");
        }
        sql.append(" ORDER BY id LIMIT :limit");
        params.put("limit", limit + 1);
        List<User> rows = new ArrayList<>(jdbc.sql(sql.toString()).params(params).query(JdbcUserRepository::map).list());
        String next = null;
        if (rows.size() > limit) {
            rows = new ArrayList<>(rows.subList(0, limit));
            next = Sql.encodeCursor(rows.get(rows.size() - 1).id().toString());
        }
        return new Page<>(rows, next);
    }
}
