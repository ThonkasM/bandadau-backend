package com.bandadau.events.domain.registration;

import com.bandadau.events.domain.event.Event;
import com.bandadau.events.domain.shared.Errors;
import java.time.Instant;
import java.util.Optional;

/** Rule that spans two aggregates: I2 (open event) and I3 (a single active registration per user and event). */
public final class RegistrationPolicy {
    private RegistrationPolicy() { }

    public static void ensureCanRegister(Event event, Optional<Registration> existing, Instant now) {
        if (!event.acceptsRegistrations(now)) throw Errors.eventNotOpen();
        existing.ifPresent(r -> { throw Errors.alreadyRegistered(r.id().value()); });
    }
}
