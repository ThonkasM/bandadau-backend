package com.bandadau.events.domain.event;

import com.bandadau.events.domain.shared.DomainEvent;
import java.time.Instant;
import java.util.UUID;

public record EventCancelled(UUID eventId, UUID organizerId, String title, Instant startsAt, String reason,
                             int confirmedRegistrations, Instant occurredAt) implements DomainEvent {
}
