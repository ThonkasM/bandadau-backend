package com.bandadau.identity.domain.model;

import java.time.Instant;
import java.util.UUID;

public record HandoffCode(String codeHash, UUID userId, TargetApp targetApp, String codeChallenge, Instant expiresAt,
                          Instant usedAt, String createdIp) {
}
