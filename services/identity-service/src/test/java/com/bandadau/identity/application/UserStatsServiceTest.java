package com.bandadau.identity.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.bandadau.identity.application.port.in.GetUserStatsUseCase.UserStats;
import com.bandadau.identity.application.port.out.UserStatsQueryPort;
import com.bandadau.identity.application.service.UserStatsService;
import com.bandadau.identity.domain.exception.DomainException;
import com.bandadau.identity.domain.model.UserStatus;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** getUserStats: range rules, window arithmetic and zero-filled statuses (query port doubled). */
class UserStatsServiceTest {
    private final List<Instant[]> activeCalls = new ArrayList<>();
    private final List<Instant[]> createdCalls = new ArrayList<>();
    private Map<UserStatus, Long> counts = Map.of(UserStatus.ACTIVE, 7L, UserStatus.SUSPENDED, 2L);

    private final UserStatsQueryPort port = new UserStatsQueryPort() {
        @Override public Map<UserStatus, Long> countByStatus() { return counts; }
        @Override public long countActiveUsers(Instant from, Instant to) { activeCalls.add(new Instant[] {from, to}); return 5; }
        @Override public long countCreatedUsers(Instant from, Instant to) { createdCalls.add(new Instant[] {from, to}); return 3; }
        @Override public List<UniversityUsers> usersByUniversity(int limit) {
            return List.of(new UniversityUsers(UUID.randomUUID(), "UMSA", 9));
        }
    };
    private final UserStatsService service = new UserStatsService(port, () -> Instant.parse("2026-10-16T23:30:00Z"));

    @Test
    void withoutRangeUsesTodayUtcAndLeavesNewUsersNull() {
        UserStats s = service.get(null, null);
        assertThat(s.asOf()).isEqualTo(LocalDate.parse("2026-10-16"));
        assertThat(s.newUsers()).isNull();
        assertThat(createdCalls).isEmpty();
        assertThat(activeCalls.get(0)[0]).isEqualTo(Instant.parse("2026-09-17T00:00:00Z"));
        assertThat(activeCalls.get(0)[1]).isEqualTo(Instant.parse("2026-10-17T00:00:00Z"));
        assertThat(s.activeUsers()).isEqualTo(5);
    }

    @Test
    void statusesAreZeroFilledAndTotalsConsistent() {
        UserStats s = service.get(null, null);
        assertThat(s.byStatus()).containsEntry("ACTIVE", 7L).containsEntry("SUSPENDED", 2L).containsEntry("PENDING_VERIFICATION", 0L);
        assertThat(s.totalUsers()).isEqualTo(9);
        assertThat(s.suspendedUsers()).isEqualTo(2);
        assertThat(s.byUniversity()).singleElement().satisfies(u -> assertThat(u.name()).isEqualTo("UMSA"));
    }

    @Test
    void rangeCountsNewUsersInclusiveAndCutsOffActiveWindowAtTo() {
        UserStats s = service.get(LocalDate.parse("2026-10-01"), LocalDate.parse("2026-10-10"));
        assertThat(s.newUsers()).isEqualTo(3L);
        assertThat(s.asOf()).isEqualTo(LocalDate.parse("2026-10-10"));
        assertThat(createdCalls.get(0)[0]).isEqualTo(Instant.parse("2026-10-01T00:00:00Z"));
        assertThat(createdCalls.get(0)[1]).isEqualTo(Instant.parse("2026-10-11T00:00:00Z"));
        assertThat(activeCalls.get(0)[0]).isEqualTo(Instant.parse("2026-09-11T00:00:00Z"));
    }

    @Test
    void invalidRangesAreRejected() {
        for (LocalDate[] r : new LocalDate[][] {
                {LocalDate.parse("2026-10-01"), null}, {null, LocalDate.parse("2026-10-01")},
                {LocalDate.parse("2026-10-02"), LocalDate.parse("2026-10-01")},
                {LocalDate.parse("2025-01-01"), LocalDate.parse("2026-10-01")}}) {
            assertThatThrownBy(() -> service.get(r[0], r[1])).isInstanceOfSatisfying(DomainException.class, e -> {
                assertThat(e.code()).isEqualTo("INVALID_RANGE");
                assertThat(e.kind()).isEqualTo(DomainException.Kind.INVALID);
            });
        }
        assertThat(service.get(LocalDate.parse("2025-10-01"), LocalDate.parse("2026-10-02")).newUsers()).isEqualTo(3L);
    }
}
