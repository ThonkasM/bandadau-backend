package com.bandadau.identity.application.port.out;

import com.bandadau.identity.domain.model.UserStatus;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Read-only query port: aggregated user counts for the internal stats endpoint (no personal data). */
public interface UserStatsQueryPort {

    record UniversityUsers(UUID universityId, String name, long users) { }

    /** Users per status, excluding {@code DELETED}. Missing statuses may be absent from the map. */
    Map<UserStatus, Long> countByStatus();

    /** Distinct (non-deleted) users with a refresh token issued in {@code [from, to)}. */
    long countActiveUsers(Instant from, Instant to);

    /** Users (non-deleted) created in {@code [from, to)}. */
    long countCreatedUsers(Instant from, Instant to);

    /** Universities with at least one (non-deleted) user, most users first, at most {@code limit}. */
    List<UniversityUsers> usersByUniversity(int limit);
}
