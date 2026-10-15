package com.bandadau.events.interfaces.rest;

import com.bandadau.events.application.port.IdempotencyStore;
import com.bandadau.events.application.port.IdempotencyStore.*;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import org.springframework.http.server.PathContainer;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.util.ContentCachingResponseWrapper;
import org.springframework.web.util.pattern.PathPattern;
import org.springframework.web.util.pattern.PathPatternParser;
import tools.jackson.databind.ObjectMapper;

/**
 * D3 mechanism 1 for the endpoints marked with a recycled-arrow in the contract (createEvent, cancelEvent,
 * registerToEvent, cancelRegistration). Runs after authorization so the hash includes the caller.
 */
public class IdempotencyFilter extends OncePerRequestFilter {
    private static final Set<Integer> STORABLE = Set.of(200, 201, 202, 400, 404, 409, 422);
    private static final List<String> TEMPLATES = List.of("/api/v1/events", "/api/v1/events/{eventId}/cancel",
            "/api/v1/events/{eventId}/registrations", "/api/v1/registrations/{registrationId}/cancel");
    private static final PathPatternParser PARSER = new PathPatternParser();
    private static final List<PathPattern> PATTERNS = TEMPLATES.stream().map(PARSER::parse).toList();

    private final IdempotencyStore store;
    private final ProblemFactory problems;
    private final ObjectMapper mapper;

    public IdempotencyFilter(IdempotencyStore store, ProblemFactory problems, ObjectMapper mapper) {
        this.store = store;
        this.problems = problems;
        this.mapper = mapper;
    }

    private record Match(String template, Map<String, String> variables) { }

    private Optional<Match> match(HttpServletRequest request) {
        if (!"POST".equals(request.getMethod())) return Optional.empty();
        PathContainer path = PathContainer.parsePath(request.getRequestURI());
        for (PathPattern p : PATTERNS) {
            PathPattern.PathMatchInfo info = p.matchAndExtract(path);
            if (info != null) return Optional.of(new Match(p.getPatternString(), new TreeMap<>(info.getUriVariables())));
        }
        return Optional.empty();
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) { return match(request).isEmpty(); }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        Match match = match(request).orElseThrow();
        String header = request.getHeader("Idempotency-Key");
        if (header == null || header.isBlank()) {
            problems.write(request, response, 400, "IDEMPOTENCY_KEY_REQUIRED", null, Map.of());
            return;
        }
        UUID key;
        try {
            key = UUID.fromString(header.trim());
        } catch (IllegalArgumentException e) {
            problems.write(request, response, 400, "IDEMPOTENCY_KEY_INVALID", null, Map.of());
            return;
        }
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        String principal = auth == null ? "anonymous" : auth.getName();
        byte[] body = request.getInputStream().readAllBytes();
        String scope = "events-service#" + key;
        Outcome outcome = store.reserve(scope, hash(request, match, principal, body), principal);
        switch (outcome) {
            case Replay r -> {
                response.setStatus(r.status());
                r.headers().forEach(response::setHeader);
                response.setHeader("Idempotent-Replayed", "true");
                response.getOutputStream().write(r.body().getBytes(StandardCharsets.UTF_8));
            }
            case InProgress ignored -> {
                response.setHeader("Retry-After", "1");
                problems.write(request, response, 409, "IDEMPOTENCY_IN_PROGRESS", null, Map.of());
            }
            case KeyReused ignored -> problems.write(request, response, 422, "IDEMPOTENCY_KEY_REUSED", null, Map.of());
            case Reserved ignored -> proceed(request, response, chain, scope, body);
        }
    }

    private void proceed(HttpServletRequest request, HttpServletResponse response, FilterChain chain, String scope,
                         byte[] body) throws IOException, ServletException {
        ContentCachingResponseWrapper wrapped = new ContentCachingResponseWrapper(response);
        wrapped.setHeader("Idempotent-Replayed", "false");
        try {
            chain.doFilter(new CachedBodyRequest(request, body), wrapped);
            if (STORABLE.contains(wrapped.getStatus())) {
                Map<String, String> headers = new LinkedHashMap<>();
                for (String name : List.of("Content-Type", "Location", "Content-Language", "Retry-After")) {
                    if (wrapped.getHeader(name) != null) headers.put(name, wrapped.getHeader(name));
                }
                store.complete(scope, wrapped.getStatus(), headers,
                        new String(wrapped.getContentAsByteArray(), StandardCharsets.UTF_8));
            } else {
                store.release(scope);
            }
        } catch (IOException | ServletException | RuntimeException e) {
            store.release(scope);
            throw e;
        } finally {
            wrapped.copyBodyToResponse();
        }
    }

    private String hash(HttpServletRequest request, Match match, String principal, byte[] body) {
        String canonical = "";
        try {
            if (body.length > 0) canonical = mapper.writeValueAsString(sort(mapper.readValue(body, Object.class)));
        } catch (RuntimeException e) {
            canonical = new String(body, StandardCharsets.UTF_8);
        }
        String material = request.getMethod() + "\n" + match.template() + "\n" + match.variables() + "\n" + principal + "\n" + canonical;
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(material.getBytes(StandardCharsets.UTF_8)));
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static Object sort(Object value) {
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> sorted = new TreeMap<>();
            map.forEach((k, v) -> sorted.put(String.valueOf(k), sort(v)));
            return sorted;
        }
        if (value instanceof List<?> list) return list.stream().map(IdempotencyFilter::sort).toList();
        return value;
    }

    private static final class CachedBodyRequest extends HttpServletRequestWrapper {
        private final byte[] body;

        CachedBodyRequest(HttpServletRequest request, byte[] body) {
            super(request);
            this.body = body;
        }

        @Override
        public ServletInputStream getInputStream() {
            ByteArrayInputStream in = new ByteArrayInputStream(body);
            return new ServletInputStream() {
                @Override public boolean isFinished() { return in.available() == 0; }
                @Override public boolean isReady() { return true; }
                @Override public void setReadListener(ReadListener listener) { }
                @Override public int read() { return in.read(); }
                @Override public int read(byte[] b, int off, int len) { return in.read(b, off, len); }
            };
        }

        @Override
        public BufferedReader getReader() {
            return new BufferedReader(new InputStreamReader(getInputStream(), StandardCharsets.UTF_8));
        }
    }
}
