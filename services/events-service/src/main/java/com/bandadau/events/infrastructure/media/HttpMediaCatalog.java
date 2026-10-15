package com.bandadau.events.infrastructure.media;

import com.bandadau.events.application.port.MediaCatalog;
import com.bandadau.events.domain.shared.DomainException;
import com.bandadau.events.domain.shared.Errors;
import io.github.resilience4j.circuitbreaker.CallNotPermittedException;
import io.github.resilience4j.circuitbreaker.CircuitBreaker;
import io.github.resilience4j.circuitbreaker.CircuitBreakerConfig;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import tools.jackson.databind.ObjectMapper;

/**
 * media-service adapter: timeout + circuit breaker (50% of 20 calls, 30 s open). With {@code COVER_CHECK=off}
 * nothing is called (development without media-service).
 */
public class HttpMediaCatalog implements MediaCatalog {
    private static final Logger log = LoggerFactory.getLogger(HttpMediaCatalog.class);
    private static final Duration URL_CACHE = Duration.ofMinutes(10);

    private record Cached(String url, Instant at) { }

    private final boolean enabled;
    private final String baseUrl;
    private final Duration timeout;
    private final HttpClient http;
    private final ServiceTokenProvider tokens;
    private final ObjectMapper mapper;
    private final CircuitBreaker breaker;
    private final Map<UUID, Cached> urlCache = new ConcurrentHashMap<>();

    public HttpMediaCatalog(boolean enabled, String baseUrl, Duration timeout, HttpClient http, ServiceTokenProvider tokens,
                            ObjectMapper mapper) {
        this.enabled = enabled;
        this.baseUrl = baseUrl;
        this.timeout = timeout;
        this.http = http;
        this.tokens = tokens;
        this.mapper = mapper;
        this.breaker = CircuitBreaker.of("media-service", CircuitBreakerConfig.custom()
                .slidingWindowSize(20).minimumNumberOfCalls(5).failureRateThreshold(50)
                .waitDurationInOpenState(Duration.ofSeconds(30)).ignoreExceptions(DomainException.class).build());
    }

    @Override
    @SuppressWarnings("unchecked")
    public void ensureApprovedCover(UUID mediaId, UUID ownerId) {
        if (!enabled) return;
        Map<String, Object> media = call("/internal/v1/media/" + mediaId, true);
        if (media == null) throw Errors.mediaNotApproved();
        boolean approved = "APPROVED".equals(media.get("status"));
        boolean mine = ownerId.toString().equals(String.valueOf(media.get("ownerId")));
        boolean cover = media.get("purpose") == null || "EVENT_COVER".equals(media.get("purpose"));
        if (!approved || !mine || !cover) throw Errors.mediaNotApproved();
    }

    @Override
    @SuppressWarnings("unchecked")
    public Map<UUID, String> coverUrls(Collection<UUID> mediaIds) {
        Map<UUID, String> out = new HashMap<>();
        if (!enabled || mediaIds.isEmpty()) return out;
        Instant now = Instant.now();
        List<UUID> missing = new ArrayList<>();
        for (UUID id : new LinkedHashSet<>(mediaIds)) {
            Cached c = urlCache.get(id);
            if (c != null && c.at().plus(URL_CACHE).isAfter(now)) {
                if (c.url() != null) out.put(id, c.url());
            } else {
                missing.add(id);
            }
        }
        if (missing.isEmpty()) return out;
        try {
            Map<String, Object> body = call("/internal/v1/media/urls?ids=" + missing.stream().map(UUID::toString)
                    .collect(Collectors.joining(",")), false);
            if (body != null && body.get("items") instanceof List<?> items) {
                for (Object item : items) {
                    Map<String, Object> m = (Map<String, Object>) item;
                    UUID id = UUID.fromString(String.valueOf(m.get("mediaId")));
                    String url = m.get("url") == null ? null : String.valueOf(m.get("url"));
                    urlCache.put(id, new Cached(url, now));
                    if (url != null) out.put(id, url);
                }
            }
        } catch (DomainException e) {
            log.warn("event=media.urls.degraded code={}", e.code());
        }
        return out;
    }

    /** @return the JSON body, or null on 404. Throws MEDIA_UNAVAILABLE on timeouts, 5xx or an open breaker. */
    private Map<String, Object> call(String path, boolean notFoundIsNull) {
        try {
            return breaker.executeCheckedSupplier(() -> fetch(path));
        } catch (CallNotPermittedException e) {
            throw Errors.mediaUnavailable();
        } catch (DomainException e) {
            throw e;
        } catch (Throwable e) {
            log.warn("event=media.call.failed path={} error={}", path.split("\\?")[0], e.toString());
            throw Errors.mediaUnavailable();
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> fetch(String path) throws IOException, InterruptedException {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(baseUrl + path)).timeout(timeout)
                .header("Authorization", "Bearer " + tokens.get()).header("Accept", "application/json");
        String correlation = MDC.get("correlationId");
        if (correlation != null) b.header("X-Correlation-Id", correlation);
        HttpResponse<String> r = http.send(b.GET().build(), HttpResponse.BodyHandlers.ofString());
        if (r.statusCode() == 404) return null;
        if (r.statusCode() / 100 != 2) throw new IOException("media-service answered " + r.statusCode());
        return mapper.readValue(r.body(), Map.class);
    }
}
