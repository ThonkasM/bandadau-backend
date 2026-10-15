package com.bandadau.events.domain.shared;

import java.time.Instant;

public interface DomainEvent {
    Instant occurredAt();
}
