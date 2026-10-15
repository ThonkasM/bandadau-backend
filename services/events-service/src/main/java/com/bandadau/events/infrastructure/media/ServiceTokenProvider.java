package com.bandadau.events.infrastructure.media;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import tools.jackson.databind.ObjectMapper;

/** Client-credentials token from identity-service (POST /api/v1/auth/service-token), cached until 30 s before expiry. */
public class ServiceTokenProvider {
    private final HttpClient http;
    private final ObjectMapper mapper;
    private final String identityUrl;
    private final String clientId;
    private final String clientSecret;
    private volatile String token;
    private volatile Instant expiresAt = Instant.EPOCH;

    public ServiceTokenProvider(HttpClient http, ObjectMapper mapper, String identityUrl, String clientId, String clientSecret) {
        this.http = http;
        this.mapper = mapper;
        this.identityUrl = identityUrl;
        this.clientId = clientId;
        this.clientSecret = clientSecret;
    }

    public synchronized String get() throws IOException, InterruptedException {
        if (token != null && Instant.now().isBefore(expiresAt.minusSeconds(30))) return token;
        HttpRequest request = HttpRequest.newBuilder(URI.create(identityUrl + "/api/v1/auth/service-token"))
                .timeout(Duration.ofSeconds(3)).header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(
                        Map.of("clientId", clientId, "clientSecret", clientSecret)))).build();
        HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() != 200) throw new IOException("service-token answered " + response.statusCode());
        @SuppressWarnings("unchecked") Map<String, Object> body = mapper.readValue(response.body(), Map.class);
        token = String.valueOf(body.get("accessToken"));
        long ttl = body.get("expiresIn") instanceof Number n ? n.longValue() : 300;
        expiresAt = Instant.now().plusSeconds(ttl);
        return token;
    }
}
