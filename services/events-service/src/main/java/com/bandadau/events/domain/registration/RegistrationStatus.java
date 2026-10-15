package com.bandadau.events.domain.registration;

public enum RegistrationStatus {
    PENDING, CONFIRMED, FAILED, CANCELLATION_PENDING, CANCELLED;

    /** Statuses that hold a seat and are covered by the partial unique index (I3). */
    public boolean isActive() { return this == PENDING || this == CONFIRMED; }
}
