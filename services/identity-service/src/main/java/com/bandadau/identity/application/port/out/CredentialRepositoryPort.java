package com.bandadau.identity.application.port.out;

import com.bandadau.identity.domain.model.Credential;
import java.util.Optional;
import java.util.UUID;

public interface CredentialRepositoryPort {
    Optional<Credential> findByUserId(UUID userId);

    /** Insert or replace. */
    void save(Credential credential);
}
