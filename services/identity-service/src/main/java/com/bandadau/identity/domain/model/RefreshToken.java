package com.bandadau.identity.domain.model;

import java.time.Instant;
import java.util.UUID;

public record RefreshToken(UUID id, UUID userId, UUID familyId, TargetApp client, String tokenHash, UUID parentId,
                           Instant expiresAt, Instant usedAt, Instant revokedAt, Instant createdAt) {

    public boolean isExpired(Instant now) { return !now.isBefore(expiresAt); }

    /** A used or revoked token that is presented again signals theft or a stale copy (RN-02.3). */
    public boolean isReuse() { return usedAt != null || revokedAt != null; }
}
