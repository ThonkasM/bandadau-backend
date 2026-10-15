package com.bandadau.identity.adapter.in.web.dto;

import com.bandadau.identity.application.port.in.Session;
import com.fasterxml.jackson.annotation.JsonInclude;

/** refreshToken is omitted for web/admin clients: it travels in an HttpOnly cookie instead. */
public record AuthTokensResponse(String accessToken, @JsonInclude(JsonInclude.Include.NON_NULL) String refreshToken,
                                 String tokenType, long expiresIn, long refreshExpiresIn, UserResponse user) {

    public static AuthTokensResponse from(Session s, boolean includeRefresh) {
        return new AuthTokensResponse(s.accessToken(), includeRefresh ? s.refreshToken() : null, "Bearer",
                s.expiresIn(), s.refreshExpiresIn(), UserResponse.from(s.user()));
    }
}
