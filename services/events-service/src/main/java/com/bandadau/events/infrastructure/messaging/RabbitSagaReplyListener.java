package com.bandadau.events.infrastructure.messaging;

import com.bandadau.events.application.saga.RegistrationSagaOrchestrator;
import com.rabbitmq.client.Channel;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageBuilder;
import org.springframework.amqp.core.MessageDeliveryMode;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import tools.jackson.databind.ObjectMapper;

/**
 * Consumes {@code events-service.saga-replies} with manual ack after commit. Transient failures go to the wait queues
 * ({@code .retry.5s/30s/5m}, up to three times) and permanent ones (bad payload, unknown type) to the DLQ.
 */
public class RabbitSagaReplyListener {
    private static final Logger log = LoggerFactory.getLogger(RabbitSagaReplyListener.class);
    static final String QUEUE = "events-service.saga-replies";
    private static final String[] WAIT_QUEUES = {QUEUE + ".retry.5s", QUEUE + ".retry.30s", QUEUE + ".retry.5m"};

    private final RegistrationSagaOrchestrator orchestrator;
    private final ObjectMapper mapper;
    private final RabbitTemplate rabbit;

    public RabbitSagaReplyListener(RegistrationSagaOrchestrator orchestrator, ObjectMapper mapper, RabbitTemplate rabbit) {
        this.orchestrator = orchestrator;
        this.mapper = mapper;
        this.rabbit = rabbit;
    }

    @RabbitListener(queues = QUEUE, ackMode = "MANUAL")
    @SuppressWarnings("unchecked")
    public void onMessage(Message message, Channel channel) throws IOException {
        long tag = message.getMessageProperties().getDeliveryTag();
        UUID id;
        String type;
        Map<String, Object> data;
        try {
            Map<String, Object> ce = mapper.readValue(new String(message.getBody(), StandardCharsets.UTF_8), Map.class);
            id = UUID.fromString(String.valueOf(ce.get("id")));
            type = String.valueOf(ce.get("type"));
            data = (Map<String, Object>) ce.get("data");
            if (data == null) throw new IllegalArgumentException("missing data");
            Object correlation = ce.get("correlationid");
            if (correlation != null) MDC.put("correlationId", String.valueOf(correlation));
        } catch (RuntimeException e) {
            log.error("event=saga.reply.invalid error={}", e.toString());
            channel.basicNack(tag, false, false);
            return;
        }
        try {
            orchestrator.handleReply(id, type, data);
            channel.basicAck(tag, false);
        } catch (IllegalArgumentException e) {
            log.error("event=saga.reply.permanent_error messageId={} error={}", id, e.toString());
            channel.basicNack(tag, false, false);
        } catch (RuntimeException e) {
            log.warn("event=saga.reply.transient_error messageId={} error={}", id, e.toString());
            retryLater(message, channel, tag);
        } finally {
            MDC.remove("correlationId");
        }
    }

    private void retryLater(Message message, Channel channel, long tag) throws IOException {
        Object count = message.getMessageProperties().getHeader("x-retry-count");
        int n = count instanceof Number num ? num.intValue() : 0;
        if (n >= WAIT_QUEUES.length) {
            channel.basicNack(tag, false, false);
            return;
        }
        try {
            Message copy = MessageBuilder.fromMessage(message).setHeader("x-retry-count", n + 1)
                    .setDeliveryMode(MessageDeliveryMode.PERSISTENT).build();
            rabbit.invoke(ops -> {
                ops.send("", WAIT_QUEUES[n], copy);
                ops.waitForConfirmsOrDie(5_000);
                return null;
            });
            channel.basicAck(tag, false);
        } catch (RuntimeException e) {
            // Wait queue missing or broker trouble: do not lose the message, redeliver after a short pause.
            try {
                Thread.sleep(1_000);
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
            }
            channel.basicNack(tag, false, true);
        }
    }
}
