package com.bandadau.events.interfaces.rest;

import com.bandadau.events.domain.shared.Errors;
import java.util.List;
import java.util.UUID;
import org.springframework.security.oauth2.jwt.Jwt;

final class Callers {
    private Callers() { }

    static UUID id(Jwt jwt) { return UUID.fromString(jwt.getSubject()); }

    static boolean has(Jwt jwt, String role) {
        List<String> roles = jwt.getClaimAsStringList("roles");
        return roles != null && roles.contains(role);
    }

    static UUID university(Jwt jwt) {
        String uni = jwt.getClaimAsString("uni");
        if (uni == null) throw Errors.forbidden();
        return UUID.fromString(uni);
    }
}
