package com.bandadau.events.domain.event;

import com.bandadau.events.domain.shared.Errors;

public record Capacity(int value) {
    public static final int MAX = 10_000;

    public Capacity {
        if (value < 1 || value > MAX) throw Errors.validation("capacity", value < 1 ? "TOO_SMALL" : "TOO_LARGE");
    }

    public boolean allows(int seatsTaken) { return seatsTaken < value; }
}
