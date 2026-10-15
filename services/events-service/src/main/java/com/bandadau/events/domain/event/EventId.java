package com.bandadau.events.domain.event;

import java.util.UUID;

public record EventId(UUID value) {
    public EventId { java.util.Objects.requireNonNull(value); }

    @Override
    public String toString() { return value.toString(); }
}
