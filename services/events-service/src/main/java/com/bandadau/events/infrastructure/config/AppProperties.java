package com.bandadau.events.infrastructure.config;

import java.time.Duration;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "bandada")
public record AppProperties(Jwt jwt, Identity identity, Media media, Saga saga, Events events, Outbox outbox, Rabbit rabbit,
                            String defaultLocale) {

    public record Jwt(String issuer, String jwksUrl) { }

    public record Identity(String url, String clientId, String clientSecret) { }

    public record Media(String coverCheck, String url, Duration timeout) {
        public boolean enabled() { return !"off".equalsIgnoreCase(coverCheck); }
    }

    public record Saga(Duration stepTimeout, List<Duration> resendOffsets, Duration compensationBackoffBase,
                       Duration compensationBackoffCap, Duration compensationAlertAfter, Duration schedulerInterval) { }

    public record Events(Duration defaultDuration, Duration cancellationCutoff) { }

    public record Outbox(Duration relayInterval, int batchSize) { }

    public record Rabbit(boolean declareTopology) { }
}
