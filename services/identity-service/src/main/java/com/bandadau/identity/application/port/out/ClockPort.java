package com.bandadau.identity.application.port.out;

import java.time.Instant;

public interface ClockPort {
    Instant now();
}
