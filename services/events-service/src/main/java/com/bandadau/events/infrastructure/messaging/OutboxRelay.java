package com.bandadau.events.infrastructure.messaging;

import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageBuilder;
import org.springframework.amqp.core.MessageBuilderSupport;
import org.springframework.amqp.core.MessageDeliveryMode;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

/** Publishes pending outbox rows to RabbitMQ with publisher confirms (at-least-once). */
public class OutboxRelay {
    private static final Logger log = LoggerFactory.getLogger(OutboxRelay.class);

    private record Row(UUID id, String exchange, String routingKey, String payload, String headers, String correlation) { }

    private final JdbcClient jdbc;
    private final TransactionTemplate tx;
    private final RabbitTemplate rabbit;
    private final ObjectMapper mapper;
    private final int batchSize;

    public OutboxRelay(JdbcClient jdbc, TransactionTemplate tx, RabbitTemplate rabbit, ObjectMapper mapper, int batchSize) {
        this.jdbc = jdbc;
        this.tx = tx;
        this.rabbit = rabbit;
        this.mapper = mapper;
        this.batchSize = batchSize;
    }

    @Scheduled(fixedDelayString = "${bandada.outbox.relay-interval:PT1S}")
    public void relay() {
        try {
            tx.executeWithoutResult(status -> publishBatch());
        } catch (RuntimeException e) {
            log.warn("event=outbox.relay.failed error={}", e.toString());
        }
    }

    void publishBatch() {
        List<Row> rows = jdbc.sql("""
                SELECT id, exchange, routing_key, payload::text AS payload, headers::text AS headers,
                       payload->>'correlationid' AS correlation
                FROM outbox WHERE published_at IS NULL ORDER BY created_at LIMIT :limit FOR UPDATE SKIP LOCKED
                """)
                .param("limit", batchSize)
                .query((rs, n) -> new Row(rs.getObject("id", UUID.class), rs.getString("exchange"),
                        rs.getString("routing_key"), rs.getString("payload"), rs.getString("headers"),
                        rs.getString("correlation")))
                .list();
        for (Row row : rows) {
            try {
                send(row);
                jdbc.sql("UPDATE outbox SET published_at = now(), attempts = attempts + 1 WHERE id = :id")
                        .param("id", row.id()).update();
            } catch (RuntimeException e) {
                jdbc.sql("UPDATE outbox SET attempts = attempts + 1, last_error = :err WHERE id = :id")
                        .param("err", String.valueOf(e.getMessage())).param("id", row.id()).update();
                log.warn("event=outbox.publish.failed id={} routingKey={} error={}", row.id(), row.routingKey(), e.toString());
                return;
            }
        }
    }

    private void send(Row row) {
        Map<String, String> headers = mapper.readValue(row.headers(), new TypeReference<Map<String, String>>() { });
        MessageBuilderSupport<Message> builder = MessageBuilder.withBody(row.payload().getBytes(StandardCharsets.UTF_8))
                .setContentType("application/cloudevents+json")
                .setContentEncoding("UTF-8")
                .setMessageId(row.id().toString())
                .setType(row.routingKey())
                .setTimestamp(new Date())
                .setDeliveryMode(MessageDeliveryMode.PERSISTENT);
        if (row.correlation() != null) builder.setCorrelationId(row.correlation());
        headers.forEach(builder::setHeader);
        Message message = builder.build();
        rabbit.invoke(ops -> {
            ops.send(row.exchange(), row.routingKey(), message);
            ops.waitForConfirmsOrDie(5_000);
            return null;
        });
    }
}
