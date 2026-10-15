package com.bandadau.events.interfaces.rest;

import com.bandadau.events.application.registration.RegistrationService;
import com.bandadau.events.application.registration.RegistrationService.Accepted;
import com.bandadau.events.domain.event.EventId;
import com.bandadau.events.domain.registration.RegistrationId;
import com.bandadau.events.domain.registration.RegistrationStatus;
import com.bandadau.events.interfaces.rest.dto.Dtos.*;
import java.net.URI;
import java.util.UUID;
import org.slf4j.MDC;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1")
public class RegistrationController {
    private final RegistrationService service;

    public RegistrationController(RegistrationService service) {
        this.service = service;
    }

    private static RegistrationResponse view(Accepted a) {
        return RegistrationResponse.from(a.registration(), EventSummary.from(a.event()));
    }

    private static boolean inFlight(RegistrationStatus s) {
        return s == RegistrationStatus.PENDING || s == RegistrationStatus.CANCELLATION_PENDING;
    }

    @PostMapping("/events/{eventId}/registrations")
    public ResponseEntity<RegistrationResponse> registerToEvent(@PathVariable UUID eventId, @AuthenticationPrincipal Jwt jwt,
                                                                @RequestHeader("Idempotency-Key") UUID key) {
        Accepted a = service.register(new EventId(eventId), Callers.id(jwt), key, MDC.get("correlationId"));
        return accepted(a);
    }

    @GetMapping("/registrations/me")
    public PageResponse<RegistrationResponse> listMyRegistrations(@RequestParam(required = false) RegistrationStatus status,
                                                                  @RequestParam(required = false) String cursor,
                                                                  @RequestParam(defaultValue = "20") int limit,
                                                                  @AuthenticationPrincipal Jwt jwt) {
        var page = service.listMine(Callers.id(jwt), status, cursor, Limits.check(limit));
        return PageResponse.from(page, r -> RegistrationResponse.from(r, EventSummary.from(service.event(r.eventId()))));
    }

    @GetMapping("/registrations/{registrationId}")
    public ResponseEntity<RegistrationResponse> getRegistration(@PathVariable UUID registrationId, @AuthenticationPrincipal Jwt jwt) {
        Accepted a = service.get(new RegistrationId(registrationId), Callers.id(jwt));
        ResponseEntity.BodyBuilder b = ResponseEntity.ok();
        if (inFlight(a.registration().status())) b.header(HttpHeaders.RETRY_AFTER, "1");
        return b.body(view(a));
    }

    @PostMapping("/registrations/{registrationId}/cancel")
    public ResponseEntity<RegistrationResponse> cancelRegistration(@PathVariable UUID registrationId,
                                                                   @AuthenticationPrincipal Jwt jwt,
                                                                   @RequestHeader("Idempotency-Key") UUID key) {
        return accepted(service.cancel(new RegistrationId(registrationId), Callers.id(jwt), MDC.get("correlationId")));
    }

    private ResponseEntity<RegistrationResponse> accepted(Accepted a) {
        return ResponseEntity.status(HttpStatus.ACCEPTED).header(HttpHeaders.LOCATION, "/api/v1/registrations/" + a.registration().id())
                .header(HttpHeaders.RETRY_AFTER, "1").body(view(a));
    }
}
