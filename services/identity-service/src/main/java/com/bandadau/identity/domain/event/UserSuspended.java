package com.bandadau.identity.domain.event;

import com.bandadau.identity.domain.model.*;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;

public record UserSuspended(UUID userId, String reason, UUID suspendedBy, Instant occurredAt) implements DomainEvent {
}
