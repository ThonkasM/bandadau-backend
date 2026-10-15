package com.bandadau.identity.application.service;

import com.bandadau.identity.application.AuthSettings;
import com.bandadau.identity.application.port.in.IssueServiceTokenUseCase;
import com.bandadau.identity.application.port.out.ServiceClientRegistryPort;
import com.bandadau.identity.application.port.out.TokenIssuerPort;
import com.bandadau.identity.domain.exception.Errors;
import java.util.LinkedHashSet;
import java.util.Set;

public final class ServiceTokenService implements IssueServiceTokenUseCase {
    private final ServiceClientRegistryPort clients;
    private final TokenIssuerPort tokens;
    private final AuthSettings settings;

    public ServiceTokenService(ServiceClientRegistryPort clients, TokenIssuerPort tokens, AuthSettings settings) {
        this.clients = clients;
        this.tokens = tokens;
        this.settings = settings;
    }

    @Override
    public ServiceToken issue(String clientId, String clientSecret, Set<String> requestedScopes) {
        Set<String> allowed = clients.authenticate(clientId, clientSecret).orElseThrow(Errors::invalidClient);
        Set<String> granted = new LinkedHashSet<>();
        if (requestedScopes == null || requestedScopes.isEmpty()) {
            granted.addAll(allowed);
        } else {
            requestedScopes.stream().filter(allowed::contains).forEach(granted::add);
        }
        String token = tokens.issueService(clientId, granted, settings.serviceTokenTtl());
        return new ServiceToken(token, settings.serviceTokenTtl().toSeconds(), granted);
    }
}
