package com.bandadau.events.saga;

import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/** identity-service (JWKS + service-token) and media-service doubles on one local HTTP server. */
public class FakeNeighbours implements AutoCloseable {
    public static final String ISSUER = "http://api.bandada.localhost";

    public final Map<String, String> mediaStatus = new ConcurrentHashMap<>();   // mediaId -> status
    public final Map<String, String> mediaOwner = new ConcurrentHashMap<>();
    public volatile boolean mediaDown;
    private final HttpServer server;
    private final RSAKey key;

    public FakeNeighbours() throws Exception {
        key = new RSAKeyGenerator(2048).keyID("test-key").generate();
        server = HttpServer.create(new InetSocketAddress("0.0.0.0", 0), 0);
        server.createContext("/.well-known/jwks.json", ex -> respond(ex, 200, new JWKSet(key.toPublicJWK()).toString()));
        server.createContext("/api/v1/auth/service-token", ex -> respond(ex, 200,
                "{\"accessToken\":\"" + serviceToken() + "\",\"tokenType\":\"Bearer\",\"expiresIn\":300,\"scopes\":[\"internal:read\"]}"));
        server.createContext("/internal/v1/media/", ex -> {
            if (mediaDown) { respond(ex, 500, "{}"); return; }
            String path = ex.getRequestURI().getPath();
            String id = path.substring(path.lastIndexOf('/') + 1);
            if (path.endsWith("/urls")) {
                String ids = ex.getRequestURI().getQuery().replace("ids=", "");
                StringBuilder items = new StringBuilder();
                for (String one : ids.split(",")) {
                    if (items.length() > 0) items.append(',');
                    boolean ok = "APPROVED".equals(mediaStatus.get(one));
                    items.append("{\"mediaId\":\"").append(one).append("\",\"url\":").append(ok ? "\"http://minio.test/" + one + ".jpg\"" : "null").append('}');
                }
                respond(ex, 200, "{\"items\":[" + items + "]}");
            } else if (mediaStatus.containsKey(id)) {
                respond(ex, 200, "{\"id\":\"" + id + "\",\"ownerId\":\"" + mediaOwner.get(id) + "\",\"purpose\":\"EVENT_COVER\",\"status\":\""
                        + mediaStatus.get(id) + "\"}");
            } else {
                respond(ex, 404, "{}");
            }
        });
        server.start();
    }

    private static void respond(com.sun.net.httpserver.HttpExchange ex, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().add("Content-Type", "application/json");
        ex.sendResponseHeaders(status, bytes.length);
        ex.getResponseBody().write(bytes);
        ex.close();
    }

    public int port() { return server.getAddress().getPort(); }

    public String baseUrl() { return "http://localhost:" + port(); }

    private String serviceToken() {
        return sign(new JWTClaimsSet.Builder().issuer(ISSUER).subject("events-service").audience("bandada-internal")
                .claim("typ", "service").claim("scope", "internal:read internal:write"));
    }

    public String userToken(UUID userId, UUID universityId, String... roles) {
        return sign(new JWTClaimsSet.Builder().issuer(ISSUER).subject(userId.toString()).audience("bandada-app")
                .claim("typ", "user").claim("roles", List.of(roles)).claim("uni", universityId.toString()).claim("locale", "es"));
    }

    public String internalToken() { return serviceToken(); }

    private String sign(JWTClaimsSet.Builder claims) {
        try {
            JWTClaimsSet set = claims.issueTime(new Date()).expirationTime(Date.from(Instant.now().plusSeconds(600)))
                    .jwtID(UUID.randomUUID().toString()).build();
            SignedJWT jwt = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.RS256).keyID("test-key").type(JOSEObjectType.JWT).build(), set);
            jwt.sign(new RSASSASigner(key));
            return jwt.serialize();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    @Override
    public void close() { server.stop(0); }
}
