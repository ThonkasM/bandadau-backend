package com.bandadau.identity.domain.model;

import com.bandadau.identity.domain.exception.Errors;
import java.util.regex.Pattern;

public record Email(String value) {
    private static final Pattern SHAPE = Pattern.compile("^[^@\\s]+@[^@\\s]+\\.[^@\\s]{2,}$");

    public Email {
        if (value == null) throw Errors.invalidInput("INVALID_FORMAT");
        value = value.trim().toLowerCase(java.util.Locale.ROOT);
        if (value.length() > 254 || !SHAPE.matcher(value).matches()) throw Errors.invalidInput("INVALID_FORMAT");
    }

    public static Email of(String raw) { return new Email(raw); }

    public String domain() { return value.substring(value.indexOf('@') + 1); }

    public String localPart() { return value.substring(0, value.indexOf('@')); }

    @Override
    public String toString() { return value; }
}
