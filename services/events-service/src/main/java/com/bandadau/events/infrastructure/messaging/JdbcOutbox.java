package com.bandadau.events.infrastructure.messaging;

import com.bandadau.events.application.port.IdGenerator;
import com.bandadau.events.application.port.IntegrationEventOutbox;
import com.bandadau.events.application.port.OutboxMessage;
import com.bandadau.events.domain.shared.Clock;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.slf4j.MDC;
import org.springframework.jdbc.core.simple.JdbcClient;
import tools.jackson.databind.ObjectMapper;

/** Appends CloudEvents (structured mode) to the outbox inside the caller's transaction. */
public class JdbcOutbox implements IntegrationEventOutbox {
    private static final String SOURCE = "/services/events-service";

    private final JdbcClient jdbc;
    private final ObjectMapper mapper;
    private final IdGenerator ids;
    private final Clock clock;

    public JdbcOutbox(JdbcClient jdbc, ObjectMapper mapper, IdGenerator ids, Clock clock) {
        this.jdbc = jdbc;
        this.mapper = mapper;
        this.ids = ids;
        this.clock = clock;
    }

    @Override
    public void append(OutboxMessage m) {
        UUID id = ids.newId();
        String correlation = m.correlationId() != null ? m.correlationId()
                : MDC.get("correlationId") != null ? MDC.get("correlationId") : id.toString();
        String traceparent = MDC.get("traceparent");
        Map<String, Object> ce = new LinkedHashMap<>();
        ce.put("specversion", "1.0");
        ce.put("id", id);
        ce.put("source", SOURCE);
        ce.put("type", m.type());
        ce.put("time", clock.now());
        ce.put("subject", m.subject());
        ce.put("datacontenttype", "application/json");
        ce.put("correlationid", correlation);
        if (m.causationId() != null) ce.put("causationid", m.causationId());
        if (m.sagaId() != null) ce.put("sagaid", m.sagaId());
        if (traceparent != null) ce.put("traceparent", traceparent);
        ce.put("data", m.data());
        Map<String, Object> headers = new LinkedHashMap<>();
        if (traceparent != null) headers.put("traceparent", traceparent);
        jdbc.sql("""
                INSERT INTO outbox (id, exchange, routing_key, payload, headers, aggregate_id)
                VALUES (:id, :ex, :rk, CAST(:payload AS jsonb), CAST(:headers AS jsonb), :agg)
                """)
                .param("id", id).param("ex", m.exchange()).param("rk", m.type())
                .param("payload", mapper.writeValueAsString(ce)).param("headers", mapper.writeValueAsString(headers))
                .param("agg", m.aggregateId()).update();
    }
}
