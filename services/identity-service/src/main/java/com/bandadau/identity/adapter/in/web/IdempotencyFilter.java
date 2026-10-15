package com.bandadau.identity.adapter.in.web;

import com.bandadau.identity.application.port.out.IdempotencyStorePort;
import com.bandadau.identity.application.port.out.IdempotencyStorePort.*;
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
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.util.ContentCachingResponseWrapper;
import tools.jackson.databind.ObjectMapper;

/** D3 mechanism 1 for registerUser: replays the stored response for a repeated Idempotency-Key. */
public class IdempotencyFilter extends OncePerRequestFilter {
    private static final String ROUTE = "/api/v1/auth/register";
    private static final Set<Integer> STORABLE = Set.of(200, 201, 202, 400, 404, 409, 422);

    private final IdempotencyStorePort store;
    private final ProblemFactory problems;
    private final ObjectMapper mapper;

    public IdempotencyFilter(IdempotencyStorePort store, ProblemFactory problems, ObjectMapper mapper) {
        this.store = store;
        this.problems = problems;
        this.mapper = mapper;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !"POST".equals(request.getMethod()) || !ROUTE.equals(request.getRequestURI());
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
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
        byte[] body = request.getInputStream().readAllBytes();
        String scope = "identity#" + key;
        Outcome outcome = store.reserve(scope, hash(request, body), "anonymous");
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
                for (String name : List.of("Content-Type", "Location", "Content-Language")) {
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

    private String hash(HttpServletRequest request, byte[] body) {
        try {
            String canonical = body.length == 0 ? "" : mapper.writeValueAsString(sort(mapper.readValue(body, Object.class)));
            String material = request.getMethod() + "\n" + ROUTE + "\n\nanonymous\n" + canonical;
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(material.getBytes(StandardCharsets.UTF_8)));
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        } catch (RuntimeException e) {
            // Unparseable body: hash the raw bytes; the controller will answer 400 afterwards.
            return HexFormat.of().formatHex(new byte[32]);
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
