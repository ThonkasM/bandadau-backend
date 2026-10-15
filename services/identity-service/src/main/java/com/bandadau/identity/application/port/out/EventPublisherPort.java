package com.bandadau.identity.application.port.out;

import com.bandadau.identity.domain.event.DomainEvent;

/** Writes the integration event to the transactional outbox (never to the broker directly). */
public interface EventPublisherPort {
    void publish(DomainEvent event);
}
