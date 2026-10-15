package com.bandadau.identity.application.port.in;

import com.bandadau.identity.domain.model.McpToken;
import java.time.Instant;
import java.util.UUID;

/** UC-22: MCP tokens for external clients (8 h, {@code aud=mcp}, scope {@code mcp:tools}, ADMIN only). */
public interface ManageMcpTokensUseCase {

    /** The access token is only available here, at creation time. */
    record IssuedMcpToken(McpToken token, String accessToken, long expiresIn) { }

    record McpTokenStatus(UUID id, boolean revoked, Instant expiresAt) { }

    IssuedMcpToken create(UUID adminUserId, String label);

    /** Idempotent: revoking an already revoked or expired token succeeds; unknown ids are {@code NOT_FOUND}. */
    void revoke(UUID tokenId);

    McpTokenStatus status(UUID tokenId);
}
