package com.bandadau.events.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.bandadau.events.application.port.EventRankingQuery;
import com.bandadau.events.application.port.EventRankingQuery.Metric;
import com.bandadau.events.application.stats.EventRankingService;
import com.bandadau.events.domain.shared.DomainException;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** getEventRanking: request validation and limit/ids rules (read model doubled). */
class EventRankingServiceTest {
    private record Call(Metric metric, List<UUID> ids, int limit) { }

    private final List<Call> calls = new ArrayList<>();
    private final EventRankingService service = new EventRankingService((from, to, metric, ids, limit) -> {
        calls.add(new Call(metric, ids, limit));
        return List.of();
    });
    private static final LocalDate D1 = LocalDate.parse("2026-10-01");
    private static final LocalDate D2 = LocalDate.parse("2026-10-16");

    private static void assertInvalid(Runnable r, String field, String code) {
        assertThatThrownBy(r::run).isInstanceOfSatisfying(DomainException.class, e -> {
            assertThat(e.kind()).isEqualTo(DomainException.Kind.INVALID);
            assertThat(e.params().toString()).contains(field).contains(code);
        });
    }

    @Test
    void limitDefaultsToFive() {
        service.rank(D1, D2, Metric.REVENUE, null, null);
        assertThat(calls.get(0)).isEqualTo(new Call(Metric.REVENUE, null, 5));
    }

    @Test
    void idsOverrideLimit() {
        List<UUID> ids = List.of(UUID.randomUUID(), UUID.randomUUID());
        service.rank(D1, D2, Metric.FILL_RATE, ids, 1);
        assertThat(calls.get(0)).isEqualTo(new Call(Metric.FILL_RATE, ids, 2));
    }

    @Test
    void rejectsInvalidRangesLimitsAndTooManyIds() {
        assertInvalid(() -> service.rank(D2, D1, Metric.REVENUE, null, null), "to", "INVALID_FORMAT");
        assertInvalid(() -> service.rank(LocalDate.parse("2025-01-01"), D2, Metric.REVENUE, null, null), "to", "TOO_LARGE");
        assertInvalid(() -> service.rank(D1, D2, Metric.REVENUE, null, 0), "limit", "TOO_SMALL");
        assertInvalid(() -> service.rank(D1, D2, Metric.REVENUE, null, 51), "limit", "TOO_LARGE");
        List<UUID> many = java.util.stream.IntStream.range(0, 51).mapToObj(i -> UUID.randomUUID()).toList();
        assertInvalid(() -> service.rank(D1, D2, Metric.REVENUE, many, null), "ids", "TOO_LARGE");
        assertThat(calls).isEmpty();
    }
}
