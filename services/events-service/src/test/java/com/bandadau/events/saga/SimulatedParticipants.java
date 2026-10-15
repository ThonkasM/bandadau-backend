package com.bandadau.events.saga;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageBuilder;
import org.springframework.amqp.core.MessageDeliveryMode;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import tools.jackson.databind.ObjectMapper;

/**
 * Stand-ins for wallet-service and ticketing-service, written from the participant rules of the saga document
 * (idempotent by operationRef/registrationId, tombstones, chaos flags). They run over the real RabbitMQ.
 */
public class SimulatedParticipants implements AutoCloseable {
    public static final String WALLET_QUEUE = "sim.wallet.commands";
    public static final String TICKETING_QUEUE = "sim.ticketing.commands";

    public final List<Map<String, Object>> commands = new CopyOnWriteArrayList<>();
    public final Map<String, Long> balances = new ConcurrentHashMap<>();
    public final Map<String, Long> debits = new ConcurrentHashMap<>();       // registrationId -> amount
    public final Map<String, Long> refunds = new ConcurrentHashMap<>();      // registrationId -> amount (0 = tombstone)
    public final Map<String, String> tickets = new ConcurrentHashMap<>();    // registrationId -> ticketId
    public final Set<String> voided = ConcurrentHashMap.newKeySet();         // registrationIds with VOIDED tombstone/ticket
    public final Set<String> usedTickets = ConcurrentHashMap.newKeySet();    // registrationIds whose ticket was used at the door
    public volatile boolean walletSilent;
    public volatile boolean ticketingFail;
    public volatile boolean ticketingSilent;

    private final RabbitTemplate rabbit;
    private final ObjectMapper mapper;
    private final UUIDGen ids = new UUIDGen();
    private volatile boolean running = true;
    private final Thread thread;

    public SimulatedParticipants(RabbitTemplate rabbit, ObjectMapper mapper) {
        this.rabbit = rabbit;
        this.mapper = mapper;
        this.thread = Thread.ofPlatform().daemon().name("simulated-participants").start(this::loop);
    }

    private static final class UUIDGen {
        UUID next() { return UUID.randomUUID(); }
    }

    private void loop() {
        while (running) {
            try {
                Message m = rabbit.receive(WALLET_QUEUE, 50);
                if (m != null) handle(m);
                m = rabbit.receive(TICKETING_QUEUE, 50);
                if (m != null) handle(m);
            } catch (RuntimeException e) {
                if (running) sleep(100);
            }
        }
    }

    @SuppressWarnings("unchecked")
    private void handle(Message message) {
        Map<String, Object> ce = mapper.readValue(new String(message.getBody(), StandardCharsets.UTF_8), Map.class);
        commands.add(ce);
        String type = (String) ce.get("type");
        Map<String, Object> d = (Map<String, Object>) ce.get("data");
        String reg = (String) d.get("registrationId");
        String saga = (String) d.get("sagaId");
        switch (type) {
            case "bandada.wallet.cmd.debit-credits.v1" -> {
                if (walletSilent) return;
                long amount = ((Number) d.get("amountCredits")).longValue();
                String user = (String) d.get("userId");
                if (refunds.containsKey(reg)) {
                    reply("bandada.wallet.credits-debit-failed.v1", ce, Map.of("sagaId", saga, "registrationId", reg, "userId", user,
                            "reason", "SAGA_ABORTED", "requiredCredits", amount, "balanceCredits", balances.getOrDefault(user, 0L)));
                } else if (debits.containsKey(reg)) {
                    reply("bandada.wallet.credits-debited.v1", ce, debited(saga, reg, user, amount));
                } else if (!balances.containsKey(user)) {
                    reply("bandada.wallet.credits-debit-failed.v1", ce, failed(saga, reg, user, amount, "WALLET_NOT_FOUND", null));
                } else if (balances.get(user) < amount) {
                    reply("bandada.wallet.credits-debit-failed.v1", ce, failed(saga, reg, user, amount, "INSUFFICIENT_FUNDS", balances.get(user)));
                } else {
                    balances.merge(user, -amount, Long::sum);
                    debits.put(reg, amount);
                    reply("bandada.wallet.credits-debited.v1", ce, debited(saga, reg, user, amount));
                }
            }
            case "bandada.wallet.cmd.refund-credits.v1" -> {
                String user = (String) d.get("userId");
                Long debited = debits.get(reg);
                if (!refunds.containsKey(reg)) {
                    long amount = debited == null ? 0 : debited;
                    refunds.put(reg, amount);
                    balances.merge(user, amount, Long::sum);
                }
                long amount = refunds.get(reg);
                Map<String, Object> data = new LinkedHashMap<>();
                data.put("sagaId", saga);
                data.put("registrationId", reg);
                data.put("userId", user);
                data.put("ledgerEntryId", amount == 0 ? null : ids.next().toString());
                data.put("amountCredits", amount);
                data.put("balanceCredits", balances.getOrDefault(user, 0L));
                data.put("occurredAt", Instant.now().toString());
                reply("bandada.wallet.credits-refunded.v1", ce, data);
            }
            case "bandada.ticketing.cmd.issue-ticket.v1" -> {
                if (ticketingSilent) return;
                if (voided.contains(reg)) {
                    reply("bandada.ticketing.ticket-issue-failed.v1", ce, Map.of("sagaId", saga, "registrationId", reg,
                            "reason", "ALREADY_VOIDED", "detail", "voided", "occurredAt", Instant.now().toString()));
                } else if (ticketingFail) {
                    reply("bandada.ticketing.ticket-issue-failed.v1", ce, Map.of("sagaId", saga, "registrationId", reg,
                            "reason", "CHAOS_INJECTED", "detail", "chaos", "occurredAt", Instant.now().toString()));
                } else {
                    String ticket = tickets.computeIfAbsent(reg, r -> ids.next().toString());
                    reply("bandada.ticketing.ticket-issued.v1", ce, Map.of("sagaId", saga, "registrationId", reg, "ticketId", ticket,
                            "eventId", d.get("eventId"), "userId", d.get("userId"), "occurredAt", Instant.now().toString()));
                }
            }
            case "bandada.ticketing.cmd.void-ticket.v1" -> {
                if (ticketingSilent) return;
                if (usedTickets.contains(reg)) {
                    reply("bandada.ticketing.ticket-void-failed.v1", ce, Map.of("sagaId", saga, "registrationId", reg,
                            "ticketId", tickets.getOrDefault(reg, ids.next().toString()), "reason", "TICKET_ALREADY_USED",
                            "usedAt", Instant.now().toString(), "occurredAt", Instant.now().toString()));
                } else {
                    voided.add(reg);
                    Map<String, Object> data = new LinkedHashMap<>();
                    data.put("sagaId", saga);
                    data.put("registrationId", reg);
                    data.put("ticketId", tickets.get(reg));
                    data.put("occurredAt", Instant.now().toString());
                    reply("bandada.ticketing.ticket-voided.v1", ce, data);
                }
            }
            default -> { }
        }
    }

    private Map<String, Object> debited(String saga, String reg, String user, long amount) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("sagaId", saga);
        data.put("registrationId", reg);
        data.put("userId", user);
        data.put("ledgerEntryId", ids.next().toString());
        data.put("amountCredits", amount);
        data.put("balanceCredits", balances.getOrDefault(user, 0L));
        data.put("occurredAt", Instant.now().toString());
        return data;
    }

    private Map<String, Object> failed(String saga, String reg, String user, long amount, String reason, Long balance) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("sagaId", saga);
        data.put("registrationId", reg);
        data.put("userId", user);
        data.put("reason", reason);
        data.put("requiredCredits", amount);
        data.put("balanceCredits", balance);
        data.put("occurredAt", Instant.now().toString());
        return data;
    }

    private void reply(String type, Map<String, Object> command, Map<String, Object> data) {
        publish(type, UUID.randomUUID(), (String) command.get("sagaid"), data);
    }

    /** Publishes a participant response CloudEvent to bandada.events (also used by tests for duplicates/late replies). */
    public void publish(String type, UUID messageId, String sagaId, Map<String, Object> data) {
        Map<String, Object> ce = new LinkedHashMap<>();
        ce.put("specversion", "1.0");
        ce.put("id", messageId.toString());
        ce.put("source", type.contains("wallet") ? "/services/wallet-service" : "/services/ticketing-service");
        ce.put("type", type);
        ce.put("time", Instant.now().toString());
        ce.put("datacontenttype", "application/json");
        ce.put("correlationid", "sim");
        ce.put("sagaid", sagaId);
        ce.put("data", data);
        Message message = MessageBuilder.withBody(mapper.writeValueAsString(ce).getBytes(StandardCharsets.UTF_8))
                .setContentType("application/cloudevents+json").setMessageId(messageId.toString()).setType(type)
                .setDeliveryMode(MessageDeliveryMode.PERSISTENT).build();
        rabbit.send("bandada.events", type, message);
    }

    public List<Map<String, Object>> commandsOfType(String type) {
        return commands.stream().filter(c -> type.equals(c.get("type"))).toList();
    }

    private static void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    @Override
    public void close() {
        running = false;
        try {
            thread.join(2000);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
