package com.bandadau.identity.application.port.in;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** getUserStats: aggregated user counts (internal, read-only). */
public interface GetUserStatsUseCase {

    record UniversityCount(UUID universityId, String name, long users) { }

    /** {@code newUsers} is {@code null} when no range was requested. */
    record UserStats(LocalDate asOf, long totalUsers, long activeUsers, long suspendedUsers, Long newUsers,
                     Map<String, Long> byStatus, List<UniversityCount> byUniversity) { }

    /** {@code from} and {@code to} go together (both or none); {@code to} also cuts off the active-users window. */
    UserStats get(LocalDate from, LocalDate to);
}
