package com.bandadau.events.domain.registration;

import com.bandadau.events.domain.shared.DomainEvent;
import java.time.Instant;
import java.util.UUID;

public record RegistrationConfirmed(UUID registrationId, UUID eventId, UUID userId, UUID ticketId, long priceCredits, Instant occurredAt) implements DomainEvent {
}
