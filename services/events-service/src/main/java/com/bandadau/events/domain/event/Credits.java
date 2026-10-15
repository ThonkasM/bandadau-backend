package com.bandadau.events.domain.event;

import com.bandadau.events.domain.shared.Errors;

/** Whole credits (never decimals). */
public record Credits(long value) {
    public static final Credits ZERO = new Credits(0);

    public Credits {
        if (value < 0) throw Errors.validation("priceCredits", "TOO_SMALL");
    }

    public boolean isFree() { return value == 0; }
}
