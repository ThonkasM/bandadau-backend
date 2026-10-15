package com.bandadau.events.domain.saga;

import java.util.UUID;

public record SagaId(UUID value) {
    public SagaId { java.util.Objects.requireNonNull(value); }

    @Override
    public String toString() { return value.toString(); }
}
