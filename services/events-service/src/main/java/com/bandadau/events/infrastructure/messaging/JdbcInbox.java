package com.bandadau.events.infrastructure.messaging;

import com.bandadau.events.application.port.Inbox;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;

public class JdbcInbox implements Inbox {
    private final JdbcClient jdbc;

    public JdbcInbox(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public boolean tryMarkProcessed(UUID messageId, String consumer) {
        return jdbc.sql("INSERT INTO processed_messages (message_id, consumer) VALUES (:id, :c) ON CONFLICT (message_id) DO NOTHING")
                .param("id", messageId).param("c", consumer).update() == 1;
    }
}
