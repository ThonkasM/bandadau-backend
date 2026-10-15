package com.bandadau.identity.domain.event;

import com.bandadau.identity.domain.model.*;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;

public record UserRegistered(UUID userId, Email email, UUID universityId, String displayName, Set<Role> roles, Language language, Instant occurredAt) implements DomainEvent {
}
