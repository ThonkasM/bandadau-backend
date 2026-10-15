package com.bandadau.identity.domain.event;

import com.bandadau.identity.domain.model.*;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;

public record UserPreferencesChanged(UUID userId, Language language, ThemePreference theme, Instant occurredAt) implements DomainEvent {
}
