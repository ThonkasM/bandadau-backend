package com.bandadau.events.interfaces.rest;

import com.bandadau.events.application.event.EventCommands.CreateEventCommand;
import com.bandadau.events.application.event.EventService;
import com.bandadau.events.application.port.MediaCatalog;
import com.bandadau.events.domain.event.Event;
import com.bandadau.events.domain.event.EventId;
import com.bandadau.events.domain.event.EventRepository.EventQuery;
import com.bandadau.events.domain.event.EventStatus;
import com.bandadau.events.domain.shared.Clock;
import com.bandadau.events.domain.shared.Errors;
import com.bandadau.events.domain.shared.Page;
import com.bandadau.events.interfaces.rest.dto.Dtos.*;
import jakarta.validation.Valid;
import java.net.URI;
import java.time.Instant;
import java.util.*;
import org.slf4j.MDC;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/events")
public class EventController {
    private final EventService service;
    private final MediaCatalog media;
    private final Clock clock;

    public EventController(EventService service, MediaCatalog media, Clock clock) {
        this.service = service;
        this.media = media;
        this.clock = clock;
    }

    private EventResponse view(Event e) {
        String url = e.coverMediaId() == null ? null : media.coverUrls(List.of(e.coverMediaId())).get(e.coverMediaId());
        return EventResponse.from(e, url);
    }

    @PostMapping
    public ResponseEntity<EventResponse> createEvent(@Valid @RequestBody CreateEventRequest body, @AuthenticationPrincipal Jwt jwt,
                                                     @RequestHeader("Idempotency-Key") UUID key) {
        Event event = service.create(new CreateEventCommand(Callers.id(jwt), Callers.university(jwt), body.title(),
                body.description(), body.coverMediaId(), body.startsAt(), body.venue(), body.capacity(),
                body.priceCredits(), MDC.get("correlationId")));
        return ResponseEntity.created(URI.create("/api/v1/events/" + event.id())).body(view(event));
    }

    @GetMapping
    public PageResponse<EventResponse> listEvents(@RequestParam(required = false) Instant from,
                                                  @RequestParam(required = false) Instant to,
                                                  @RequestParam(name = "public", defaultValue = "false") boolean publicList,
                                                  @RequestParam(required = false) UUID organizerId,
                                                  @RequestParam(required = false) EventStatus status,
                                                  @RequestParam(required = false) String cursor,
                                                  @RequestParam(defaultValue = "20") int limit,
                                                  @AuthenticationPrincipal Jwt jwt) {
        int max = Limits.check(limit);
        Instant start = from != null ? from : clock.now();
        List<EventStatus> statuses = List.of(EventStatus.PUBLISHED);
        UUID organizer = null;
        if (!publicList && jwt != null) {
            UUID me = Callers.id(jwt);
            if (organizerId != null && organizerId.equals(me)) {
                organizer = me;
                statuses = status == null ? null : List.of(status);
            } else {
                if (status == EventStatus.DRAFT) throw Errors.forbidden();
                organizer = organizerId;
                if (status != null) statuses = List.of(status);
            }
        } else if (organizerId != null) {
            organizer = organizerId;
        }
        Page<Event> page = service.list(new EventQuery(start, to, statuses, organizer), cursor, max);
        List<UUID> covers = page.items().stream().map(Event::coverMediaId).filter(Objects::nonNull).toList();
        Map<UUID, String> urls = media.coverUrls(covers);
        return PageResponse.from(page, e -> EventResponse.from(e, e.coverMediaId() == null ? null : urls.get(e.coverMediaId())));
    }

    @GetMapping("/{eventId}")
    public EventResponse getEvent(@PathVariable UUID eventId, @AuthenticationPrincipal Jwt jwt) {
        return view(service.get(new EventId(eventId), Callers.id(jwt), Callers.has(jwt, "ADMIN")));
    }

    @PostMapping("/{eventId}/publish")
    public EventResponse publishEvent(@PathVariable UUID eventId, @AuthenticationPrincipal Jwt jwt) {
        return view(service.publish(new EventId(eventId), Callers.id(jwt), MDC.get("correlationId")));
    }

    @PostMapping("/{eventId}/cancel")
    public ResponseEntity<EventResponse> cancelEvent(@PathVariable UUID eventId, @Valid @RequestBody CancelEventRequest body,
                                                     @AuthenticationPrincipal Jwt jwt, @RequestHeader("Idempotency-Key") UUID key) {
        Event event = service.cancel(new EventId(eventId), Callers.id(jwt), Callers.has(jwt, "ADMIN"), body.reason(),
                MDC.get("correlationId"));
        return ResponseEntity.status(HttpStatus.ACCEPTED).body(view(event));
    }
}
