package com.bandadau.identity.adapter.out.external;

import com.bandadau.identity.application.port.out.RateLimitPort;
import java.time.Duration;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.LongSupplier;

/** In-memory fixed-window limiter (per instance). Default for tests; production uses {@code JdbcRateLimiter}. */
public class InMemoryRateLimiter implements RateLimitPort {
    private record Window(long start, int count) { }

    private final ConcurrentHashMap<String, Window> windows = new ConcurrentHashMap<>();
    private final LongSupplier millis;
    private final boolean enabled;

    public InMemoryRateLimiter(boolean enabled) {
        this(enabled, System::currentTimeMillis);
    }

    public InMemoryRateLimiter(boolean enabled, LongSupplier millis) {
        this.enabled = enabled;
        this.millis = millis;
    }

    @Override
    public long check(String key, int max, Duration window) {
        if (!enabled) return 0;
        long now = millis.getAsLong();
        long size = window.toMillis();
        if (windows.size() > 20_000) windows.entrySet().removeIf(e -> now - e.getValue().start() > size);
        long[] retry = {0};
        windows.compute(key, (k, w) -> {
            if (w == null || now - w.start() >= size) return new Window(now, 1);
            if (w.count() >= max) {
                retry[0] = Math.max(1, (size - (now - w.start()) + 999) / 1000);
                return w;
            }
            return new Window(w.start(), w.count() + 1);
        });
        return retry[0];
    }
}
