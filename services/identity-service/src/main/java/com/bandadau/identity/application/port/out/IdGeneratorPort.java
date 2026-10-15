package com.bandadau.identity.application.port.out;

import java.util.UUID;

public interface IdGeneratorPort {
    UUID newId();
}
