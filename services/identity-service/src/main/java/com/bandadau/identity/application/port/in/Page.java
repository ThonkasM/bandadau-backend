package com.bandadau.identity.application.port.in;

import java.util.List;
import java.util.function.Function;

public record Page<T>(List<T> items, String nextCursor) {
    public <R> Page<R> map(Function<T, R> fn) { return new Page<>(items.stream().map(fn).toList(), nextCursor); }
}
