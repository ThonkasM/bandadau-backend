package com.bandadau.identity.domain.event;

import com.bandadau.identity.domain.model.*;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;

public record UserReactivated(UUID userId, UUID reactivatedBy, Instant occurredAt) implements DomainEvent {
}
