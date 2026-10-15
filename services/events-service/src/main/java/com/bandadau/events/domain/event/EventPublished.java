package com.bandadau.events.domain.event;

import com.bandadau.events.domain.shared.DomainEvent;
import java.time.Instant;
import java.util.UUID;

public record EventPublished(UUID eventId, UUID organizerId, String title, Instant startsAt, String venue, int capacity,
                             long priceCredits, Instant occurredAt) implements DomainEvent {
}
