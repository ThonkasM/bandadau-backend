package com.bandadau.events.saga;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.*;
import org.springframework.amqp.core.AmqpAdmin;
import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.containers.RabbitMQContainer;
import tools.jackson.databind.ObjectMapper;

/** End-to-end saga scenarios S1-S10 over real Postgres and RabbitMQ with simulated wallet/ticketing. */
@Tag("integration")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class EventsIntegrationTest {
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:18-alpine");
    static final RabbitMQContainer RABBIT = new RabbitMQContainer("rabbitmq:4-management-alpine");
    static FakeNeighbours neighbours;

    static {
        POSTGRES.start();
        RABBIT.start();
        try {
            neighbours = new FakeNeighbours();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
        r.add("spring.rabbitmq.addresses", () -> "amqp://" + RABBIT.getAdminUsername() + ":" + RABBIT.getAdminPassword()
                + "@" + RABBIT.getHost() + ":" + RABBIT.getAmqpPort());
        r.add("bandada.jwt.jwks-url", () -> neighbours.baseUrl() + "/.well-known/jwks.json");
        r.add("bandada.identity.url", () -> neighbours.baseUrl());
        r.add("bandada.media.url", () -> neighbours.baseUrl());
    }

    @LocalServerPort int port;
    @Autowired ObjectMapper mapper;
    @Autowired AmqpAdmin amqpAdmin;
    @Autowired RabbitTemplate rabbit;
    @Autowired JdbcClient jdbc;

    static SimulatedParticipants participants;
    static final UUID UNI = UUID.randomUUID();
    static final UUID ORGANIZER = UUID.randomUUID();
    static final List<Map<String, Object>> EVENTS_SEEN = new CopyOnWriteArrayList<>();
    final HttpClient http = HttpClient.newHttpClient();

    record Resp(int status, Map<String, Object> body, HttpResponse<String> raw) {
        String header(String n) { return raw.headers().firstValue(n).orElse(null); }
        @SuppressWarnings("unchecked") Map<String, Object> map(String k) { return (Map<String, Object>) body.get(k); }
    }

    @SuppressWarnings("unchecked")
    Map<String, Object> json(String s) { return s == null || s.isBlank() ? Map.of() : mapper.readValue(s, Map.class); }

    Resp call(String method, String path, Object body, String token, String... headers) throws Exception {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).method(method,
                body == null ? HttpRequest.BodyPublishers.noBody()
                        : HttpRequest.BodyPublishers.ofString(body instanceof String s ? s : mapper.writeValueAsString(body)));
        if (body != null) b.header("Content-Type", "application/json");
        if (token != null) b.header("Authorization", "Bearer " + token);
        for (int i = 0; i < headers.length; i += 2) b.header(headers[i], headers[i + 1]);
        HttpResponse<String> r = http.send(b.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        return new Resp(r.statusCode(), json(r.body()), r);
    }

    String organizer() { return neighbours.userToken(ORGANIZER, UNI, "STUDENT", "ORGANIZER"); }

    String student(UUID id) { return neighbours.userToken(id, UNI, "STUDENT"); }

    String key() { return UUID.randomUUID().toString(); }

    @BeforeEach
    void ensureInfrastructure() {
        if (participants == null) {
            synchronized (EventsIntegrationTest.class) {
                if (participants == null) {
                    for (String q : List.of(SimulatedParticipants.WALLET_QUEUE, SimulatedParticipants.TICKETING_QUEUE, "spy.events")) {
                        amqpAdmin.declareQueue(new Queue(q, true, false, false));
                    }
                    amqpAdmin.declareBinding(new Binding(SimulatedParticipants.WALLET_QUEUE, Binding.DestinationType.QUEUE, "bandada.commands", "bandada.wallet.cmd.#", null));
                    amqpAdmin.declareBinding(new Binding(SimulatedParticipants.TICKETING_QUEUE, Binding.DestinationType.QUEUE, "bandada.commands", "bandada.ticketing.cmd.#", null));
                    amqpAdmin.declareBinding(new Binding("spy.events", Binding.DestinationType.QUEUE, "bandada.events", "bandada.events.#", null));
                    participants = new SimulatedParticipants(rabbit, mapper);
                }
            }
        }
        participants.walletSilent = false;
        participants.ticketingFail = false;
        participants.ticketingSilent = false;
    }

    @AfterAll
    static void stop() throws Exception {
        if (participants != null) participants.close();
        neighbours.close();
    }

    // ---- helpers --------------------------------------------------------------------------------

    String createPublishedEvent(int capacity, long price, Instant startsAt) throws Exception {
        Resp created = call("POST", "/api/v1/events", Map.of("title", "Taller de Docker " + UUID.randomUUID(), "description", "d",
                "startsAt", startsAt.toString(), "venue", "Auditorio UMSA", "capacity", capacity, "priceCredits", price),
                organizer(), "Idempotency-Key", key());
        assertThat(created.status()).isEqualTo(201);
        String id = (String) created.body().get("id");
        assertThat(call("POST", "/api/v1/events/" + id + "/publish", null, organizer()).status()).isEqualTo(200);
        return id;
    }

    String createPublishedEvent(int capacity, long price) throws Exception {
        return createPublishedEvent(capacity, price, Instant.now().plus(Duration.ofDays(5)));
    }

    Resp register(String eventId, UUID user, String key) throws Exception {
        return call("POST", "/api/v1/events/" + eventId + "/registrations", null, student(user), "Idempotency-Key", key);
    }

    String registrationStatus(String registrationId, UUID user) throws Exception {
        return (String) call("GET", "/api/v1/registrations/" + registrationId, null, student(user)).body().get("status");
    }

    Resp awaitStatus(String registrationId, UUID user, String expected) {
        return await().atMost(Duration.ofSeconds(30)).pollInterval(Duration.ofMillis(250)).until(() -> {
            Resp r = call("GET", "/api/v1/registrations/" + registrationId, null, student(user));
            return r;
        }, r -> expected.equals(r.body().get("status")));
    }

    int seatsTaken(String eventId) throws Exception {
        return ((Number) call("GET", "/api/v1/events/" + eventId, null, organizer()).body().get("seatsTaken")).intValue();
    }

    UUID funded(long credits) {
        UUID user = UUID.randomUUID();
        participants.balances.put(user.toString(), credits);
        return user;
    }

    void drain() {
        Message m;
        while ((m = rabbit.receive("spy.events", 50)) != null) {
            EVENTS_SEEN.add(json(new String(m.getBody(), StandardCharsets.UTF_8)));
        }
    }

    @SuppressWarnings("unchecked")
    List<Map<String, Object>> eventsOf(String type, String registrationId) {
        drain();
        return EVENTS_SEEN.stream().filter(e -> type.equals(e.get("type")) && registrationId.equals(((Map<String, Object>) e.get("data")).get("registrationId"))).toList();
    }

    void awaitEvent(String type, String registrationId) {
        await().atMost(Duration.ofSeconds(15)).pollInterval(Duration.ofMillis(300)).until(() -> !eventsOf(type, registrationId).isEmpty());
    }

    @SuppressWarnings("unchecked")
    List<Map<String, Object>> commandsFor(String type, String registrationId) {
        return participants.commandsOfType(type).stream().filter(c -> registrationId.equals(((Map<String, Object>) c.get("data")).get("registrationId"))).toList();
    }

    // ---- S1: happy path with a paid event ---------------------------------------------------------

    @Test
    void s1_paidRegistrationIsConfirmedWithOneDebitAndOneTicket() throws Exception {
        String eventId = createPublishedEvent(10, 20);
        UUID user = funded(100);
        Resp accepted = register(eventId, user, key());
        assertThat(accepted.status()).isEqualTo(202);
        assertThat(accepted.header("Location")).startsWith("/api/v1/registrations/");
        assertThat(accepted.header("Retry-After")).isEqualTo("1");
        assertThat(accepted.body()).containsEntry("status", "PENDING").containsEntry("priceCredits", 20);
        String regId = (String) accepted.body().get("id");

        Resp done = awaitStatus(regId, user, "CONFIRMED");
        assertThat(done.body().get("ticketId")).isNotNull();
        assertThat(done.body().get("confirmedAt")).isNotNull();
        assertThat(done.header("Retry-After")).isNull();
        assertThat(participants.balances.get(user.toString())).isEqualTo(80L);
        assertThat(commandsFor("bandada.wallet.cmd.debit-credits.v1", regId)).hasSize(1);
        assertThat(commandsFor("bandada.ticketing.cmd.issue-ticket.v1", regId)).hasSize(1);
        assertThat(seatsTaken(eventId)).isEqualTo(1);

        awaitEvent("bandada.events.registration.confirmed.v1", regId);
        @SuppressWarnings("unchecked") Map<String, Object> data = (Map<String, Object>) eventsOf("bandada.events.registration.confirmed.v1", regId).get(0).get("data");
        assertThat(data).containsEntry("userId", user.toString()).containsEntry("priceCredits", 20).containsKeys("sagaId", "ticketId", "eventTitle", "eventStartsAt");

        Map<String, Object> command = commandsFor("bandada.wallet.cmd.debit-credits.v1", regId).get(0);
        @SuppressWarnings("unchecked") Map<String, Object> cd = (Map<String, Object>) command.get("data");
        assertThat((String) cd.get("idempotencyKey")).isEqualTo(cd.get("sagaId") + ":DEBIT_CREDITS");
        assertThat(command).containsEntry("sagaid", cd.get("sagaId")).containsKey("correlationid");
        assertThat(cd).containsKeys("deadlineAt", "description", "amountCredits");

        Resp mine = call("GET", "/api/v1/registrations/me?status=CONFIRMED", null, student(user));
        assertThat((List<?>) mine.body().get("items")).hasSize(1);
    }

    // ---- S2: free event ---------------------------------------------------------------------------

    @Test
    void s2_freeEventSkipsTheWallet() throws Exception {
        String eventId = createPublishedEvent(10, 0);
        UUID user = UUID.randomUUID();
        String regId = (String) register(eventId, user, key()).body().get("id");
        awaitStatus(regId, user, "CONFIRMED");
        assertThat(commandsFor("bandada.wallet.cmd.debit-credits.v1", regId)).isEmpty();
        assertThat(commandsFor("bandada.ticketing.cmd.issue-ticket.v1", regId)).hasSize(1);
    }

    // ---- S3: insufficient funds -----------------------------------------------------------------------

    @Test
    void s3_insufficientFundsFailsReleasesTheSeatAndEmitsFailed() throws Exception {
        String eventId = createPublishedEvent(10, 50);
        UUID user = funded(10);
        String regId = (String) register(eventId, user, key()).body().get("id");
        Resp failed = awaitStatus(regId, user, "FAILED");
        assertThat(failed.body()).containsEntry("failureReason", "INSUFFICIENT_FUNDS");
        assertThat(seatsTaken(eventId)).isZero();
        assertThat(commandsFor("bandada.ticketing.cmd.issue-ticket.v1", regId)).isEmpty();
        awaitEvent("bandada.events.registration.failed.v1", regId);
        // after a top-up the user can register again with a NEW key
        participants.balances.put(user.toString(), 100L);
        String again = (String) register(eventId, user, key()).body().get("id");
        awaitStatus(again, user, "CONFIRMED");
    }

    @Test
    void s3b_unknownWalletFailsWithWalletNotFound() throws Exception {
        String eventId = createPublishedEvent(10, 5);
        UUID user = UUID.randomUUID();
        String regId = (String) register(eventId, user, key()).body().get("id");
        assertThat(awaitStatus(regId, user, "FAILED").body()).containsEntry("failureReason", "WALLET_NOT_FOUND");
    }

    // ---- S4: ticketing failure -> compensation ------------------------------------------------------

    @Test
    void s4_ticketingFailureRefundsTheSameAmountAndReleasesTheSeat() throws Exception {
        participants.ticketingFail = true;
        String eventId = createPublishedEvent(10, 20);
        UUID user = funded(100);
        String regId = (String) register(eventId, user, key()).body().get("id");
        Resp failed = awaitStatus(regId, user, "FAILED");
        assertThat(failed.body()).containsEntry("failureReason", "TICKET_ISSUE_FAILED");
        assertThat(participants.balances.get(user.toString())).isEqualTo(100L);
        assertThat(participants.debits.get(regId)).isEqualTo(20L);
        assertThat(participants.refunds.get(regId)).isEqualTo(20L);
        assertThat(seatsTaken(eventId)).isZero();
        awaitEvent("bandada.events.registration.failed.v1", regId);
        assertThat(jdbc.sql("SELECT status FROM saga_instances WHERE registration_id = :r").param("r", UUID.fromString(regId))
                .query(String.class).single()).isEqualTo("COMPENSATED");
    }

    // ---- S5: wallet timeout + late debit ---------------------------------------------------------------

    @Test
    void s5_walletTimeoutResendsThenCompensatesAndALateDebitIsRefunded() throws Exception {
        participants.walletSilent = true;
        String eventId = createPublishedEvent(10, 20);
        UUID user = funded(100);
        String regId = (String) register(eventId, user, key()).body().get("id");
        Resp failed = awaitStatus(regId, user, "FAILED");
        assertThat(failed.body()).containsEntry("failureReason", "TIMEOUT");
        assertThat(seatsTaken(eventId)).isZero();

        List<Map<String, Object>> debits = commandsFor("bandada.wallet.cmd.debit-credits.v1", regId);
        assertThat(debits.size()).isGreaterThanOrEqualTo(2);                       // original + business resends
        Object firstKey = ((Map<?, ?>) debits.get(0).get("data")).get("idempotencyKey");
        assertThat(debits.stream().allMatch(c -> firstKey.equals(((Map<?, ?>) c.get("data")).get("idempotencyKey")))).isTrue(); // same key on every resend
        assertThat(debits.stream().map(c -> c.get("id")).distinct().count()).isEqualTo(debits.size());  // but a new CloudEvent id
        assertThat(commandsFor("bandada.wallet.cmd.refund-credits.v1", regId)).isNotEmpty();

        // the wallet finally answers the debit: the saga is terminal, so a defensive refund goes out
        int refundsBefore = commandsFor("bandada.wallet.cmd.refund-credits.v1", regId).size();
        String sagaId = (String) ((Map<?, ?>) debits.get(0).get("data")).get("sagaId");
        participants.publish("bandada.wallet.credits-debited.v1", UUID.randomUUID(), sagaId, Map.of("sagaId", sagaId,
                "registrationId", regId, "userId", user.toString(), "ledgerEntryId", UUID.randomUUID().toString(),
                "amountCredits", 20, "balanceCredits", 80, "occurredAt", Instant.now().toString()));
        await().atMost(Duration.ofSeconds(10)).until(() -> commandsFor("bandada.wallet.cmd.refund-credits.v1", regId).size() > refundsBefore);
        assertThat(registrationStatus(regId, user)).isEqualTo("FAILED");
    }

    // ---- S6: duplicates ----------------------------------------------------------------------------------

    @Test
    void s6_redeliveredAndRepeatedRepliesCauseASingleTicketCommand() throws Exception {
        participants.walletSilent = true;       // we answer by hand
        String eventId = createPublishedEvent(10, 20);
        UUID user = funded(100);
        String regId = (String) register(eventId, user, key()).body().get("id");
        await().atMost(Duration.ofSeconds(10)).until(() -> !commandsFor("bandada.wallet.cmd.debit-credits.v1", regId).isEmpty());
        @SuppressWarnings("unchecked") String sagaId = (String) ((Map<String, Object>) commandsFor("bandada.wallet.cmd.debit-credits.v1", regId).get(0).get("data")).get("sagaId");
        Map<String, Object> debited = Map.of("sagaId", sagaId, "registrationId", regId, "userId", user.toString(),
                "ledgerEntryId", UUID.randomUUID().toString(), "amountCredits", 20, "balanceCredits", 80, "occurredAt", Instant.now().toString());
        UUID messageId = UUID.randomUUID();
        participants.publish("bandada.wallet.credits-debited.v1", messageId, sagaId, debited);     // original
        participants.publish("bandada.wallet.credits-debited.v1", messageId, sagaId, debited);     // broker redelivery (same id)
        participants.publish("bandada.wallet.credits-debited.v1", UUID.randomUUID(), sagaId, debited); // re-published after a resend
        awaitStatus(regId, user, "CONFIRMED");
        Thread.sleep(1500);
        assertThat(commandsFor("bandada.ticketing.cmd.issue-ticket.v1", regId)).hasSize(1);
        assertThat(jdbc.sql("SELECT count(*) FROM processed_messages WHERE message_id = :id").param("id", messageId).query(Integer.class).single()).isEqualTo(1);
    }

    // ---- S9: cancellation -------------------------------------------------------------------------------

    @Test
    void s9_cancellationVoidsRefundsAndReleasesTheSeat() throws Exception {
        String eventId = createPublishedEvent(10, 20);
        UUID user = funded(100);
        String regId = (String) register(eventId, user, key()).body().get("id");
        awaitStatus(regId, user, "CONFIRMED");

        String cancelKey = key();
        Resp cancel = call("POST", "/api/v1/registrations/" + regId + "/cancel", null, student(user), "Idempotency-Key", cancelKey);
        assertThat(cancel.status()).isEqualTo(202);
        assertThat(cancel.body()).containsEntry("status", "CANCELLATION_PENDING");
        Resp replay = call("POST", "/api/v1/registrations/" + regId + "/cancel", null, student(user), "Idempotency-Key", cancelKey);
        assertThat(replay.header("Idempotent-Replayed")).isEqualTo("true");

        Resp done = awaitStatus(regId, user, "CANCELLED");
        assertThat(done.body().get("cancelledAt")).isNotNull();
        assertThat(participants.balances.get(user.toString())).isEqualTo(100L);
        assertThat(seatsTaken(eventId)).isZero();
        awaitEvent("bandada.events.registration.cancelled.v1", regId);
        @SuppressWarnings("unchecked") Map<String, Object> data = (Map<String, Object>) eventsOf("bandada.events.registration.cancelled.v1", regId).get(0).get("data");
        assertThat(data).containsEntry("refundedCredits", 20);
        assertThat(eventsOf("bandada.events.registration.cancelled.v1", regId)).hasSize(1);

        Resp again = call("POST", "/api/v1/registrations/" + regId + "/cancel", null, student(user), "Idempotency-Key", key());
        assertThat(again.status()).isEqualTo(409);
        assertThat(again.body().get("code")).isEqualTo("INVALID_REGISTRATION_STATUS");
        assertThat(register(eventId, user, key()).status()).isEqualTo(202);   // RN-13.6: can register again
    }

    @Test
    void s9b_cancellationIsRejectedInsideThe24HourWindowAndForOtherUsers() throws Exception {
        String eventId = createPublishedEvent(10, 0, Instant.now().plus(Duration.ofHours(2)));
        UUID user = UUID.randomUUID();
        String regId = (String) register(eventId, user, key()).body().get("id");
        awaitStatus(regId, user, "CONFIRMED");
        Resp late = call("POST", "/api/v1/registrations/" + regId + "/cancel", null, student(user), "Idempotency-Key", key());
        assertThat(late.status()).isEqualTo(422);
        assertThat(late.body().get("code")).isEqualTo("CANCELLATION_WINDOW_CLOSED");
        assertThat(call("POST", "/api/v1/registrations/" + regId + "/cancel", null, student(UUID.randomUUID()), "Idempotency-Key", key()).status()).isEqualTo(404);
        assertThat(call("GET", "/api/v1/registrations/" + regId, null, student(UUID.randomUUID())).status()).isEqualTo(404);
    }

    @Test
    void s9c_aUsedTicketRejectsTheCancellationAndTheRegistrationStaysConfirmed() throws Exception {
        String eventId = createPublishedEvent(10, 20);
        UUID user = funded(100);
        String regId = (String) register(eventId, user, key()).body().get("id");
        awaitStatus(regId, user, "CONFIRMED");
        participants.usedTickets.add(regId);
        call("POST", "/api/v1/registrations/" + regId + "/cancel", null, student(user), "Idempotency-Key", key());
        await().atMost(Duration.ofSeconds(15)).until(() -> jdbc.sql("SELECT status FROM saga_instances WHERE registration_id = :r AND type = 'CANCELLATION'")
                .param("r", UUID.fromString(regId)).query(String.class).optional().orElse("").equals("FAILED"));
        assertThat(registrationStatus(regId, user)).isEqualTo("CONFIRMED");
        assertThat(seatsTaken(eventId)).isEqualTo(1);
    }

    // ---- S10 + idempotency ---------------------------------------------------------------------------------

    @Test
    void s10_concurrentRegistrationsNeverOversellTheEvent() throws Exception {
        String eventId = createPublishedEvent(3, 0);
        ExecutorService pool = Executors.newFixedThreadPool(12);
        List<Future<Resp>> futures = new ArrayList<>();
        for (int i = 0; i < 12; i++) {
            UUID user = UUID.randomUUID();
            futures.add(pool.submit(() -> register(eventId, user, key())));
        }
        int accepted = 0;
        int full = 0;
        for (Future<Resp> f : futures) {
            Resp r = f.get(30, TimeUnit.SECONDS);
            if (r.status() == 202) accepted++;
            else if (r.status() == 409 && "EVENT_FULL".equals(r.body().get("code"))) full++;
        }
        pool.shutdown();
        assertThat(accepted).isEqualTo(3);
        assertThat(full).isEqualTo(9);
        await().atMost(Duration.ofSeconds(20)).until(() -> jdbc.sql("SELECT count(*) FROM registrations WHERE event_id = :e AND status = 'CONFIRMED'")
                .param("e", UUID.fromString(eventId)).query(Integer.class).single() == 3);
        assertThat(seatsTaken(eventId)).isEqualTo(3);
    }

    @Test
    void idempotencyKeyRulesAndPartialUniqueIndex() throws Exception {
        String eventId = createPublishedEvent(10, 0);
        UUID user = UUID.randomUUID();
        String key = key();
        Resp first = register(eventId, user, key);
        Resp replay = register(eventId, user, key);
        assertThat(replay.status()).isEqualTo(202);
        assertThat(replay.header("Idempotent-Replayed")).isEqualTo("true");
        assertThat(replay.body().get("id")).isEqualTo(first.body().get("id"));

        String otherEvent = createPublishedEvent(10, 0);
        Resp reused = register(otherEvent, user, key);
        assertThat(reused.status()).isEqualTo(422);
        assertThat(reused.body().get("code")).isEqualTo("IDEMPOTENCY_KEY_REUSED");

        Resp missing = call("POST", "/api/v1/events/" + eventId + "/registrations", null, student(user));
        assertThat(missing.status()).isEqualTo(400);
        assertThat(missing.body().get("code")).isEqualTo("IDEMPOTENCY_KEY_REQUIRED");

        Resp dup = register(eventId, user, key());
        assertThat(dup.status()).isEqualTo(409);
        assertThat(dup.body()).containsEntry("code", "ALREADY_REGISTERED").containsEntry("registrationId", first.body().get("id"));

        UUID racer = UUID.randomUUID();
        String sharedKey = key();
        ExecutorService pool = Executors.newFixedThreadPool(10);
        List<Future<Resp>> calls = new ArrayList<>();
        for (int i = 0; i < 10; i++) calls.add(pool.submit(() -> register(eventId, racer, sharedKey)));
        Set<Object> ids = new HashSet<>();
        for (Future<Resp> f : calls) {
            Resp r = f.get(30, TimeUnit.SECONDS);
            assertThat(r.status()).isIn(202, 409);
            if (r.status() == 202) ids.add(r.body().get("id"));
        }
        pool.shutdown();
        assertThat(ids).hasSize(1);
        assertThat(jdbc.sql("SELECT count(*) FROM registrations WHERE event_id = :e AND user_id = :u").param("e", UUID.fromString(eventId))
                .param("u", racer).query(Integer.class).single()).isEqualTo(1);
    }

    // ---- UC-11 ------------------------------------------------------------------------------------------------

    @Test
    void eventLifecycleValidationAndAuthorization() throws Exception {
        Resp past = call("POST", "/api/v1/events", Map.of("title", "Taller pasado", "description", "d", "startsAt",
                Instant.now().minusSeconds(60).toString(), "venue", "Aula", "capacity", 5, "priceCredits", 0), organizer(), "Idempotency-Key", key());
        assertThat(past.status()).isEqualTo(422);
        assertThat(past.body().get("code")).isEqualTo("STARTS_AT_IN_PAST");
        Resp invalid = call("POST", "/api/v1/events", Map.of("title", "x", "description", "d", "startsAt", Instant.now().plusSeconds(9999).toString(),
                "venue", "Aula", "capacity", 0, "priceCredits", -1), organizer(), "Idempotency-Key", key());
        assertThat(invalid.status()).isEqualTo(400);
        assertThat(invalid.body().get("code")).isEqualTo("VALIDATION_FAILED");
        assertThat(call("POST", "/api/v1/events", Map.of("title", "Taller de Docker", "description", "d", "startsAt",
                Instant.now().plusSeconds(99999).toString(), "venue", "Aula", "capacity", 5, "priceCredits", 0), student(UUID.randomUUID()),
                "Idempotency-Key", key()).status()).isEqualTo(403);

        Resp draft = call("POST", "/api/v1/events", Map.of("title", "Taller de Docker", "description", "d", "startsAt",
                Instant.now().plusSeconds(99999).toString(), "venue", "Aula", "capacity", 5, "priceCredits", 0), organizer(), "Idempotency-Key", key());
        String id = (String) draft.body().get("id");
        assertThat(draft.body()).containsEntry("status", "DRAFT").containsEntry("seatsAvailable", 5);
        assertThat(draft.header("Location")).isEqualTo("/api/v1/events/" + id);

        assertThat(call("GET", "/api/v1/events/" + id, null, student(UUID.randomUUID())).status()).isEqualTo(404);
        assertThat(register(id, UUID.randomUUID(), key()).status()).isEqualTo(422);
        Resp other = call("POST", "/api/v1/events/" + id + "/publish", null, neighbours.userToken(UUID.randomUUID(), UNI, "ORGANIZER"));
        assertThat(other.status()).isEqualTo(403);
        assertThat(other.body().get("code")).isEqualTo("NOT_EVENT_ORGANIZER");

        assertThat(call("POST", "/api/v1/events/" + id + "/publish", null, organizer()).status()).isEqualTo(200);
        Resp again = call("POST", "/api/v1/events/" + id + "/publish", null, organizer());
        assertThat(again.status()).isEqualTo(200);
        awaitEventPublishedOnce(id);

        Resp publicList = call("GET", "/api/v1/events?public=true&limit=50", null, null);
        assertThat(publicList.status()).isEqualTo(200);
        assertThat((List<?>) publicList.body().get("items")).isNotEmpty();
        assertThat(call("GET", "/api/v1/events", null, null).status()).isEqualTo(401);

        Resp mine = call("GET", "/api/v1/events?organizerId=" + ORGANIZER + "&status=DRAFT", null, organizer());
        assertThat(mine.status()).isEqualTo(200);
        assertThat(call("GET", "/api/v1/events?status=DRAFT", null, organizer()).status()).isEqualTo(403);

        assertThat(call("GET", "/api/v1/events?limit=0", null, organizer()).status()).isEqualTo(400);
        createPublishedEvent(5, 0);
        Resp page1 = call("GET", "/api/v1/events?public=true&limit=1", null, null);
        assertThat(page1.body().get("nextCursor")).isNotNull();
        Resp page2 = call("GET", "/api/v1/events?public=true&limit=1&cursor=" + page1.body().get("nextCursor"), null, null);
        assertThat(((Map<?, ?>) ((List<?>) page2.body().get("items")).get(0)).get("id")).isNotEqualTo(((Map<?, ?>) ((List<?>) page1.body().get("items")).get(0)).get("id"));
        assertThat(call("GET", "/api/v1/events?public=true&cursor=garbage", null, null).status()).isEqualTo(400);
    }

    void awaitEventPublishedOnce(String eventId) {
        await().atMost(Duration.ofSeconds(15)).until(() -> {
            drain();
            return EVENTS_SEEN.stream().anyMatch(e -> "bandada.events.event.published.v1".equals(e.get("type"))
                    && eventId.equals(((Map<?, ?>) e.get("data")).get("eventId")));
        });
        assertThat(EVENTS_SEEN.stream().filter(e -> "bandada.events.event.published.v1".equals(e.get("type"))
                && eventId.equals(((Map<?, ?>) e.get("data")).get("eventId"))).count()).isEqualTo(1);
    }

    @Test
    void cancellingAnEventRefundsEveryConfirmedRegistration() throws Exception {
        String eventId = createPublishedEvent(10, 20);
        List<UUID> users = List.of(funded(100), funded(100), funded(100));
        List<String> regs = new ArrayList<>();
        for (UUID u : users) regs.add((String) register(eventId, u, key()).body().get("id"));
        for (int i = 0; i < users.size(); i++) awaitStatus(regs.get(i), users.get(i), "CONFIRMED");

        String cancelKey = key();
        Resp cancelled = call("POST", "/api/v1/events/" + eventId + "/cancel", Map.of("reason", "El auditorio no estará disponible"),
                organizer(), "Idempotency-Key", cancelKey);
        assertThat(cancelled.status()).isEqualTo(202);
        assertThat(cancelled.body()).containsEntry("status", "CANCELLED");
        for (int i = 0; i < users.size(); i++) {
            awaitStatus(regs.get(i), users.get(i), "CANCELLED");
            assertThat(participants.balances.get(users.get(i).toString())).isEqualTo(100L);
        }
        assertThat(seatsTaken(eventId)).isZero();
        assertThat(register(eventId, UUID.randomUUID(), key()).status()).isEqualTo(422);
        assertThat(call("POST", "/api/v1/events/" + eventId + "/cancel", Map.of("reason", "otra vez"), organizer(), "Idempotency-Key", key()).status()).isEqualTo(409);
        await().atMost(Duration.ofSeconds(10)).until(() -> {
            drain();
            return EVENTS_SEEN.stream().anyMatch(e -> "bandada.events.event.cancelled.v1".equals(e.get("type"))
                    && eventId.equals(((Map<?, ?>) e.get("data")).get("eventId")));
        });
        @SuppressWarnings("unchecked") Map<String, Object> data = (Map<String, Object>) EVENTS_SEEN.stream().filter(e ->
                "bandada.events.event.cancelled.v1".equals(e.get("type")) && eventId.equals(((Map<?, ?>) e.get("data")).get("eventId"))).findFirst().get().get("data");
        assertThat(data).containsEntry("confirmedRegistrations", 3);
    }

    // ---- cover validation against media-service --------------------------------------------------------------

    @Test
    void coverIsValidatedAgainstMediaService() throws Exception {
        String approved = UUID.randomUUID().toString();
        String flagged = UUID.randomUUID().toString();
        String foreign = UUID.randomUUID().toString();
        neighbours.mediaStatus.put(approved, "APPROVED");
        neighbours.mediaOwner.put(approved, ORGANIZER.toString());
        neighbours.mediaStatus.put(flagged, "FLAGGED");
        neighbours.mediaOwner.put(flagged, ORGANIZER.toString());
        neighbours.mediaStatus.put(foreign, "APPROVED");
        neighbours.mediaOwner.put(foreign, UUID.randomUUID().toString());
        Instant starts = Instant.now().plus(Duration.ofDays(9));
        java.util.function.Function<String, Resp> create = cover -> {
            try {
                return call("POST", "/api/v1/events", Map.of("title", "Con portada", "description", "d", "coverMediaId", cover,
                        "startsAt", starts.toString(), "venue", "Aula", "capacity", 5, "priceCredits", 0), organizer(), "Idempotency-Key", key());
            } catch (Exception e) {
                throw new IllegalStateException(e);
            }
        };
        Resp ok = create.apply(approved);
        assertThat(ok.status()).isEqualTo(201);
        assertThat(ok.body()).containsEntry("coverMediaId", approved);
        assertThat(create.apply(flagged).body().get("code")).isEqualTo("MEDIA_NOT_APPROVED");
        assertThat(create.apply(foreign).body().get("code")).isEqualTo("MEDIA_NOT_APPROVED");
        assertThat(create.apply(UUID.randomUUID().toString()).status()).isEqualTo(422);

        String eventId = (String) ok.body().get("id");
        call("POST", "/api/v1/events/" + eventId + "/publish", null, organizer());
        Resp got = call("GET", "/api/v1/events/" + eventId, null, organizer());
        assertThat(got.body().get("coverUrl")).isEqualTo("http://minio.test/" + approved + ".jpg");

        neighbours.mediaDown = true;
        try {
            Resp down = create.apply(approved);
            assertThat(down.status()).isEqualTo(503);
            assertThat(down.body().get("code")).isEqualTo("MEDIA_UNAVAILABLE");
        } finally {
            neighbours.mediaDown = false;
        }
    }

    // ---- internal API and health -----------------------------------------------------------------------------

    @Test
    void internalEndpointsRequireAServiceTokenAndExposeSagasAndStats() throws Exception {
        String eventId = createPublishedEvent(10, 20);
        UUID user = funded(100);
        String regId = (String) register(eventId, user, key()).body().get("id");
        awaitStatus(regId, user, "CONFIRMED");
        String svc = neighbours.internalToken();

        assertThat(call("GET", "/internal/v1/sagas", null, null).status()).isEqualTo(401);
        assertThat(call("GET", "/internal/v1/sagas", null, student(user)).status()).isEqualTo(403);
        assertThat(call("GET", "/api/v1/events/" + eventId, null, svc).status()).isEqualTo(403);

        Resp sagas = call("GET", "/internal/v1/sagas?status=COMPLETED&status=COMPENSATED&type=REGISTRATION", null, svc);
        assertThat(sagas.status()).isEqualTo(200);
        @SuppressWarnings("unchecked") List<Map<String, Object>> items = (List<Map<String, Object>>) sagas.body().get("items");
        assertThat(items).anyMatch(s -> regId.equals(s.get("registrationId")) && "COMPLETED".equals(s.get("status")) && s.get("retries") != null);

        String today = java.time.LocalDate.now(java.time.ZoneOffset.UTC).toString();
        Resp stats = call("GET", "/internal/v1/stats/registrations?from=" + today + "&to=" + today + "&groupBy=day", null, svc);
        assertThat(stats.status()).isEqualTo(200);
        assertThat(stats.map("totals")).containsKeys("pending", "confirmed", "failed", "cancelled", "creditsCollected", "creditsRefunded");
        assertThat(((Number) stats.map("totals").get("confirmed")).intValue()).isGreaterThanOrEqualTo(1);
        assertThat(call("GET", "/internal/v1/stats/registrations?from=2026-01-01&to=2028-01-01", null, svc).status()).isEqualTo(400);

        Resp regs = call("GET", "/internal/v1/events/" + eventId + "/registrations?status=CONFIRMED", null, svc);
        assertThat((List<?>) regs.body().get("items")).hasSize(1);
        Resp evs = call("GET", "/internal/v1/events?status=PUBLISHED", null, svc);
        assertThat(evs.status()).isEqualTo(200);

        String sagaId = (String) items.stream().filter(s -> regId.equals(s.get("registrationId"))).findFirst().get().get("id");
        Resp retry = call("POST", "/internal/v1/sagas/" + sagaId + "/retry", null, svc, "X-Actor-Id", UUID.randomUUID().toString());
        assertThat(retry.status()).isEqualTo(409);
        assertThat(retry.body().get("code")).isEqualTo("SAGA_NOT_RETRYABLE");
        assertThat(call("POST", "/internal/v1/sagas/" + UUID.randomUUID() + "/retry", null, svc, "X-Actor-Id", UUID.randomUUID().toString()).status()).isEqualTo(404);
    }

    @Test
    void problemDetailsAreLocalizedAndHealthIsUp() throws Exception {
        Resp es = call("GET", "/api/v1/events/" + UUID.randomUUID(), null, organizer());
        assertThat(es.status()).isEqualTo(404);
        assertThat(es.body()).containsEntry("code", "NOT_FOUND").containsKeys("type", "title", "detail", "instance", "traceId");
        assertThat(es.header("Content-Language")).isEqualTo("es");
        Resp en = call("GET", "/api/v1/events/" + UUID.randomUUID(), null, organizer(), "Accept-Language", "en");
        assertThat(en.header("Content-Language")).isEqualTo("en");
        assertThat(en.body().get("title")).isEqualTo("Resource not found");
        assertThat(call("GET", "/health/live", null, null).body()).containsEntry("status", "UP");
        assertThat(call("GET", "/health/ready", null, null).body()).containsEntry("status", "UP");
    }
}
