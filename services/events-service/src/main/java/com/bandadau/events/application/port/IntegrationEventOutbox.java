package com.bandadau.events.application.port;

public interface IntegrationEventOutbox {
    void append(OutboxMessage message);
}
