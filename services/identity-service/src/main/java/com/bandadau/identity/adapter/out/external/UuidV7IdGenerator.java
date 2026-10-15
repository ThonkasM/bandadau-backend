package com.bandadau.identity.adapter.out.external;

import com.bandadau.identity.application.port.out.IdGeneratorPort;
import java.security.SecureRandom;
import java.util.UUID;

/** RFC 9562 UUIDv7: 48-bit unix-ms timestamp followed by random bits. */
public class UuidV7IdGenerator implements IdGeneratorPort {
    private final SecureRandom random = new SecureRandom();

    @Override
    public UUID newId() {
        long millis = System.currentTimeMillis();
        long msb = (millis << 16) | 0x7000L | (random.nextLong() & 0x0FFFL);
        long lsb = (random.nextLong() & 0x3FFFFFFFFFFFFFFFL) | 0x8000000000000000L;
        return new UUID(msb, lsb);
    }
}
