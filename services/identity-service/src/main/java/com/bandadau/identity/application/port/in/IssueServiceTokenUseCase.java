package com.bandadau.identity.application.port.in;

import java.util.Set;

public interface IssueServiceTokenUseCase {

    ServiceToken issue(String clientId, String clientSecret, Set<String> requestedScopes);

    record ServiceToken(String accessToken, long expiresIn, Set<String> scopes) { }
}
