package com.bandadau.identity.application.service;

import com.bandadau.identity.domain.exception.DomainException;

/** Lets a transaction commit its side effects (counters, revocations) and then report a business failure. */
record Attempt<T>(T value, DomainException error) {

    static <T> Attempt<T> ok(T value) { return new Attempt<>(value, null); }

    static <T> Attempt<T> fail(DomainException error) { return new Attempt<>(null, error); }

    T orThrow() {
        if (error != null) throw error;
        return value;
    }
}
