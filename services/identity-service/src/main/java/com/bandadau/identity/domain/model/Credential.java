package com.bandadau.identity.domain.model;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

public final class Credential {
    public static final int LOCK_THRESHOLD = 5;
    private static final Duration MAX_LOCK = Duration.ofMinutes(15);

    private final UUID userId;
    private String passwordHash;
    private int failedAttempts;
    private Instant lockedUntil;

    public Credential(UUID userId, String passwordHash, int failedAttempts, Instant lockedUntil) {
        this.userId = userId;
        this.passwordHash = passwordHash;
        this.failedAttempts = failedAttempts;
        this.lockedUntil = lockedUntil;
    }

    public boolean isLocked(Instant now) { return lockedUntil != null && lockedUntil.isAfter(now); }

    /** UC-02 A4b: progressive wait (1, 2, 4... up to 15 minutes) after five consecutive failures. */
    public void registerFailure(Instant now) {
        failedAttempts++;
        if (failedAttempts >= LOCK_THRESHOLD) {
            long minutes = 1L << Math.min(failedAttempts - LOCK_THRESHOLD, 10);
            Duration lock = Duration.ofMinutes(minutes);
            lockedUntil = now.plus(lock.compareTo(MAX_LOCK) > 0 ? MAX_LOCK : lock);
        }
    }

    public void registerSuccess() { failedAttempts = 0; lockedUntil = null; }

    public void replaceHash(String newHash) { passwordHash = newHash; failedAttempts = 0; lockedUntil = null; }

    public UUID userId() { return userId; }
    public String passwordHash() { return passwordHash; }
    public int failedAttempts() { return failedAttempts; }
    public Instant lockedUntil() { return lockedUntil; }
}
