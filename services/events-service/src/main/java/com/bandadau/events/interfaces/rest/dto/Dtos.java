package com.bandadau.events.interfaces.rest.dto;

import com.bandadau.events.domain.event.Event;
import com.bandadau.events.domain.registration.Registration;
import com.bandadau.events.domain.saga.SagaInstance;
import com.bandadau.events.domain.shared.Page;
import jakarta.validation.constraints.*;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.function.Function;

public final class Dtos {
    private Dtos() { }

    public record CreateEventRequest(
            @NotBlank @Size(min = 5, max = 120) String title,
            @NotNull @Size(max = 5000) String description,
            UUID coverMediaId,
            @NotNull Instant startsAt,
            @NotBlank @Size(min = 3, max = 200) String venue,
            @NotNull @Min(1) @Max(10000) Integer capacity,
            @NotNull @PositiveOrZero Long priceCredits) { }

    public record CancelEventRequest(@NotBlank @Size(min = 3, max = 500) String reason) { }

    public record EventResponse(UUID id, UUID organizerId, String title, String description, UUID coverMediaId,
                                String coverUrl, Instant startsAt, String venue, int capacity, int seatsTaken,
                                int seatsAvailable, long priceCredits, String status, Instant publishedAt,
                                Instant createdAt, Instant updatedAt) {
        public static EventResponse from(Event e, String coverUrl) {
            return new EventResponse(e.id().value(), e.organizerId(), e.title(), e.description(), e.coverMediaId(),
                    coverUrl, e.schedule().startsAt(), e.venue(), e.capacity().value(), e.seatsTaken(),
                    e.seatsAvailable(), e.price().value(), e.status().name(), e.publishedAt(), e.createdAt(), e.updatedAt());
        }
    }

    public record EventSummary(UUID id, String title, Instant startsAt, String venue) {
        public static EventSummary from(Event e) {
            return new EventSummary(e.id().value(), e.title(), e.schedule().startsAt(), e.venue());
        }
    }

    public record RegistrationResponse(UUID id, UUID eventId, UUID userId, EventSummary event, String status,
                                       String failureReason, long priceCredits, UUID ticketId, Instant createdAt,
                                       Instant updatedAt, Instant confirmedAt, Instant cancelledAt) {
        public static RegistrationResponse from(Registration r, EventSummary event) {
            return new RegistrationResponse(r.id().value(), r.eventId().value(), r.userId(), event, r.status().name(),
                    r.failureReason() == null ? null : r.failureReason().name(), r.price().value(), r.ticketId(),
                    r.createdAt(), r.updatedAt(), r.confirmedAt(), r.cancelledAt());
        }
    }

    public record SagaResponse(UUID id, String type, UUID registrationId, UUID eventId, UUID userId, String step,
                               String status, String failureReason, int retries, Instant deadlineAt, Instant startedAt,
                               Instant updatedAt, String correlationId) {
        public static SagaResponse from(SagaInstance s) {
            return new SagaResponse(s.id().value(), s.type().name(), s.registrationId().value(), s.context().eventId(),
                    s.context().userId(), s.step().name(), s.status().name(),
                    s.failureReason() == null ? null : s.failureReason().name(), s.attempt(), s.deadlineAt(),
                    s.startedAt(), s.updatedAt(), s.context().correlationId());
        }
    }

    public record PageResponse<T>(List<T> items, String nextCursor) {
        public static <S, T> PageResponse<T> from(Page<S> page, Function<S, T> mapper) {
            return new PageResponse<>(page.items().stream().map(mapper).toList(), page.nextCursor());
        }
    }
}
