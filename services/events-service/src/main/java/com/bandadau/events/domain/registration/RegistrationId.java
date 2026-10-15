package com.bandadau.events.domain.registration;

import java.util.UUID;

public record RegistrationId(UUID value) {
    public RegistrationId { java.util.Objects.requireNonNull(value); }

    @Override
    public String toString() { return value.toString(); }
}
