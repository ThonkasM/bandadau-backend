package com.bandadau.events.domain.shared;

import java.util.ArrayList;
import java.util.List;

public abstract class AggregateRoot<ID> {
    private final transient List<DomainEvent> domainEvents = new ArrayList<>();

    public abstract ID id();

    protected void register(DomainEvent event) { domainEvents.add(event); }

    /** Returns and clears the events recorded since the aggregate was loaded. */
    public List<DomainEvent> pullEvents() {
        List<DomainEvent> copy = List.copyOf(domainEvents);
        domainEvents.clear();
        return copy;
    }
}
