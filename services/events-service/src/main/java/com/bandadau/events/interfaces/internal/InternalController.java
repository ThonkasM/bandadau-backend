package com.bandadau.events.interfaces.internal;

import com.bandadau.events.application.port.EventRankingQuery;
import com.bandadau.events.application.port.MediaCatalog;
import com.bandadau.events.application.port.RegistrationFeedQuery;
import com.bandadau.events.application.port.RegistrationStatsQuery;
import com.bandadau.events.application.port.RegistrationStatsQuery.Counts;
import com.bandadau.events.application.registration.RegistrationService;
import com.bandadau.events.application.saga.RegistrationSagaOrchestrator;
import com.bandadau.events.application.saga.SagaQueries;
import com.bandadau.events.application.stats.EventRankingService;
import com.bandadau.events.application.event.EventService;
import com.bandadau.events.domain.event.Event;
import com.bandadau.events.domain.event.EventId;
import com.bandadau.events.domain.event.EventRepository.EventQuery;
import com.bandadau.events.domain.event.EventStatus;
import com.bandadau.events.domain.registration.RegistrationStatus;
import com.bandadau.events.domain.saga.SagaId;
import com.bandadau.events.domain.saga.SagaStatus;
import com.bandadau.events.domain.saga.SagaType;
import com.bandadau.events.domain.shared.Errors;
import com.bandadau.events.interfaces.rest.dto.Dtos.*;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/** /internal/v1: service-to-service (typ=service). */
@RestController
@RequestMapping("/internal/v1")
public class InternalController {
    private final SagaQueries sagaQueries;
    private final RegistrationSagaOrchestrator orchestrator;
    private final EventService events;
    private final RegistrationService registrations;
    private final RegistrationStatsQuery stats;
    private final MediaCatalog media;
    private final RegistrationFeedQuery feed;
    private final EventRankingService ranking;

    public InternalController(SagaQueries sagaQueries, RegistrationSagaOrchestrator orchestrator, EventService events,
                              RegistrationService registrations, RegistrationStatsQuery stats, MediaCatalog media,
                              RegistrationFeedQuery feed, EventRankingService ranking) {
        this.sagaQueries = sagaQueries;
        this.orchestrator = orchestrator;
        this.events = events;
        this.registrations = registrations;
        this.stats = stats;
        this.media = media;
        this.feed = feed;
        this.ranking = ranking;
    }

    private static int limit(int limit) {
        if (limit < 1) throw Errors.validation("limit", "TOO_SMALL");
        if (limit > 50) throw Errors.validation("limit", "TOO_LARGE");
        return limit;
    }

    @GetMapping("/sagas")
    public PageResponse<SagaResponse> listSagas(@RequestParam(required = false) List<SagaStatus> status,
                                                @RequestParam(required = false) SagaType type,
                                                @RequestParam(required = false) Instant since,
                                                @RequestParam(required = false) String cursor,
                                                @RequestParam(defaultValue = "20") int limit) {
        return PageResponse.from(sagaQueries.list(status, type, since, cursor, limit(limit)), SagaResponse::from);
    }

    @PostMapping("/sagas/{sagaId}/retry")
    public ResponseEntity<SagaResponse> retrySaga(@PathVariable UUID sagaId, @RequestHeader("X-Actor-Id") UUID actorId) {
        return ResponseEntity.status(HttpStatus.ACCEPTED).body(SagaResponse.from(orchestrator.retry(new SagaId(sagaId), actorId)));
    }

    @GetMapping("/events")
    public PageResponse<EventResponse> listEventsInternal(@RequestParam(required = false) Instant startsFrom,
                                                          @RequestParam(required = false) Instant startsTo,
                                                          @RequestParam(required = false) List<EventStatus> status,
                                                          @RequestParam(required = false) String cursor,
                                                          @RequestParam(defaultValue = "20") int limit) {
        return PageResponse.from(events.list(new EventQuery(startsFrom, startsTo, status, null), cursor, limit(limit)),
                e -> EventResponse.from(e, null));
    }

    @GetMapping("/events/{eventId}")
    public EventResponse getEventInternal(@PathVariable UUID eventId) {
        Event event = events.getAny(new EventId(eventId));
        String url = event.coverMediaId() == null ? null : media.coverUrls(List.of(event.coverMediaId())).get(event.coverMediaId());
        return EventResponse.from(event, url);
    }

    @GetMapping("/events/{eventId}/registrations")
    public PageResponse<RegistrationResponse> listEventRegistrations(@PathVariable UUID eventId,
                                                                     @RequestParam(required = false) RegistrationStatus status,
                                                                     @RequestParam(required = false) String cursor,
                                                                     @RequestParam(defaultValue = "20") int limit) {
        var summary = EventSummary.from(registrations.event(new EventId(eventId)));
        return PageResponse.from(registrations.listByEvent(new EventId(eventId), status, cursor, limit(limit)),
                r -> RegistrationResponse.from(r, summary));
    }

    @GetMapping("/registrations")
    public PageResponse<RegistrationResponse> listRegistrationsInternal(
            @RequestParam(required = false) @org.springframework.format.annotation.DateTimeFormat(iso = org.springframework.format.annotation.DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @org.springframework.format.annotation.DateTimeFormat(iso = org.springframework.format.annotation.DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(required = false) RegistrationStatus status,
            @RequestParam(required = false) UUID eventId,
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "20") int limit) {
        if (from != null && to != null) {
            if (to.isBefore(from)) throw Errors.validation("to", "INVALID_FORMAT");
            if (ChronoUnit.DAYS.between(from, to) > 366) throw Errors.validation("to", "TOO_LARGE");
        }
        return PageResponse.from(feed.list(from, to, status, eventId, cursor, limit(limit)), r -> new RegistrationResponse(
                r.id(), r.eventId(), r.userId(), new EventSummary(r.eventId(), r.eventTitle(), r.eventStartsAt(), r.eventEndsAt(), r.venue()),
                r.status().name(), r.failureReason(), r.priceCredits(), r.ticketId(), r.createdAt(), r.updatedAt(), r.confirmedAt(), r.cancelledAt()));
    }

    /** getEventRanking: events ranked by registrations, revenue or fill rate (aggregates only, no personal data). */
    @GetMapping("/stats/event-ranking")
    public Map<String, Object> getEventRanking(
            @RequestParam @org.springframework.format.annotation.DateTimeFormat(iso = org.springframework.format.annotation.DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam @org.springframework.format.annotation.DateTimeFormat(iso = org.springframework.format.annotation.DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam EventRankingQuery.Metric by,
            @RequestParam(required = false) String ids,
            @RequestParam(required = false) Integer limit) {
        List<EventRankingQuery.Row> rows = ranking.rank(from, to, by, parseIds(ids), limit);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("from", from);
        out.put("to", to);
        out.put("by", by.name());
        out.put("items", rows.stream().map(r -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("eventId", r.eventId());
            m.put("title", r.title());
            m.put("value", by == EventRankingQuery.Metric.FILL_RATE ? r.value() : (Object) r.value().longValueExact());
            m.put("registrations", r.registrations());
            m.put("capacity", r.capacity());
            m.put("revenueCredits", r.revenueCredits());
            return m;
        }).toList());
        return out;
    }

    private static List<UUID> parseIds(String ids) {
        if (ids == null || ids.isBlank()) return null;
        try {
            return java.util.Arrays.stream(ids.split(",")).map(String::trim).filter(x -> !x.isEmpty()).map(UUID::fromString).toList();
        } catch (IllegalArgumentException e) {
            throw Errors.validation("ids", "INVALID_FORMAT");
        }
    }

    @GetMapping("/stats/registrations")
    public Map<String, Object> getRegistrationStats(@RequestParam @org.springframework.format.annotation.DateTimeFormat(iso = org.springframework.format.annotation.DateTimeFormat.ISO.DATE) LocalDate from,
                                                    @RequestParam @org.springframework.format.annotation.DateTimeFormat(iso = org.springframework.format.annotation.DateTimeFormat.ISO.DATE) LocalDate to,
                                                    @RequestParam(defaultValue = "day") String groupBy,
                                                    @RequestParam(required = false) UUID eventId) {
        if (to.isBefore(from)) throw Errors.validation("to", "INVALID_FORMAT");
        if (ChronoUnit.DAYS.between(from, to) > 366) throw Errors.validation("to", "TOO_LARGE");
        if (!groupBy.equals("day") && !groupBy.equals("event")) throw Errors.validation("groupBy", "INVALID_FORMAT");
        RegistrationStatsQuery.Stats s = stats.stats(from, to, groupBy, eventId);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("from", s.from());
        out.put("to", s.to());
        out.put("groupBy", s.groupBy());
        out.put("totals", counts(s.totals()));
        out.put("series", s.series().stream().map(b -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("key", b.key());
            m.put("label", b.label());
            m.putAll(counts(b.counts()));
            return m;
        }).toList());
        return out;
    }

    private static Map<String, Object> counts(Counts c) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("pending", c.pending());
        m.put("confirmed", c.confirmed());
        m.put("failed", c.failed());
        m.put("cancelled", c.cancelled());
        m.put("creditsCollected", c.creditsCollected());
        m.put("creditsRefunded", c.creditsRefunded());
        return m;
    }
}
