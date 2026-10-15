package com.bandadau.identity.application.port.out;

import com.bandadau.identity.domain.model.EmailVerification;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

public interface EmailVerificationRepositoryPort {
    Optional<EmailVerification> findLatestByUserId(UUID userId);

    void insert(EmailVerification verification, Instant createdAt);

    void update(EmailVerification verification);

    void invalidateAll(UUID userId, Instant now);
}
