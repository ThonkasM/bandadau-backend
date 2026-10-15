package com.bandadau.identity.adapter.in.web.dto;

import com.bandadau.identity.application.port.in.Page;
import com.bandadau.identity.domain.model.University;
import java.util.List;
import java.util.Set;
import java.util.UUID;

public final class Responses {
    private Responses() { }

    public record RegisterUserResponse(UUID userId, String email, String status, long verificationExpiresIn) { }

    public record HandoffCodeResponse(String code, String redirectUrl, long expiresIn) { }

    public record ServiceTokenResponse(String accessToken, String tokenType, long expiresIn, Set<String> scopes) { }

    public record UniversityResponse(UUID id, String name, List<String> allowedDomains, boolean enabled) {
        public static UniversityResponse from(University u) {
            return new UniversityResponse(u.id(), u.name(), u.allowedDomains(), u.enabled());
        }
    }

    public record PageResponse<T>(List<T> items, String nextCursor) {
        public static <S, T> PageResponse<T> from(Page<S> page, java.util.function.Function<S, T> mapper) {
            return new PageResponse<>(page.items().stream().map(mapper).toList(), page.nextCursor());
        }
    }

    public record JwksResponse(List<java.util.Map<String, Object>> keys) { }
}
