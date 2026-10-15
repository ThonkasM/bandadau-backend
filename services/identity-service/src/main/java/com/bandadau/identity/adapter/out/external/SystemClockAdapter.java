package com.bandadau.identity.adapter.out.external;

import com.bandadau.identity.application.port.out.ClockPort;
import java.time.Clock;
import java.time.Instant;

public class SystemClockAdapter implements ClockPort {
    private final Clock clock;

    public SystemClockAdapter(Clock clock) {
        this.clock = clock;
    }

    @Override
    public Instant now() { return clock.instant(); }
}
