package com.bandadau.events.domain.registration;

import com.bandadau.events.domain.shared.DomainEvent;
import java.time.Instant;
import java.util.UUID;

public record RegistrationRequested(UUID registrationId, UUID eventId, UUID userId, Instant occurredAt) implements DomainEvent {
}
