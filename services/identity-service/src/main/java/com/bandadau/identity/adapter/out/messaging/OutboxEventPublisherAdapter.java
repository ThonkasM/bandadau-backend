package com.bandadau.identity.adapter.out.messaging;

import com.bandadau.identity.application.port.out.ClockPort;
import com.bandadau.identity.application.port.out.EventPublisherPort;
import com.bandadau.identity.application.port.out.IdGeneratorPort;
import com.bandadau.identity.domain.event.*;
import com.bandadau.identity.domain.model.Role;
import java.util.*;
import org.slf4j.MDC;
import org.springframework.jdbc.core.simple.JdbcClient;
import tools.jackson.databind.ObjectMapper;

/** Maps domain events to CloudEvents (structured mode) and appends them to the outbox in the caller's transaction. */
public class OutboxEventPublisherAdapter implements EventPublisherPort {
    static final String EXCHANGE = "bandada.events";
    static final String SOURCE = "/services/identity-service";

    private final JdbcClient jdbc;
    private final ObjectMapper mapper;
    private final IdGeneratorPort ids;
    private final ClockPort clock;

    public OutboxEventPublisherAdapter(JdbcClient jdbc, ObjectMapper mapper, IdGeneratorPort ids, ClockPort clock) {
        this.jdbc = jdbc;
        this.mapper = mapper;
        this.ids = ids;
        this.clock = clock;
    }

    private record Spec(String type, UUID userId, Map<String, Object> data) { }

    private static List<String> names(Set<Role> roles) {
        return roles.stream().map(Role::name).sorted().toList();
    }

    private static Spec toSpec(DomainEvent event) {
        Map<String, Object> d = new LinkedHashMap<>();
        return switch (event) {
            case UserRegistered e -> {
                d.put("userId", e.userId());
                d.put("email", e.email().value());
                d.put("universityId", e.universityId());
                d.put("displayName", e.displayName());
                d.put("roles", names(e.roles()));
                d.put("locale", e.language().code());
                d.put("occurredAt", e.occurredAt());
                yield new Spec("bandada.identity.user.registered.v1", e.userId(), d);
            }
            case UserRoleChanged e -> {
                d.put("userId", e.userId());
                d.put("previousRoles", names(e.previousRoles()));
                d.put("roles", names(e.roles()));
                d.put("changedBy", e.changedBy());
                d.put("occurredAt", e.occurredAt());
                yield new Spec("bandada.identity.user.role-changed.v1", e.userId(), d);
            }
            case UserSuspended e -> {
                d.put("userId", e.userId());
                d.put("reason", e.reason());
                d.put("suspendedBy", e.suspendedBy());
                d.put("until", null);
                d.put("occurredAt", e.occurredAt());
                yield new Spec("bandada.identity.user.suspended.v1", e.userId(), d);
            }
            case UserReactivated e -> {
                d.put("userId", e.userId());
                d.put("reactivatedBy", e.reactivatedBy());
                d.put("occurredAt", e.occurredAt());
                yield new Spec("bandada.identity.user.reactivated.v1", e.userId(), d);
            }
            case UserPreferencesChanged e -> {
                d.put("userId", e.userId());
                d.put("locale", e.language().code());
                d.put("theme", e.theme().name());
                d.put("occurredAt", e.occurredAt());
                yield new Spec("bandada.identity.user.preferences-changed.v1", e.userId(), d);
            }
        };
    }

    @Override
    public void publish(DomainEvent event) {
        Spec spec = toSpec(event);
        UUID id = ids.newId();
        String correlation = Optional.ofNullable(MDC.get("correlationId")).orElse(id.toString());
        String traceparent = MDC.get("traceparent");

        Map<String, Object> cloudEvent = new LinkedHashMap<>();
        cloudEvent.put("specversion", "1.0");
        cloudEvent.put("id", id);
        cloudEvent.put("source", SOURCE);
        cloudEvent.put("type", spec.type());
        cloudEvent.put("time", clock.now());
        cloudEvent.put("subject", "users/" + spec.userId());
        cloudEvent.put("datacontenttype", "application/json");
        cloudEvent.put("correlationid", correlation);
        if (traceparent != null) cloudEvent.put("traceparent", traceparent);
        cloudEvent.put("data", spec.data());

        Map<String, Object> headers = new LinkedHashMap<>();
        if (traceparent != null) headers.put("traceparent", traceparent);

        jdbc.sql("""
                INSERT INTO outbox (id, exchange, routing_key, payload, headers, aggregate_id)
                VALUES (:id, :exchange, :rk, CAST(:payload AS jsonb), CAST(:headers AS jsonb), :aggregate)
                """)
                .param("id", id).param("exchange", EXCHANGE).param("rk", spec.type())
                .param("payload", mapper.writeValueAsString(cloudEvent))
                .param("headers", mapper.writeValueAsString(headers)).param("aggregate", spec.userId()).update();
    }
}
