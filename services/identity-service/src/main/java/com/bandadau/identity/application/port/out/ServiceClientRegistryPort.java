package com.bandadau.identity.application.port.out;

import java.util.Optional;
import java.util.Set;

public interface ServiceClientRegistryPort {

    /** @return the scopes the client may obtain, or empty when the credentials are not valid. */
    Optional<Set<String>> authenticate(String clientId, String clientSecret);
}
