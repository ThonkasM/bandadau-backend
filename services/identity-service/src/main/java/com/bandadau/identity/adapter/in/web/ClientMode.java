package com.bandadau.identity.adapter.in.web;

import com.bandadau.identity.domain.exception.Errors;
import com.bandadau.identity.domain.model.TargetApp;

/** X-Bandada-Client: native keeps the refresh token in the body; web/admin keep it in an HttpOnly cookie. */
enum ClientMode {
    NATIVE(TargetApp.APP, null), WEB(TargetApp.APP, "bandada_rt"), ADMIN(TargetApp.ADMIN, "bandada_admin_rt");

    private final TargetApp target;
    private final String cookieName;

    ClientMode(TargetApp target, String cookieName) {
        this.target = target;
        this.cookieName = cookieName;
    }

    TargetApp target() { return target; }

    boolean usesCookie() { return cookieName != null; }

    String cookieName() { return cookieName; }

    static ClientMode parse(String header) {
        if (header == null || header.isBlank()) return NATIVE;
        return switch (header.trim().toLowerCase(java.util.Locale.ROOT)) {
            case "native" -> NATIVE;
            case "web" -> WEB;
            case "admin" -> ADMIN;
            default -> throw Errors.validation("X-Bandada-Client", "INVALID_FORMAT");
        };
    }
}
