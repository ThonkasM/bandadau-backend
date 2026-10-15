package com.bandadau.identity.domain.model;

import java.time.Instant;
import java.util.UUID;

public final class EmailVerification {
    public static final int MAX_ATTEMPTS = 5;

    public enum Result { VERIFIED, WRONG_CODE, EXPIRED, ATTEMPTS_EXCEEDED, ALREADY_CONSUMED }

    private final UUID id;
    private final UUID userId;
    private final String codeHash;
    private final Instant expiresAt;
    private int attempts;
    private Instant consumedAt;

    public EmailVerification(UUID id, UUID userId, String codeHash, Instant expiresAt, int attempts, Instant consumedAt) {
        this.id = id;
        this.userId = userId;
        this.codeHash = codeHash;
        this.expiresAt = expiresAt;
        this.attempts = attempts;
        this.consumedAt = consumedAt;
    }

    /** @param presentedHash hash of the presented code, compared in constant time by the caller-provided matcher. */
    public Result verify(boolean codeMatches, Instant now) {
        if (consumedAt != null) return Result.ALREADY_CONSUMED;
        if (attempts >= MAX_ATTEMPTS) return Result.ATTEMPTS_EXCEEDED;
        if (!now.isBefore(expiresAt)) {
            attempts++;
            return Result.EXPIRED;
        }
        if (!codeMatches) {
            attempts++;
            return Result.WRONG_CODE;
        }
        consumedAt = now;
        return Result.VERIFIED;
    }

    public void invalidate(Instant now) { if (consumedAt == null) consumedAt = now; }

    public int remainingAttempts() { return Math.max(0, MAX_ATTEMPTS - attempts); }

    public UUID id() { return id; }
    public UUID userId() { return userId; }
    public String codeHash() { return codeHash; }
    public Instant expiresAt() { return expiresAt; }
    public int attempts() { return attempts; }
    public Instant consumedAt() { return consumedAt; }
}
