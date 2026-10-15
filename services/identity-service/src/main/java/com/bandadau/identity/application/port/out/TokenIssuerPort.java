package com.bandadau.identity.application.port.out;

import com.bandadau.identity.domain.model.TargetApp;
import com.bandadau.identity.domain.model.User;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

public interface TokenIssuerPort {
    String issueAccess(User user, TargetApp audience, Duration ttl);

    String issueService(String clientId, Set<String> scopes, Duration ttl);

    /** MCP token (UC-22): {@code aud=mcp}, {@code typ=user}, roles of the admin, scope {@code mcp:tools}, {@code jti} = token id. */
    String issueMcp(UUID tokenId, User admin, Duration ttl);

    List<Map<String, Object>> publicKeys();
}
