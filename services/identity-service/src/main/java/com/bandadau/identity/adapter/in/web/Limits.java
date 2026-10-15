package com.bandadau.identity.adapter.in.web;

import com.bandadau.identity.domain.exception.Errors;

final class Limits {
    private Limits() { }

    /** Shared `limit` parameter: 1..50 (contract). */
    static int check(int limit) {
        if (limit < 1) throw Errors.validation("limit", "TOO_SMALL");
        if (limit > 50) throw Errors.validation("limit", "TOO_LARGE");
        return limit;
    }
}
