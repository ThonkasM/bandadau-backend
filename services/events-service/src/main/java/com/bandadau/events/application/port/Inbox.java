package com.bandadau.events.application.port;

import java.util.UUID;

public interface Inbox {
    /** @return false when the message id was already processed (duplicate delivery). */
    boolean tryMarkProcessed(UUID messageId, String consumer);
}
