package com.bandadau.identity.adapter.in.web;

import com.bandadau.identity.adapter.in.web.dto.Requests.*;
import com.bandadau.identity.adapter.in.web.dto.Responses.PageResponse;
import com.bandadau.identity.adapter.in.web.dto.Responses.UniversityResponse;
import com.bandadau.identity.adapter.in.web.dto.UserResponse;
import com.bandadau.identity.application.port.in.ManageUniversitiesUseCase;
import com.bandadau.identity.application.port.in.ManageUsersUseCase;
import com.bandadau.identity.application.port.in.ManageUsersUseCase.UserFilter;
import com.bandadau.identity.domain.exception.Errors;
import com.bandadau.identity.domain.model.Role;
import com.bandadau.identity.domain.model.University;
import com.bandadau.identity.domain.model.UserStatus;
import jakarta.validation.Valid;
import java.net.URI;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/** /internal/v1: service-to-service only (typ=service); blocked by the gateway for outside callers. */
@RestController
@RequestMapping("/internal/v1")
public class InternalController {
    private final ManageUsersUseCase users;
    private final ManageUniversitiesUseCase universities;

    public InternalController(ManageUsersUseCase users, ManageUniversitiesUseCase universities) {
        this.users = users;
        this.universities = universities;
    }

    @GetMapping("/users")
    public PageResponse<UserResponse> searchUsers(@RequestParam(required = false) String query,
                                                  @RequestParam(required = false) UserStatus status,
                                                  @RequestParam(required = false) Role role,
                                                  @RequestParam(required = false) UUID universityId,
                                                  @RequestParam(required = false) String ids,
                                                  @RequestParam(required = false) String cursor,
                                                  @RequestParam(defaultValue = "20") int limit) {
        if (query != null && (query.length() < 2 || query.length() > 100)) {
            throw Errors.validation("query", query.length() < 2 ? "TOO_SHORT" : "TOO_LONG");
        }
        List<UUID> idList = ids == null || ids.isBlank() ? null : parseIds(ids);
        return PageResponse.from(users.search(new UserFilter(query, status, role, universityId, idList), cursor,
                Limits.check(limit)), UserResponse::from);
    }

    private static List<UUID> parseIds(String ids) {
        try {
            return Arrays.stream(ids.split(",")).map(String::trim).filter(s -> !s.isEmpty()).map(UUID::fromString)
                    .collect(Collectors.toList());
        } catch (IllegalArgumentException e) {
            throw Errors.validation("ids", "INVALID_FORMAT");
        }
    }

    @PatchMapping("/users/{userId}/roles")
    public UserResponse updateUserRoles(@PathVariable UUID userId, @RequestHeader("X-Actor-Id") UUID actorId,
                                        @Valid @RequestBody UpdateUserRolesRequest body) {
        return UserResponse.from(users.updateRoles(userId,
                body.roles().stream().map(Role::valueOf).collect(Collectors.toSet()), actorId));
    }

    @PatchMapping("/users/{userId}/status")
    public UserResponse updateUserStatus(@PathVariable UUID userId, @RequestHeader("X-Actor-Id") UUID actorId,
                                         @Valid @RequestBody UpdateUserStatusRequest body) {
        UserStatus status = UserStatus.valueOf(body.status());
        if (status == UserStatus.SUSPENDED && (body.reason() == null || body.reason().isBlank())) {
            throw Errors.validation("reason", "REQUIRED");
        }
        return UserResponse.from(users.updateStatus(userId, status, body.reason(), actorId));
    }

    @PostMapping("/universities")
    public ResponseEntity<UniversityResponse> createUniversity(@RequestHeader("X-Actor-Id") UUID actorId,
                                                               @Valid @RequestBody CreateUniversityRequest body) {
        University created = universities.create(body.name(), body.allowedDomains());
        return ResponseEntity.created(URI.create("/internal/v1/universities/" + created.id()))
                .body(UniversityResponse.from(created));
    }

    @PatchMapping("/universities/{universityId}")
    public UniversityResponse updateUniversity(@PathVariable UUID universityId,
                                               @RequestHeader("X-Actor-Id") UUID actorId,
                                               @Valid @RequestBody UpdateUniversityRequest body) {
        if (body.name() == null && body.allowedDomains() == null && body.enabled() == null) {
            throw Errors.validation("name", "REQUIRED");
        }
        if (body.allowedDomains() != null && body.allowedDomains().isEmpty()) {
            throw Errors.validation("allowedDomains", "REQUIRED");
        }
        return UniversityResponse.from(universities.update(universityId, body.name(), body.allowedDomains(), body.enabled()));
    }
}
