package com.bandadau.events.application.port;

import java.util.Map;
import java.util.UUID;

/** An integration message (event or command) to append to the transactional outbox. */
public record OutboxMessage(String exchange, String type, String subject, UUID aggregateId, UUID sagaId,
                            UUID causationId, String correlationId, Map<String, Object> data) {
    public static final String EVENTS = "bandada.events";
    public static final String COMMANDS = "bandada.commands";
}
