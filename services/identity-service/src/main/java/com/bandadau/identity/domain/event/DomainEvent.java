package com.bandadau.identity.domain.event;

import java.time.Instant;

public sealed interface DomainEvent permits UserRegistered, UserRoleChanged, UserSuspended, UserReactivated,
        UserPreferencesChanged {
    Instant occurredAt();
}
