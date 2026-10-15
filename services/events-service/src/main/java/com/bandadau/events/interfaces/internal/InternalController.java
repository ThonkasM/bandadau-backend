package com.bandadau.events.interfaces.internal;

import com.bandadau.events.application.port.RegistrationStatsQuery;
import com.bandadau.events.application.port.RegistrationStatsQuery.Counts;
import com.bandadau.events.application.registration.RegistrationService;
import com.bandadau.events.application.saga.RegistrationSagaOrchestrator;
import com.bandadau.events.application.saga.SagaQueries;
import com.bandadau.events.application.event.EventService;
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

    public InternalController(SagaQueries sagaQueries, RegistrationSagaOrchestrator orchestrator, EventService events,
                              RegistrationService registrations, RegistrationStatsQuery stats) {
        this.sagaQueries = sagaQueries;
        this.orchestrator = orchestrator;
        this.events = events;
        this.registrations = registrations;
        this.stats = stats;
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

    @GetMapping("/events/{eventId}/registrations")
    public PageResponse<RegistrationResponse> listEventRegistrations(@PathVariable UUID eventId,
                                                                     @RequestParam(required = false) RegistrationStatus status,
                                                                     @RequestParam(required = false) String cursor,
                                                                     @RequestParam(defaultValue = "20") int limit) {
        var summary = EventSummary.from(registrations.event(new EventId(eventId)));
        return PageResponse.from(registrations.listByEvent(new EventId(eventId), status, cursor, limit(limit)),
                r -> RegistrationResponse.from(r, summary));
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
