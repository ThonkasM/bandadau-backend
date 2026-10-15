package com.bandadau.identity.domain.model;

import java.time.Instant;
import java.util.UUID;

/** Registry entry of an MCP token (UC-22). Only the {@code jti} is stored, never the JWT itself. */
public record McpToken(UUID id, UUID userId, String label, Instant createdAt, Instant expiresAt, Instant revokedAt) {

    public boolean revoked() { return revokedAt != null; }
}
