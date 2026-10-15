package com.bandadau.identity.domain.model;

import java.time.Instant;

public record SigningKey(String kid, String publicJwk, byte[] privateKeyEnc, Status status, Instant createdAt,
                         Instant activatedAt, Instant retiredAt) {

    public enum Status { PENDING, ACTIVE, RETIRING, RETIRED }

    public SigningKey withStatus(Status newStatus, Instant now) {
        return new SigningKey(kid, publicJwk, privateKeyEnc, newStatus, createdAt,
                newStatus == Status.ACTIVE ? now : activatedAt, newStatus == Status.RETIRING ? now : retiredAt);
    }
}
