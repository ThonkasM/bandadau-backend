package com.bandadau.events.infrastructure.persistence;

import com.bandadau.events.domain.shared.Errors;
import java.nio.charset.StandardCharsets;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Arrays;
import java.util.Base64;
import java.util.List;
import java.util.UUID;

final class Sql {
    private Sql() { }

    static OffsetDateTime ts(Instant instant) { return instant == null ? null : OffsetDateTime.ofInstant(instant, ZoneOffset.UTC); }

    static Instant instant(ResultSet rs, String column) throws SQLException {
        OffsetDateTime v = rs.getObject(column, OffsetDateTime.class);
        return v == null ? null : v.toInstant();
    }

    static UUID uuid(ResultSet rs, String column) throws SQLException { return rs.getObject(column, UUID.class); }

    static String encodeCursor(String... parts) {
        return String.join(".", Arrays.stream(parts)
                .map(p -> Base64.getUrlEncoder().withoutPadding().encodeToString(p.getBytes(StandardCharsets.UTF_8))).toList());
    }

    static List<String> decodeCursor(String cursor, int parts) {
        if (cursor == null || cursor.isBlank()) return null;
        try {
            List<String> out = Arrays.stream(cursor.split("\\.", -1))
                    .map(p -> new String(Base64.getUrlDecoder().decode(p), StandardCharsets.UTF_8)).toList();
            if (out.size() != parts) throw new IllegalArgumentException();
            return out;
        } catch (IllegalArgumentException e) {
            throw Errors.invalidCursor();
        }
    }
}
