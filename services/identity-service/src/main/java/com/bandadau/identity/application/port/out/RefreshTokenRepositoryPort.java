package com.bandadau.identity.application.port.out;

import com.bandadau.identity.domain.model.RefreshToken;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

public interface RefreshTokenRepositoryPort {
    void insert(RefreshToken token);

    /** Row lock; must run inside a transaction. */
    Optional<RefreshToken> findByHashForUpdate(String tokenHash);

    void markUsed(UUID id, Instant now);

    void revokeFamily(UUID familyId, Instant now);

    void revokeAllForUser(UUID userId, Instant now);
}
