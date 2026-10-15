package com.bandadau.events.domain.event;

import com.bandadau.events.domain.shared.AggregateRoot;
import com.bandadau.events.domain.shared.Errors;
import java.time.Instant;
import java.util.UUID;

public final class Event extends AggregateRoot<EventId> {
    private final EventId id;
    private final UUID organizerId;
    private final UUID universityId;
    private final String title;
    private final String description;
    private final UUID coverMediaId;
    private final String venue;
    private final EventSchedule schedule;
    private final Capacity capacity;
    private final Credits price;
    private int seatsTaken;
    private EventStatus status;
    private Instant publishedAt;
    private String cancelReason;
    private final Instant createdAt;
    private Instant updatedAt;
    private final long version;

    private Event(EventId id, UUID organizerId, UUID universityId, String title, String description, UUID coverMediaId,
                  String venue, EventSchedule schedule, Capacity capacity, Credits price, int seatsTaken,
                  EventStatus status, Instant publishedAt, String cancelReason, Instant createdAt, Instant updatedAt,
                  long version) {
        this.id = id;
        this.organizerId = organizerId;
        this.universityId = universityId;
        this.title = title;
        this.description = description;
        this.coverMediaId = coverMediaId;
        this.venue = venue;
        this.schedule = schedule;
        this.capacity = capacity;
        this.price = price;
        this.seatsTaken = seatsTaken;
        this.status = status;
        this.publishedAt = publishedAt;
        this.cancelReason = cancelReason;
        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
        this.version = version;
    }

    public static Event create(EventId id, UUID organizerId, UUID universityId, String title, String description,
                               UUID coverMediaId, String venue, EventSchedule schedule, Capacity capacity,
                               Credits price, Instant now) {
        if (!schedule.startsAt().isAfter(now)) throw Errors.startsAtInPast();
        return new Event(id, organizerId, universityId, title, description, coverMediaId, venue, schedule, capacity,
                price, 0, EventStatus.DRAFT, null, null, now, now, 0);
    }

    public static Event restore(EventId id, UUID organizerId, UUID universityId, String title, String description,
                                UUID coverMediaId, String venue, EventSchedule schedule, Capacity capacity,
                                Credits price, int seatsTaken, EventStatus status, Instant publishedAt,
                                String cancelReason, Instant createdAt, Instant updatedAt, long version) {
        return new Event(id, organizerId, universityId, title, description, coverMediaId, venue, schedule, capacity,
                price, seatsTaken, status, publishedAt, cancelReason, createdAt, updatedAt, version);
    }

    /** @return true when the event changed (publishing a PUBLISHED event is a no-op, UC-11 11c). */
    public boolean publish(Instant now) {
        if (status == EventStatus.PUBLISHED) return false;
        if (status != EventStatus.DRAFT) throw Errors.invalidEventStatus(status.name());
        if (!schedule.startsAt().isAfter(now)) throw Errors.startsAtInPast();
        status = EventStatus.PUBLISHED;
        publishedAt = now;
        updatedAt = now;
        register(new EventPublished(id.value(), organizerId, title, schedule.startsAt(), venue, capacity.value(),
                price.value(), now));
        return true;
    }

    public void cancel(String reason, int confirmedRegistrations, Instant now) {
        if (status != EventStatus.DRAFT && status != EventStatus.PUBLISHED) throw Errors.invalidEventStatus(status.name());
        status = EventStatus.CANCELLED;
        cancelReason = reason;
        updatedAt = now;
        register(new EventCancelled(id.value(), organizerId, title, schedule.startsAt(), reason, confirmedRegistrations, now));
    }

    public boolean acceptsRegistrations(Instant now) {
        return status == EventStatus.PUBLISHED && !schedule.hasStarted(now);
    }

    /** I1 + I2: only a PUBLISHED, not yet started event with room accepts a registration. */
    public void reserveSeat(Instant now) {
        if (!acceptsRegistrations(now)) throw Errors.eventNotOpen();
        if (!capacity.allows(seatsTaken)) throw Errors.eventFull();
        seatsTaken++;
        updatedAt = now;
    }

    public void releaseSeat(Instant now) {
        if (seatsTaken == 0) throw new IllegalStateException("seatsTaken already 0 for event " + id);
        seatsTaken--;
        updatedAt = now;
    }

    public boolean isFree() { return price.isFree(); }

    public int seatsAvailable() { return capacity.value() - seatsTaken; }

    @Override public EventId id() { return id; }
    public UUID organizerId() { return organizerId; }
    public UUID universityId() { return universityId; }
    public String title() { return title; }
    public String description() { return description; }
    public UUID coverMediaId() { return coverMediaId; }
    public String venue() { return venue; }
    public EventSchedule schedule() { return schedule; }
    public Capacity capacity() { return capacity; }
    public Credits price() { return price; }
    public int seatsTaken() { return seatsTaken; }
    public EventStatus status() { return status; }
    public Instant publishedAt() { return publishedAt; }
    public String cancelReason() { return cancelReason; }
    public Instant createdAt() { return createdAt; }
    public Instant updatedAt() { return updatedAt; }
    public long version() { return version; }
}
