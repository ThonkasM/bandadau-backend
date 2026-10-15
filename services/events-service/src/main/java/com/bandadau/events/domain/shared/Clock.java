package com.bandadau.events.domain.shared;

import java.time.Instant;

public interface Clock {
    Instant now();
}
