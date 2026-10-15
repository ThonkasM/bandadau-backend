package com.bandadau.events.domain.event;

import com.bandadau.events.domain.shared.Errors;
import java.time.Duration;
import java.time.Instant;
import java.util.Objects;

public record EventSchedule(Instant startsAt, Instant endsAt) {
    public EventSchedule {
        Objects.requireNonNull(startsAt);
        Objects.requireNonNull(endsAt);
        if (!startsAt.isBefore(endsAt)) throw Errors.validation("startsAt", "INVALID_FORMAT");
    }

    public boolean hasStarted(Instant now) { return !now.isBefore(startsAt); }

    /** Last instant a registration can still be cancelled (RN-13.1). */
    public Instant cancellationDeadline(Duration cutoff) { return startsAt.minus(cutoff); }
}
