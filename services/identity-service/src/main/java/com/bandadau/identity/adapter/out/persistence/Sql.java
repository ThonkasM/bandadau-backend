package com.bandadau.identity.adapter.out.persistence;

import com.bandadau.identity.domain.exception.Errors;
import java.nio.charset.StandardCharsets;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.List;
import java.util.UUID;

/** JDBC conversions shared by the persistence adapters. */
final class Sql {
    private Sql() { }

    static OffsetDateTime ts(Instant instant) {
        return instant == null ? null : OffsetDateTime.ofInstant(instant, ZoneOffset.UTC);
    }

    static Instant instant(ResultSet rs, String column) throws SQLException {
        OffsetDateTime value = rs.getObject(column, OffsetDateTime.class);
        return value == null ? null : value.toInstant();
    }

    static UUID uuid(ResultSet rs, String column) throws SQLException {
        return rs.getObject(column, UUID.class);
    }

    static String[] stringArray(ResultSet rs, String column) throws SQLException {
        java.sql.Array array = rs.getArray(column);
        return array == null ? new String[0] : (String[]) array.getArray();
    }

    /** Cursor = base64url parts joined by dots. */
    static String encodeCursor(String... parts) {
        return String.join(".", java.util.Arrays.stream(parts)
                .map(p -> Base64.getUrlEncoder().withoutPadding().encodeToString(p.getBytes(StandardCharsets.UTF_8)))
                .toList());
    }

    static List<String> decodeCursor(String cursor, int expectedParts) {
        if (cursor == null || cursor.isBlank()) return null;
        try {
            List<String> parts = java.util.Arrays.stream(cursor.split("\\.", -1))
                    .map(p -> new String(Base64.getUrlDecoder().decode(p), StandardCharsets.UTF_8)).toList();
            if (parts.size() != expectedParts) throw new IllegalArgumentException();
            return parts;
        } catch (IllegalArgumentException e) {
            throw Errors.invalidInput("INVALID_CURSOR");
        }
    }
}
