package com.bandadau.identity.application.port.out;

import java.util.Map;

/** HTTP idempotency records (D3 mechanism 1) kept in this service's own Postgres. */
public interface IdempotencyStorePort {

    sealed interface Outcome permits Reserved, Replay, InProgress, KeyReused { }

    record Reserved() implements Outcome { }

    record Replay(int status, Map<String, String> headers, String body) implements Outcome { }

    record InProgress() implements Outcome { }

    record KeyReused() implements Outcome { }

    Outcome reserve(String key, String requestHash, String principal);

    void complete(String key, int status, Map<String, String> headers, String body);

    void release(String key);
}
