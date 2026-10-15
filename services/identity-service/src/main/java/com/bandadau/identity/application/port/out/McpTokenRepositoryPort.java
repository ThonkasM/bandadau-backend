package com.bandadau.identity.application.port.out;

import com.bandadau.identity.domain.model.McpToken;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

public interface McpTokenRepositoryPort {

    void insert(McpToken token);

    Optional<McpToken> findById(UUID id);

    /** Sets {@code revoked_at} only when it is still empty. */
    void revoke(UUID id, Instant at);
}
