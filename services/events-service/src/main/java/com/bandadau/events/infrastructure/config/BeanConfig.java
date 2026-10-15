package com.bandadau.events.infrastructure.config;

import com.bandadau.events.application.event.EventService;
import com.bandadau.events.application.port.*;
import com.bandadau.events.application.registration.RegistrationService;
import com.bandadau.events.application.saga.RegistrationSagaOrchestrator;
import com.bandadau.events.application.saga.SagaQueries;
import com.bandadau.events.domain.event.EventRepository;
import com.bandadau.events.domain.registration.RegistrationRepository;
import com.bandadau.events.domain.saga.SagaInstanceRepository;
import com.bandadau.events.domain.saga.SagaPolicy;
import com.bandadau.events.domain.shared.Clock;
import com.bandadau.events.infrastructure.idempotency.JdbcIdempotencyStore;
import com.bandadau.events.infrastructure.media.HttpMediaCatalog;
import com.bandadau.events.infrastructure.media.ServiceTokenProvider;
import com.bandadau.events.infrastructure.messaging.*;
import com.bandadau.events.infrastructure.persistence.*;
import com.bandadau.events.interfaces.rest.ProblemFactory;
import com.bandadau.events.interfaces.rest.RequestContextFilter;
import io.micrometer.core.instrument.MeterRegistry;
import java.net.http.HttpClient;
import java.time.Duration;
import java.time.Instant;
import org.springframework.amqp.core.*;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.MessageSource;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.ObjectMapper;

/** Composition root of the events context. */
@Configuration
@EnableScheduling
public class BeanConfig {

    @Bean java.time.Clock systemClock() { return java.time.Clock.systemUTC(); }

    @Bean Clock domainClock(java.time.Clock clock) { return () -> Instant.now(clock); }

    @Bean IdGenerator idGenerator() { return new UuidV7Generator(); }

    @Bean TransactionRunner transactionRunner(TransactionTemplate template) { return new SpringTransactionRunner(template); }

    @Bean EventRepository eventRepository(JdbcClient jdbc) { return new JdbcEventRepository(jdbc); }

    @Bean RegistrationRepository registrationRepository(JdbcClient jdbc) { return new JdbcRegistrationRepository(jdbc); }

    @Bean SagaInstanceRepository sagaRepository(JdbcClient jdbc, ObjectMapper mapper) { return new JdbcSagaInstanceRepository(jdbc, mapper); }

    @Bean RegistrationStatsQuery statsQuery(JdbcClient jdbc) { return new JdbcStatsQuery(jdbc); }

    @Bean IntegrationEventOutbox outbox(JdbcClient jdbc, ObjectMapper mapper, IdGenerator ids, Clock clock) {
        return new JdbcOutbox(jdbc, mapper, ids, clock);
    }

    @Bean Inbox inbox(JdbcClient jdbc) { return new JdbcInbox(jdbc); }

    @Bean IdempotencyStore idempotencyStore(JdbcClient jdbc, TransactionTemplate tx, ObjectMapper mapper, java.time.Clock clock) {
        return new JdbcIdempotencyStore(jdbc, tx, mapper, clock);
    }

    @Bean SagaMetrics sagaMetrics(MeterRegistry registry) { return new MicrometerSagaMetrics(registry); }

    @Bean OutboxRelay outboxRelay(JdbcClient jdbc, TransactionTemplate tx, RabbitTemplate rabbit, ObjectMapper mapper, AppProperties props) {
        return new OutboxRelay(jdbc, tx, rabbit, mapper, props.outbox().batchSize());
    }

    @Bean SagaPolicy sagaPolicy(AppProperties props) {
        AppProperties.Saga s = props.saga();
        return new SagaPolicy(s.stepTimeout(), s.resendOffsets(), s.compensationBackoffBase(), s.compensationBackoffCap(),
                s.compensationAlertAfter());
    }

    @Bean RegistrationSagaOrchestrator orchestrator(SagaInstanceRepository sagas, RegistrationRepository registrations,
                                                    EventRepository events, IntegrationEventOutbox outbox, Inbox inbox,
                                                    TransactionRunner tx, Clock clock, IdGenerator ids, SagaMetrics metrics,
                                                    SagaPolicy policy) {
        return new RegistrationSagaOrchestrator(sagas, registrations, events, outbox, inbox, tx, clock, ids, metrics, policy);
    }

    @Bean HttpClient httpClient() { return HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(1)).build(); }

    @Bean ServiceTokenProvider serviceTokenProvider(HttpClient http, ObjectMapper mapper, AppProperties props) {
        return new ServiceTokenProvider(http, mapper, StartupValidator.identityUrl(props), props.identity().clientId(),
                props.identity().clientSecret());
    }

    @Bean MediaCatalog mediaCatalog(HttpClient http, ServiceTokenProvider tokens, ObjectMapper mapper, AppProperties props) {
        return new HttpMediaCatalog(props.media().enabled(), props.media().url(), props.media().timeout(), http, tokens, mapper);
    }

    @Bean EventService eventService(EventRepository events, RegistrationRepository registrations,
                                    RegistrationSagaOrchestrator orchestrator, IntegrationEventOutbox outbox,
                                    MediaCatalog media, TransactionRunner tx, Clock clock, IdGenerator ids, AppProperties props) {
        return new EventService(events, registrations, orchestrator, outbox, media, tx, clock, ids, props.events().defaultDuration());
    }

    @Bean RegistrationService registrationService(EventRepository events, RegistrationRepository registrations,
                                                  SagaInstanceRepository sagas, RegistrationSagaOrchestrator orchestrator,
                                                  TransactionRunner tx, Clock clock, IdGenerator ids, AppProperties props) {
        return new RegistrationService(events, registrations, sagas, orchestrator, tx, clock, ids, props.events().cancellationCutoff());
    }

    @Bean SagaQueries sagaQueries(SagaInstanceRepository sagas) { return new SagaQueries(sagas); }

    @Bean RabbitSagaReplyListener sagaReplyListener(RegistrationSagaOrchestrator orchestrator, ObjectMapper mapper, RabbitTemplate rabbit) {
        return new RabbitSagaReplyListener(orchestrator, mapper, rabbit);
    }

    @Bean SagaTimeoutJob sagaTimeoutJob(RegistrationSagaOrchestrator orchestrator) { return new SagaTimeoutJob(orchestrator); }

    @Bean ProblemFactory problemFactory(MessageSource messages, ObjectMapper mapper) { return new ProblemFactory(messages, mapper); }

    @Bean FilterRegistrationBean<RequestContextFilter> correlationFilterRegistration() {
        FilterRegistrationBean<RequestContextFilter> bean = new FilterRegistrationBean<>(new RequestContextFilter());
        bean.setOrder(Ordered.HIGHEST_PRECEDENCE);
        return bean;
    }

    /** Only for standalone development and tests: in the platform bandadau-infra owns the topology (definitions.json). */
    @Bean @ConditionalOnProperty(name = "bandada.rabbit.declare-topology", havingValue = "true")
    Declarables bandadaTopology() {
        String q = "events-service.saga-replies";
        TopicExchange events = new TopicExchange("bandada.events", true, false);
        TopicExchange commands = new TopicExchange("bandada.commands", true, false);
        TopicExchange dlx = new TopicExchange("bandada.dlx", true, false);
        Queue main = QueueBuilder.durable(q).quorum().deadLetterExchange("bandada.dlx").deadLetterRoutingKey(q)
                .withArgument("x-delivery-limit", 10).build();
        Queue dlq = QueueBuilder.durable(q + ".dlq").quorum().build();
        java.util.List<Declarable> all = new java.util.ArrayList<>(java.util.List.of(events, commands, dlx, main, dlq,
                BindingBuilder.bind(dlq).to(dlx).with(q)));
        for (String[] w : new String[][] {{"5s", "5000"}, {"30s", "30000"}, {"5m", "300000"}}) {
            all.add(QueueBuilder.durable(q + ".retry." + w[0]).withArgument("x-message-ttl", Integer.parseInt(w[1]))
                    .deadLetterExchange("").deadLetterRoutingKey(q).build());
        }
        for (String rk : new String[] {"bandada.wallet.credits-debited.v1", "bandada.wallet.credits-debit-failed.v1",
                "bandada.wallet.credits-refunded.v1", "bandada.ticketing.ticket-issued.v1",
                "bandada.ticketing.ticket-issue-failed.v1", "bandada.ticketing.ticket-voided.v1",
                "bandada.ticketing.ticket-void-failed.v1"}) {
            all.add(BindingBuilder.bind(main).to(events).with(rk));
        }
        return new Declarables(all);
    }
}
