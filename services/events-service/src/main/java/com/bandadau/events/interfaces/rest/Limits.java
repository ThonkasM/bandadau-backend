package com.bandadau.events.interfaces.rest;

import com.bandadau.events.domain.shared.Errors;

final class Limits {
    private Limits() { }

    static int check(int limit) {
        if (limit < 1) throw Errors.validation("limit", "TOO_SMALL");
        if (limit > 50) throw Errors.validation("limit", "TOO_LARGE");
        return limit;
    }
}
