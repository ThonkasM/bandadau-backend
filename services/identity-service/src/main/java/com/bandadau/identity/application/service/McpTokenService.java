package com.bandadau.identity.application.service;

import com.bandadau.identity.application.AuthSettings;
import com.bandadau.identity.application.port.in.ManageMcpTokensUseCase;
import com.bandadau.identity.application.port.out.*;
import com.bandadau.identity.domain.exception.Errors;
import com.bandadau.identity.domain.model.McpToken;
import com.bandadau.identity.domain.model.Role;
import com.bandadau.identity.domain.model.User;
import java.time.Instant;
import java.util.UUID;

public final class McpTokenService implements ManageMcpTokensUseCase {
    private static final int MAX_LABEL = 80;

    private final McpTokenRepositoryPort tokens;
    private final UserRepositoryPort users;
    private final TokenIssuerPort issuer;
    private final ClockPort clock;
    private final IdGeneratorPort ids;
    private final TransactionPort tx;
    private final AuthSettings settings;

    public McpTokenService(McpTokenRepositoryPort tokens, UserRepositoryPort users, TokenIssuerPort issuer, ClockPort clock,
                           IdGeneratorPort ids, TransactionPort tx, AuthSettings settings) {
        this.tokens = tokens;
        this.users = users;
        this.issuer = issuer;
        this.clock = clock;
        this.ids = ids;
        this.tx = tx;
        this.settings = settings;
    }

    @Override
    public IssuedMcpToken create(UUID adminUserId, String label) {
        User admin = users.findById(adminUserId).filter(User::isActive).orElseThrow(Errors::userNotFound);
        if (!admin.roles().contains(Role.ADMIN)) throw Errors.adminAccessForbidden();
        String cleanLabel = label == null || label.isBlank() ? null : label.trim();
        if (cleanLabel != null && cleanLabel.length() > MAX_LABEL) throw Errors.validation("label", "TOO_LONG");

        Instant now = clock.now();
        McpToken token = new McpToken(ids.newId(), admin.id(), cleanLabel, now, now.plus(settings.mcpTokenTtl()), null);
        tx.inTransaction(() -> {
            tokens.insert(token);
            return null;
        });
        String jwt = issuer.issueMcp(token.id(), admin, settings.mcpTokenTtl());
        return new IssuedMcpToken(token, jwt, settings.mcpTokenTtl().toSeconds());
    }

    @Override
    public void revoke(UUID tokenId) {
        McpToken token = tokens.findById(tokenId).orElseThrow(Errors::mcpTokenNotFound);
        if (token.revoked()) return;
        tx.inTransaction(() -> {
            tokens.revoke(tokenId, clock.now());
            return null;
        });
    }

    @Override
    public McpTokenStatus status(UUID tokenId) {
        McpToken token = tokens.findById(tokenId).orElseThrow(Errors::mcpTokenNotFound);
        return new McpTokenStatus(token.id(), token.revoked(), token.expiresAt());
    }
}
