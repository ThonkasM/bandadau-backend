package com.bandadau.identity.application.port.out;

import com.bandadau.identity.domain.model.TargetApp;
import com.bandadau.identity.domain.model.User;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Set;

public interface TokenIssuerPort {
    String issueAccess(User user, TargetApp audience, Duration ttl);

    String issueService(String clientId, Set<String> scopes, Duration ttl);

    List<Map<String, Object>> publicKeys();
}
