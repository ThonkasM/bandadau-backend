package com.bandadau.identity.domain.exception;

import java.util.LinkedHashMap;
import java.util.Map;

/** Business failure with a stable code; the web adapter maps {@link Kind} to HTTP. */
public class DomainException extends RuntimeException {

    public enum Kind { INVALID, UNAUTHORIZED, FORBIDDEN, NOT_FOUND, CONFLICT, UNPROCESSABLE, TOO_MANY, UNAVAILABLE, NOT_IMPLEMENTED }

    private final String code;
    private final Kind kind;
    private final transient Map<String, Object> params = new LinkedHashMap<>();

    public DomainException(Kind kind, String code) {
        super(code);
        this.kind = kind;
        this.code = code;
    }

    public DomainException with(String key, Object value) {
        params.put(key, value);
        return this;
    }

    public String code() { return code; }

    public Kind kind() { return kind; }

    public Map<String, Object> params() { return params; }
}
