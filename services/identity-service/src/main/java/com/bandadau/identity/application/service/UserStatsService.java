package com.bandadau.identity.application.service;

import com.bandadau.identity.application.port.in.GetUserStatsUseCase;
import com.bandadau.identity.application.port.out.ClockPort;
import com.bandadau.identity.application.port.out.UserStatsQueryPort;
import com.bandadau.identity.domain.exception.Errors;
import com.bandadau.identity.domain.model.UserStatus;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.Map;

public final class UserStatsService implements GetUserStatsUseCase {
    static final int MAX_RANGE_DAYS = 366;
    static final int ACTIVE_WINDOW_DAYS = 30;
    static final int MAX_UNIVERSITIES = 50;

    private final UserStatsQueryPort stats;
    private final ClockPort clock;

    public UserStatsService(UserStatsQueryPort stats, ClockPort clock) {
        this.stats = stats;
        this.clock = clock;
    }

    @Override
    public UserStats get(LocalDate from, LocalDate to) {
        if ((from == null) != (to == null)) throw Errors.invalidInput("INVALID_RANGE");
        if (from != null && (to.isBefore(from) || ChronoUnit.DAYS.between(from, to) > MAX_RANGE_DAYS)) {
            throw Errors.invalidInput("INVALID_RANGE");
        }
        LocalDate asOf = to != null ? to : LocalDate.ofInstant(clock.now(), ZoneOffset.UTC);
        Instant activeFrom = start(asOf.minusDays(ACTIVE_WINDOW_DAYS - 1L));
        Instant activeTo = start(asOf.plusDays(1));
        Map<UserStatus, Long> counts = stats.countByStatus();
        Map<String, Long> byStatus = new LinkedHashMap<>();
        for (UserStatus s : new UserStatus[] {UserStatus.ACTIVE, UserStatus.SUSPENDED, UserStatus.PENDING_VERIFICATION}) {
            byStatus.put(s.name(), counts.getOrDefault(s, 0L));
        }
        long total = byStatus.values().stream().mapToLong(Long::longValue).sum();
        Long created = from == null ? null : stats.countCreatedUsers(start(from), start(to.plusDays(1)));
        return new UserStats(asOf, total, stats.countActiveUsers(activeFrom, activeTo), byStatus.get("SUSPENDED"), created,
                byStatus, stats.usersByUniversity(MAX_UNIVERSITIES).stream()
                        .map(u -> new UniversityCount(u.universityId(), u.name(), u.users())).toList());
    }

    private static Instant start(LocalDate day) {
        return day.atStartOfDay().toInstant(ZoneOffset.UTC);
    }
}
