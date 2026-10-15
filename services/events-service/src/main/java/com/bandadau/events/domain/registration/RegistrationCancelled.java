package com.bandadau.events.domain.registration;

import com.bandadau.events.domain.shared.DomainEvent;
import java.time.Instant;
import java.util.UUID;

public record RegistrationCancelled(UUID registrationId, UUID eventId, UUID userId, long refundedCredits, Instant occurredAt) implements DomainEvent {
}
