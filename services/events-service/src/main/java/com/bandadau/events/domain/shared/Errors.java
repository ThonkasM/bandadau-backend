package com.bandadau.events.domain.shared;

import static com.bandadau.events.domain.shared.DomainException.Kind.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Every business error of the events context (codes match the OpenAPI contract). */
public final class Errors {
    private Errors() { }

    public static DomainException eventNotFound() { return new DomainException(NOT_FOUND, "NOT_FOUND").with("resource", "event"); }
    public static DomainException registrationNotFound() { return new DomainException(NOT_FOUND, "NOT_FOUND").with("resource", "registration"); }
    public static DomainException sagaNotFound() { return new DomainException(NOT_FOUND, "NOT_FOUND").with("resource", "saga"); }
    public static DomainException eventFull() { return new DomainException(CONFLICT, "EVENT_FULL"); }
    public static DomainException alreadyRegistered(UUID registrationId) {
        return new DomainException(CONFLICT, "ALREADY_REGISTERED").with("registrationId", registrationId);
    }
    public static DomainException eventNotOpen() { return new DomainException(UNPROCESSABLE, "EVENT_NOT_OPEN"); }
    public static DomainException invalidEventStatus(String status) {
        return new DomainException(CONFLICT, "INVALID_EVENT_STATUS").with("status", status);
    }
    public static DomainException startsAtInPast() { return new DomainException(UNPROCESSABLE, "STARTS_AT_IN_PAST"); }
    public static DomainException invalidRegistrationStatus(String status) {
        return new DomainException(CONFLICT, "INVALID_REGISTRATION_STATUS").with("status", status);
    }
    public static DomainException cancellationWindowClosed() { return new DomainException(UNPROCESSABLE, "CANCELLATION_WINDOW_CLOSED"); }
    public static DomainException notEventOrganizer() { return new DomainException(FORBIDDEN, "NOT_EVENT_ORGANIZER"); }
    public static DomainException forbidden() { return new DomainException(FORBIDDEN, "FORBIDDEN"); }
    public static DomainException sagaNotRetryable(String status) {
        return new DomainException(CONFLICT, "SAGA_NOT_RETRYABLE").with("status", status);
    }
    public static DomainException mediaNotApproved() { return new DomainException(UNPROCESSABLE, "MEDIA_NOT_APPROVED"); }
    public static DomainException mediaUnavailable() {
        return new DomainException(UNAVAILABLE, "MEDIA_UNAVAILABLE").with("retryAfter", 5L);
    }
    public static DomainException concurrentModification() { return new DomainException(CONFLICT, "CONCURRENT_MODIFICATION"); }
    public static DomainException invalidCursor() { return new DomainException(INVALID, "INVALID_CURSOR"); }

    public static DomainException validation(String field, String code) {
        return new DomainException(INVALID, "VALIDATION_FAILED").with("errors", List.of(Map.of("field", field, "code", code)));
    }
}
