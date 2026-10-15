package com.bandadau.identity.application.port.out;

import com.bandadau.identity.domain.model.HandoffCode;
import java.time.Instant;
import java.util.Optional;

public interface HandoffCodeRepositoryPort {
    void insert(HandoffCode code, Instant createdAt);

    /** Atomically marks the code as used if it is unused and unexpired; empty otherwise. */
    Optional<HandoffCode> consume(String codeHash, Instant now);
}
