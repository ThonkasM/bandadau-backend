package com.bandadau.identity.adapter;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

import com.bandadau.identity.adapter.out.external.JwtTokenIssuerAdapter;
import com.bandadau.identity.application.port.out.VerificationCodeSenderPort;
import com.bandadau.identity.domain.model.Email;
import com.bandadau.identity.domain.model.Language;
import com.nimbusds.jose.crypto.RSASSAVerifier;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.*;
import org.springframework.amqp.core.AmqpAdmin;
import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.containers.RabbitMQContainer;
import tools.jackson.databind.ObjectMapper;

@Tag("integration")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class IdentityIntegrationTest {
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:18-alpine");
    static final RabbitMQContainer RABBIT = new RabbitMQContainer("rabbitmq:4-management-alpine");
    static final String PASSWORD = "Cóndor-Illimani-2026";
    static final Map<String, String> CODES = new ConcurrentHashMap<>();

    static {
        POSTGRES.start();
        RABBIT.start();
    }

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.rabbitmq.addresses", () -> "amqp://" + RABBIT.getAdminUsername() + ":"
                + RABBIT.getAdminPassword() + "@" + RABBIT.getHost() + ":" + RABBIT.getAmqpPort());
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class Capture {
        @Bean @Primary
        VerificationCodeSenderPort capturingSender() {
            return new VerificationCodeSenderPort() {
                @Override public void sendCode(Email to, String code, Language language) { CODES.put(to.value(), code); }
                @Override public void sendExistingAccountNotice(Email to, Language language) { }
            };
        }
    }

    @LocalServerPort int port;
    @Autowired ObjectMapper mapper;
    @Autowired AmqpAdmin amqpAdmin;
    @Autowired RabbitTemplate rabbit;
    @Autowired JwtTokenIssuerAdapter issuer;

    final HttpClient http = HttpClient.newHttpClient();
    static final List<Map<String, Object>> EVENTS = new CopyOnWriteArrayList<>();
    static String universityId;
    static String serviceToken;
    static final UUID ACTOR = UUID.randomUUID();

    record Resp(int status, Map<String, Object> body, HttpResponse<String> raw) {
        String header(String name) { return raw.headers().firstValue(name).orElse(null); }
        @SuppressWarnings("unchecked") Map<String, Object> map(String key) { return (Map<String, Object>) body.get(key); }
    }

    @SuppressWarnings("unchecked")
    Map<String, Object> json(String text) {
        return text == null || text.isBlank() ? Map.of() : mapper.readValue(text, Map.class);
    }

    Resp call(String method, String path, Object body, String... headers) throws Exception {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                .method(method, body == null ? HttpRequest.BodyPublishers.noBody()
                        : HttpRequest.BodyPublishers.ofString(body instanceof String s ? s : mapper.writeValueAsString(body)));
        if (body != null) b.header("Content-Type", "application/json");
        for (int i = 0; i < headers.length; i += 2) b.header(headers[i], headers[i + 1]);
        HttpResponse<String> r = http.send(b.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        return new Resp(r.statusCode(), json(r.body()), r);
    }

    String bearer(String token) { return "Bearer " + token; }

    void drainEvents() {
        Message m;
        while ((m = rabbit.receive("identity-it.events", 100)) != null) {
            EVENTS.add(json(new String(m.getBody(), StandardCharsets.UTF_8)));
        }
    }

    Map<String, Object> awaitEvent(String type, String userId) {
        await().atMost(Duration.ofSeconds(15)).pollInterval(Duration.ofMillis(300)).until(() -> {
            drainEvents();
            return findEvent(type, userId) != null;
        });
        return findEvent(type, userId);
    }

    @SuppressWarnings("unchecked")
    Map<String, Object> findEvent(String type, String userId) {
        return EVENTS.stream().filter(e -> type.equals(e.get("type"))
                && userId.equals(((Map<String, Object>) e.get("data")).get("userId"))).findFirst().orElse(null);
    }

    String register(String email, String key) throws Exception {
        Resp r = call("POST", "/api/v1/auth/register", Map.of("email", email, "password", PASSWORD,
                "universityId", universityId, "locale", "es"), "Idempotency-Key", key);
        assertThat(r.status()).isEqualTo(201);
        return (String) r.body().get("userId");
    }

    Resp verify(String email, String code, String... headers) throws Exception {
        return call("POST", "/api/v1/auth/verify-email", Map.of("email", email, "code", code), headers);
    }

    /** Registers and verifies a user; returns the verify response. */
    Resp activeUser(String email) throws Exception {
        register(email, UUID.randomUUID().toString());
        Resp r = verify(email, CODES.get(email));
        assertThat(r.status()).isEqualTo(200);
        return r;
    }

    Resp login(String email, String... headers) throws Exception {
        return call("POST", "/api/v1/auth/login", Map.of("email", email, "password", PASSWORD), headers);
    }

    String pkceChallenge(String verifier) throws Exception {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(
                MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII)));
    }

    @Test @Order(0)
    void bootstrap() throws Exception {
        amqpAdmin.declareQueue(new Queue("identity-it.events", true, false, false));
        amqpAdmin.declareBinding(new Binding("identity-it.events", Binding.DestinationType.QUEUE, "bandada.events",
                "bandada.identity.user.#", null));
        Resp token = call("POST", "/api/v1/auth/service-token",
                Map.of("clientId", "admin-gateway", "clientSecret", "gw-secret"));
        assertThat(token.status()).isEqualTo(200);
        serviceToken = (String) token.body().get("accessToken");
        assertThat(token.body().get("scopes")).isEqualTo(List.of("internal:read", "internal:write"));

        Resp bad = call("POST", "/api/v1/auth/service-token", Map.of("clientId", "admin-gateway", "clientSecret", "nope"));
        assertThat(bad.status()).isEqualTo(401);
        assertThat(bad.body().get("code")).isEqualTo("INVALID_CLIENT");

        Resp created = call("POST", "/internal/v1/universities", Map.of("name", "Universidad Mayor de San Andrés",
                "allowedDomains", List.of("umsa.bo")), "Authorization", bearer(serviceToken), "X-Actor-Id", ACTOR.toString());
        assertThat(created.status()).isEqualTo(201);
        universityId = (String) created.body().get("id");

        Resp dup = call("POST", "/internal/v1/universities", Map.of("name", "Otra Universidad",
                "allowedDomains", List.of("umsa.bo")), "Authorization", bearer(serviceToken), "X-Actor-Id", ACTOR.toString());
        assertThat(dup.status()).isEqualTo(409);
        assertThat(dup.body().get("code")).isEqualTo("UNIVERSITY_DOMAIN_TAKEN");

        Resp list = call("GET", "/api/v1/universities", null);
        assertThat(list.status()).isEqualTo(200);
        assertThat((List<?>) list.body().get("items")).hasSize(1);
        assertThat(list.body()).containsEntry("nextCursor", null);
    }

    @Test @Order(1)
    void registrationVerificationAndJwt() throws Exception {
        String email = "ana.quispe@umsa.bo";
        String key = UUID.randomUUID().toString();
        Resp first = call("POST", "/api/v1/auth/register", Map.of("email", email, "password", PASSWORD,
                "universityId", universityId, "locale", "en"), "Idempotency-Key", key);
        assertThat(first.status()).isEqualTo(201);
        assertThat(first.body()).containsEntry("status", "PENDING_VERIFICATION").containsEntry("verificationExpiresIn", 900);
        assertThat(first.header("Idempotent-Replayed")).isEqualTo("false");

        Resp replay = call("POST", "/api/v1/auth/register", Map.of("universityId", universityId, "locale", "en",
                "password", PASSWORD, "email", email), "Idempotency-Key", key);
        assertThat(replay.status()).isEqualTo(201);
        assertThat(replay.header("Idempotent-Replayed")).isEqualTo("true");
        assertThat(replay.body()).isEqualTo(first.body());

        Resp reused = call("POST", "/api/v1/auth/register", Map.of("email", "other@umsa.bo", "password", PASSWORD,
                "universityId", universityId), "Idempotency-Key", key);
        assertThat(reused.status()).isEqualTo(422);
        assertThat(reused.body().get("code")).isEqualTo("IDEMPOTENCY_KEY_REUSED");

        Resp missing = call("POST", "/api/v1/auth/register", Map.of("email", email, "password", PASSWORD, "universityId", universityId));
        assertThat(missing.status()).isEqualTo(400);
        assertThat(missing.body().get("code")).isEqualTo("IDEMPOTENCY_KEY_REQUIRED");

        Resp foreign = call("POST", "/api/v1/auth/register", Map.of("email", "x@gmail.com", "password", PASSWORD,
                "universityId", universityId), "Idempotency-Key", UUID.randomUUID().toString());
        assertThat(foreign.status()).isEqualTo(422);
        assertThat(foreign.body().get("code")).isEqualTo("EMAIL_DOMAIN_NOT_ALLOWED");

        String code = CODES.get(email);
        String wrong = code.equals("000000") ? "111111" : "000000";
        Resp bad = verify(email, wrong);
        assertThat(bad.status()).isEqualTo(422);
        assertThat(bad.body()).containsEntry("code", "INVALID_VERIFICATION_CODE").containsEntry("remainingAttempts", 4);

        Resp login = login(email);
        assertThat(login.status()).isEqualTo(403);
        assertThat(login.body().get("code")).isEqualTo("EMAIL_NOT_VERIFIED");

        Resp ok = verify(email, code);
        assertThat(ok.status()).isEqualTo(200);
        assertThat(ok.header("Cache-Control")).contains("no-store");
        assertThat(ok.body()).containsKeys("accessToken", "refreshToken", "user");
        assertThat(ok.body().get("tokenType")).isEqualTo("Bearer");
        assertThat(ok.body().get("expiresIn")).isEqualTo(900);
        assertThat(ok.map("user")).containsEntry("status", "ACTIVE").containsEntry("locale", "en")
                .containsEntry("theme", "SYSTEM").containsEntry("roles", List.of("STUDENT"));

        // JWT verified against the published JWKS
        Resp jwks = call("GET", "/.well-known/jwks.json", null);
        assertThat(jwks.status()).isEqualTo(200);
        assertThat(jwks.header("Cache-Control")).contains("public").contains("max-age=300");
        JWKSet set = JWKSet.parse(jwks.raw().body());
        SignedJWT jwt = SignedJWT.parse((String) ok.body().get("accessToken"));
        assertThat(jwt.getHeader().getKeyID()).isNotBlank();
        assertThat(jwt.verify(new RSASSAVerifier(set.getKeyByKeyId(jwt.getHeader().getKeyID()).toRSAKey()))).isTrue();
        JWTClaimsSet claims = jwt.getJWTClaimsSet();
        assertThat(claims.getIssuer()).isEqualTo("http://api.bandada.localhost");
        assertThat(claims.getAudience()).containsExactly("bandada-app");
        assertThat(claims.getStringClaim("typ")).isEqualTo("user");
        assertThat(claims.getStringListClaim("roles")).containsExactly("STUDENT");
        assertThat(claims.getStringClaim("uni")).isEqualTo(universityId);
        assertThat(claims.getStringClaim("locale")).isEqualTo("en");
        assertThat(claims.getSubject()).isEqualTo(ok.map("user").get("id"));

        Resp me = call("GET", "/api/v1/users/me", null, "Authorization", bearer((String) ok.body().get("accessToken")));
        assertThat(me.status()).isEqualTo(200);
        assertThat(me.body()).containsEntry("email", email);

        // user.registered is published once, when the account became ACTIVE
        Map<String, Object> event = awaitEvent("bandada.identity.user.registered.v1", (String) first.body().get("userId"));
        assertThat(event).containsEntry("specversion", "1.0").containsEntry("source", "/services/identity-service")
                .containsEntry("datacontenttype", "application/json");
        @SuppressWarnings("unchecked") Map<String, Object> data = (Map<String, Object>) event.get("data");
        assertThat(data).containsEntry("email", email).containsEntry("locale", "en").containsEntry("displayName", "Ana Quispe")
                .containsEntry("universityId", universityId);
        assertThat(event).containsKey("correlationid");
    }

    @Test @Order(2)
    void refreshRotationAndReuseDetection() throws Exception {
        String email = "rotate@umsa.bo";
        activeUser(email);
        Resp session = login(email);
        String first = (String) session.body().get("refreshToken");
        Resp second = call("POST", "/api/v1/auth/refresh", Map.of("refreshToken", first));
        assertThat(second.status()).isEqualTo(200);
        String newest = (String) second.body().get("refreshToken");
        assertThat(newest).isNotEqualTo(first);

        Resp reuse = call("POST", "/api/v1/auth/refresh", Map.of("refreshToken", first));
        assertThat(reuse.status()).isEqualTo(401);
        assertThat(reuse.body().get("code")).isEqualTo("REFRESH_TOKEN_REUSED");
        Resp afterTheft = call("POST", "/api/v1/auth/refresh", Map.of("refreshToken", newest));
        assertThat(afterTheft.status()).isEqualTo(401);
        assertThat(afterTheft.body().get("code")).isEqualTo("REFRESH_TOKEN_REUSED");

        Resp unknown = call("POST", "/api/v1/auth/refresh", Map.of("refreshToken", "rt_this-token-does-not-exist"));
        assertThat(unknown.status()).isEqualTo(401);
        assertThat(unknown.body().get("code")).isEqualTo("INVALID_REFRESH_TOKEN");
    }

    @Test @Order(3)
    void webClientsKeepTheRefreshTokenInAnHttpOnlyCookie() throws Exception {
        String email = "web@umsa.bo";
        activeUser(email);
        Resp session = login(email, "X-Bandada-Client", "web");
        assertThat(session.status()).isEqualTo(200);
        assertThat(session.body()).doesNotContainKey("refreshToken");
        String cookie = session.header("Set-Cookie");
        assertThat(cookie).startsWith("bandada_rt=").contains("HttpOnly").contains("SameSite=Strict")
                .contains("Path=/api/v1/auth");
        String pair = cookie.substring(0, cookie.indexOf(';'));

        Resp refreshed = call("POST", "/api/v1/auth/refresh", null, "X-Bandada-Client", "web", "Cookie", pair);
        assertThat(refreshed.status()).isEqualTo(200);
        assertThat(refreshed.header("Set-Cookie")).startsWith("bandada_rt=").isNotEqualTo(cookie);

        Resp noCookie = call("POST", "/api/v1/auth/refresh", null, "X-Bandada-Client", "web");
        assertThat(noCookie.status()).isEqualTo(401);
        Resp badOrigin = call("POST", "/api/v1/auth/refresh", null, "X-Bandada-Client", "web", "Cookie", pair,
                "Origin", "http://evil.example");
        assertThat(badOrigin.status()).isEqualTo(403);
    }

    @Test @Order(4)
    void handoffCodeIsSingleUseAndPkceBound() throws Exception {
        String email = "mod@umsa.bo";
        Resp session = activeUser(email);
        String userId = (String) session.map("user").get("id");
        String token = (String) session.body().get("accessToken");
        String verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        Map<String, Object> handoffBody = Map.of("targetApp", "ADMIN", "codeChallenge", pkceChallenge(verifier),
                "codeChallengeMethod", "S256");

        Resp denied = call("POST", "/api/v1/auth/handoff", handoffBody, "Authorization", bearer(token));
        assertThat(denied.status()).isEqualTo(403);
        assertThat(denied.body().get("code")).isEqualTo("HANDOFF_TARGET_FORBIDDEN");

        Resp roles = call("PATCH", "/internal/v1/users/" + userId + "/roles", Map.of("roles", List.of("STUDENT", "MODERATOR")),
                "Authorization", bearer(serviceToken), "X-Actor-Id", ACTOR.toString());
        assertThat(roles.status()).isEqualTo(200);
        awaitEvent("bandada.identity.user.role-changed.v1", userId);

        Resp created = call("POST", "/api/v1/auth/handoff", handoffBody, "Authorization", bearer(token));
        assertThat(created.status()).isEqualTo(201);
        String code = (String) created.body().get("code");
        assertThat(created.body()).containsEntry("expiresIn", 60);
        assertThat((String) created.body().get("redirectUrl")).isEqualTo("http://admin.bandada.localhost/sso/callback?code=" + code);

        Map<String, Object> exchange = Map.of("code", code, "codeVerifier", verifier);
        Resp ok = call("POST", "/api/v1/auth/handoff/exchange", exchange, "X-Bandada-Client", "admin");
        assertThat(ok.status()).isEqualTo(200);
        assertThat(ok.header("Set-Cookie")).startsWith("bandada_admin_rt=");
        SignedJWT jwt = SignedJWT.parse((String) ok.body().get("accessToken"));
        assertThat(jwt.getJWTClaimsSet().getAudience()).containsExactly("bandada-admin");

        Resp again = call("POST", "/api/v1/auth/handoff/exchange", exchange, "X-Bandada-Client", "admin");
        assertThat(again.status()).isEqualTo(401);
        assertThat(again.body().get("code")).isEqualTo("HANDOFF_CODE_INVALID");

        Resp second = call("POST", "/api/v1/auth/handoff", handoffBody, "Authorization", bearer(token));
        String wrongVerifier = "x".repeat(43);
        assertThat(call("POST", "/api/v1/auth/handoff/exchange",
                Map.of("code", second.body().get("code"), "codeVerifier", wrongVerifier)).status()).isEqualTo(401);
        assertThat(call("POST", "/api/v1/auth/handoff/exchange",
                Map.of("code", second.body().get("code"), "codeVerifier", verifier)).status()).isEqualTo(401);
    }

    @Test @Order(5)
    void suspensionRevokesSessionsAndPublishesEvents() throws Exception {
        String email = "suspend@umsa.bo";
        Resp session = activeUser(email);
        String userId = (String) session.map("user").get("id");
        String refresh = (String) session.body().get("refreshToken");
        String serviceAuth = bearer(serviceToken);

        Resp missingReason = call("PATCH", "/internal/v1/users/" + userId + "/status", Map.of("status", "SUSPENDED"),
                "Authorization", serviceAuth, "X-Actor-Id", ACTOR.toString());
        assertThat(missingReason.status()).isEqualTo(400);

        Resp suspended = call("PATCH", "/internal/v1/users/" + userId + "/status",
                Map.of("status", "SUSPENDED", "reason", "Contenido inapropiado reiterado"),
                "Authorization", serviceAuth, "X-Actor-Id", ACTOR.toString());
        assertThat(suspended.status()).isEqualTo(200);
        assertThat(suspended.body()).containsEntry("status", "SUSPENDED");
        Map<String, Object> event = awaitEvent("bandada.identity.user.suspended.v1", userId);
        @SuppressWarnings("unchecked") Map<String, Object> data = (Map<String, Object>) event.get("data");
        assertThat(data).containsEntry("suspendedBy", ACTOR.toString()).containsEntry("reason", "Contenido inapropiado reiterado");

        Resp login = login(email);
        assertThat(login.status()).isEqualTo(403);
        assertThat(login.body().get("code")).isEqualTo("ACCOUNT_SUSPENDED");
        Resp refreshed = call("POST", "/api/v1/auth/refresh", Map.of("refreshToken", refresh));
        assertThat(refreshed.status()).isEqualTo(401);

        Resp reactivated = call("PATCH", "/internal/v1/users/" + userId + "/status", Map.of("status", "ACTIVE"),
                "Authorization", serviceAuth, "X-Actor-Id", ACTOR.toString());
        assertThat(reactivated.status()).isEqualTo(200);
        awaitEvent("bandada.identity.user.reactivated.v1", userId);
        assertThat(login(email).status()).isEqualTo(200);

        Resp search = call("GET", "/internal/v1/users?query=suspend&ids=" + userId, null, "Authorization", serviceAuth);
        assertThat(search.status()).isEqualTo(200);
        assertThat((List<?>) search.body().get("items")).hasSize(1);
    }

    @Test @Order(6)
    void preferencesAreSavedAndPublished() throws Exception {
        Resp session = activeUser("prefs@umsa.bo");
        String userId = (String) session.map("user").get("id");
        String token = bearer((String) session.body().get("accessToken"));
        Resp updated = call("PATCH", "/api/v1/users/me/preferences", Map.of("locale", "en", "theme", "DARK"), "Authorization", token);
        assertThat(updated.status()).isEqualTo(200);
        assertThat(updated.body()).containsEntry("locale", "en").containsEntry("theme", "DARK");
        Map<String, Object> event = awaitEvent("bandada.identity.user.preferences-changed.v1", userId);
        @SuppressWarnings("unchecked") Map<String, Object> data = (Map<String, Object>) event.get("data");
        assertThat(data).containsEntry("locale", "en").containsEntry("theme", "DARK");
        assertThat(call("PATCH", "/api/v1/users/me/preferences", Map.of(), "Authorization", token).status()).isEqualTo(400);
        assertThat(call("PATCH", "/api/v1/users/me/preferences", Map.of("theme", "PINK"), "Authorization", token).status()).isEqualTo(400);
    }

    @Test @Order(7)
    void problemDetailsAreLocalizedAndAuthorizationIsEnforced() throws Exception {
        Resp es = call("POST", "/api/v1/auth/login", Map.of("email", "ghost@umsa.bo", "password", PASSWORD));
        assertThat(es.status()).isEqualTo(401);
        assertThat(es.raw().headers().firstValue("Content-Type").orElse("")).startsWith("application/problem+json");
        assertThat(es.body()).containsEntry("code", "INVALID_CREDENTIALS").containsEntry("title", "Credenciales inválidas")
                .containsEntry("type", "https://api.bandadau.com/problems/invalid-credentials")
                .containsKeys("detail", "instance", "traceId");
        assertThat(es.header("Content-Language")).isEqualTo("es");
        assertThat(es.header("X-Correlation-Id")).isNotBlank();

        Resp en = call("POST", "/api/v1/auth/login", Map.of("email", "ghost@umsa.bo", "password", PASSWORD),
                "Accept-Language", "en-US,en;q=0.9", "X-Correlation-Id", "it-correlation-1");
        assertThat(en.body()).containsEntry("title", "Invalid credentials").containsEntry("correlationId", "it-correlation-1");
        assertThat(en.header("Content-Language")).isEqualTo("en");
        assertThat(en.header("X-Correlation-Id")).isEqualTo("it-correlation-1");

        Resp invalid = call("POST", "/api/v1/auth/login", Map.of("email", "not-an-email", "password", "x"));
        assertThat(invalid.status()).isEqualTo(400);
        assertThat(invalid.body().get("code")).isEqualTo("VALIDATION_FAILED");
        @SuppressWarnings("unchecked") List<Map<String, Object>> errors = (List<Map<String, Object>>) invalid.body().get("errors");
        assertThat(errors).extracting(e -> e.get("field")).contains("email", "password");

        assertThat(call("POST", "/api/v1/auth/login", "{not json").status()).isEqualTo(400);

        Resp anonymous = call("GET", "/api/v1/users/me", null);
        assertThat(anonymous.status()).isEqualTo(401);
        assertThat(anonymous.body().get("code")).isEqualTo("UNAUTHORIZED");
        assertThat(call("GET", "/internal/v1/users", null).status()).isEqualTo(401);

        Resp userToken = activeUser("authz@umsa.bo");
        Resp forbidden = call("GET", "/internal/v1/users", null, "Authorization", bearer((String) userToken.body().get("accessToken")));
        assertThat(forbidden.status()).isEqualTo(403);
        assertThat(call("GET", "/api/v1/users/me", null, "Authorization", bearer(serviceToken)).status()).isEqualTo(403);
        assertThat(call("POST", "/api/v1/auth/mcp-tokens", null, "Authorization",
                bearer((String) userToken.body().get("accessToken"))).status()).isEqualTo(403);
        assertThat(call("GET", "/api/v1/nope", null, "Authorization",
                bearer((String) userToken.body().get("accessToken"))).status()).isEqualTo(404);
    }

    @Test @Order(8)
    void healthEndpoints() throws Exception {
        Resp live = call("GET", "/health/live", null);
        assertThat(live.status()).isEqualTo(200);
        assertThat(live.body()).containsEntry("status", "UP");
        Resp ready = call("GET", "/health/ready", null);
        assertThat(ready.status()).isEqualTo(200);
        assertThat(ready.body()).containsEntry("status", "UP");
    }

    @Test @Order(9)
    void signingKeysRotateWithoutBreakingIssuedTokens() throws Exception {
        Resp session = activeUser("keys@umsa.bo");
        String oldToken = (String) session.body().get("accessToken");
        Instant later = Instant.now().plus(Duration.ofDays(91));
        issuer.evaluate(later);       // creates the PENDING key
        issuer.evaluate(later.plus(Duration.ofHours(25)));   // activates it, retires the old one

        JWKSet set = JWKSet.parse(call("GET", "/.well-known/jwks.json", null).raw().body());
        assertThat(set.getKeys().size()).isGreaterThanOrEqualTo(2);
        SignedJWT jwt = SignedJWT.parse(oldToken);
        assertThat(jwt.verify(new RSASSAVerifier(set.getKeyByKeyId(jwt.getHeader().getKeyID()).toRSAKey()))).isTrue();
    }
}
