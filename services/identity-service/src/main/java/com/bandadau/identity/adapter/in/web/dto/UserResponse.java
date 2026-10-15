package com.bandadau.identity.adapter.in.web.dto;

import com.bandadau.identity.domain.model.Role;
import com.bandadau.identity.domain.model.User;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record UserResponse(UUID id, String email, UUID universityId, String status, List<String> roles, String locale,
                           String theme, Instant emailVerifiedAt, Instant createdAt, Instant updatedAt) {

    public static UserResponse from(User u) {
        return new UserResponse(u.id(), u.email().value(), u.universityId(), u.status().name(),
                u.roles().stream().map(Role::name).sorted().toList(), u.language().code(), u.theme().name(),
                u.emailVerifiedAt(), u.createdAt(), u.updatedAt());
    }
}
