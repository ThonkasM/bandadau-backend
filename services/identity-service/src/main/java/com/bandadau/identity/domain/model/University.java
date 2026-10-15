package com.bandadau.identity.domain.model;

import java.util.List;
import java.util.UUID;

public record University(UUID id, String name, List<String> allowedDomains, boolean enabled) {

    public University {
        allowedDomains = List.copyOf(allowedDomains);
    }

    /** RN-01.1: exact domain or any subdomain of an allowed domain. */
    public boolean allows(Email email) {
        String domain = email.domain();
        return allowedDomains.stream().anyMatch(a -> domain.equals(a) || domain.endsWith("." + a));
    }

    public University with(String newName, List<String> newDomains, Boolean newEnabled) {
        return new University(id, newName != null ? newName : name, newDomains != null ? newDomains : allowedDomains,
                newEnabled != null ? newEnabled : enabled);
    }
}
