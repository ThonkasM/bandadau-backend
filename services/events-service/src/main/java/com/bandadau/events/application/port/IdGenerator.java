package com.bandadau.events.application.port;

import java.util.UUID;

public interface IdGenerator {
    UUID newId();
}
