package com.bandadau.events.application.event;

import java.time.Instant;
import java.util.UUID;

public final class EventCommands {
    private EventCommands() { }

    public record CreateEventCommand(UUID organizerId, UUID universityId, String title, String description,
                                     UUID coverMediaId, Instant startsAt, String venue, int capacity,
                                     long priceCredits, String correlationId) { }
}
