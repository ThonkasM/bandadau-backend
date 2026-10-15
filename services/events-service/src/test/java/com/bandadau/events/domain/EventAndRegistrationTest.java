package com.bandadau.events.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.bandadau.events.domain.event.*;
import com.bandadau.events.domain.registration.*;
import com.bandadau.events.domain.shared.DomainException;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class EventAndRegistrationTest {
    static final Instant NOW = Instant.parse("2026-10-14T12:00:00Z");
    static final Instant STARTS = NOW.plus(Duration.ofDays(3));

    static Event event(int capacity, long price) {
        return Event.create(new EventId(UUID.randomUUID()), UUID.randomUUID(), UUID.randomUUID(), "Taller de Docker",
                "desc", null, "Auditorio", new EventSchedule(STARTS, STARTS.plus(Duration.ofHours(2))),
                new Capacity(capacity), new Credits(price), NOW);
    }

    static String code(Throwable t) { return ((DomainException) t).code(); }

    @Test
    void valueObjectsRejectInvalidValues() {
        assertThatThrownBy(() -> new Capacity(0)).isInstanceOf(DomainException.class);
        assertThatThrownBy(() -> new Capacity(10_001)).isInstanceOf(DomainException.class);
        assertThatThrownBy(() -> new Credits(-1)).isInstanceOf(DomainException.class);
        assertThatThrownBy(() -> new EventSchedule(STARTS, STARTS)).isInstanceOf(DomainException.class);
        assertThat(new Credits(0).isFree()).isTrue();
    }

    @Test
    void createRequiresAFutureStartAndStartsAsDraft() {
        assertThatThrownBy(() -> Event.create(new EventId(UUID.randomUUID()), UUID.randomUUID(), UUID.randomUUID(), "t", "d",
                null, "v", new EventSchedule(NOW.minusSeconds(10), NOW.plusSeconds(10)), new Capacity(1), Credits.ZERO, NOW))
                .satisfies(e -> assertThat(code(e)).isEqualTo("STARTS_AT_IN_PAST"));
        assertThat(event(5, 0).status()).isEqualTo(EventStatus.DRAFT);
    }

    @Test
    void publishIsIdempotentAndEmitsOneDomainEvent() {
        Event e = event(5, 20);
        assertThat(e.publish(NOW)).isTrue();
        assertThat(e.pullEvents()).hasSize(1).first().isInstanceOf(EventPublished.class);
        assertThat(e.publish(NOW)).isFalse();
        assertThat(e.pullEvents()).isEmpty();
        e.cancel("lluvia", 0, NOW);
        assertThatThrownBy(() -> e.publish(NOW)).satisfies(x -> assertThat(code(x)).isEqualTo("INVALID_EVENT_STATUS"));
    }

    @Test
    void seatsRespectCapacityStatusAndStart() {
        Event e = event(2, 0);
        assertThatThrownBy(() -> e.reserveSeat(NOW)).satisfies(x -> assertThat(code(x)).isEqualTo("EVENT_NOT_OPEN"));
        e.publish(NOW);
        e.reserveSeat(NOW);
        e.reserveSeat(NOW);
        assertThat(e.seatsAvailable()).isZero();
        assertThatThrownBy(() -> e.reserveSeat(NOW)).satisfies(x -> assertThat(code(x)).isEqualTo("EVENT_FULL"));
        e.releaseSeat(NOW);
        e.reserveSeat(NOW);
        assertThatThrownBy(() -> e.reserveSeat(STARTS)).satisfies(x -> assertThat(code(x)).isEqualTo("EVENT_NOT_OPEN"));
    }

    @Test
    void releasingBelowZeroIsABug() {
        Event e = event(2, 0);
        assertThatThrownBy(() -> e.releaseSeat(NOW)).isInstanceOf(IllegalStateException.class);
    }

    private Registration pending() {
        return Registration.request(new RegistrationId(UUID.randomUUID()), new EventId(UUID.randomUUID()), UUID.randomUUID(),
                new Credits(20), UUID.randomUUID(), NOW);
    }

    @Test
    void registrationTransitionsFollowI4() {
        Registration r = pending();
        r.pullEvents();
        r.confirm(UUID.randomUUID(), NOW);
        assertThat(r.status()).isEqualTo(RegistrationStatus.CONFIRMED);
        assertThatThrownBy(() -> r.fail(FailureReason.TIMEOUT, NOW)).isInstanceOf(Registration.IllegalRegistrationTransition.class);
        r.requestCancellation(NOW, STARTS.minus(Duration.ofHours(24)));
        assertThat(r.status()).isEqualTo(RegistrationStatus.CANCELLATION_PENDING);
        r.revertCancellation(NOW);
        assertThat(r.status()).isEqualTo(RegistrationStatus.CONFIRMED);
        r.requestCancellation(NOW, null);
        r.markCancelled(20, NOW);
        assertThat(r.status()).isEqualTo(RegistrationStatus.CANCELLED);
        assertThat(r.status().isActive()).isFalse();
    }

    @Test
    void cancellationNeedsConfirmedStatusAndTheWindow() {
        Registration r = pending();
        assertThatThrownBy(() -> r.requestCancellation(NOW, STARTS)).satisfies(x -> assertThat(code(x)).isEqualTo("INVALID_REGISTRATION_STATUS"));
        r.confirm(UUID.randomUUID(), NOW);
        assertThatThrownBy(() -> r.requestCancellation(STARTS.minus(Duration.ofHours(23)), STARTS.minus(Duration.ofHours(24))))
                .satisfies(x -> assertThat(code(x)).isEqualTo("CANCELLATION_WINDOW_CLOSED"));
    }

    @Test
    void policyRejectsDuplicatesAndClosedEvents() {
        Event e = event(5, 0);
        assertThatThrownBy(() -> RegistrationPolicy.ensureCanRegister(e, Optional.empty(), NOW))
                .satisfies(x -> assertThat(code(x)).isEqualTo("EVENT_NOT_OPEN"));
        e.publish(NOW);
        RegistrationPolicy.ensureCanRegister(e, Optional.empty(), NOW);
        assertThatThrownBy(() -> RegistrationPolicy.ensureCanRegister(e, Optional.of(pending()), NOW))
                .satisfies(x -> assertThat(code(x)).isEqualTo("ALREADY_REGISTERED"));
    }
}
