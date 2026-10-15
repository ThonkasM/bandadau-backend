package com.bandadau.identity.domain.event;

import com.bandadau.identity.domain.model.*;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;

public record UserRoleChanged(UUID userId, Set<Role> previousRoles, Set<Role> roles, UUID changedBy, Instant occurredAt) implements DomainEvent {
}
