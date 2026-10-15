package com.bandadau.identity.config;

import java.time.Duration;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "bandada")
public record AppProperties(Jwt jwt, Tokens tokens, Urls urls, Mail mail, Web web, Outbox outbox, Rabbit rabbit,
                            String serviceClients, String defaultLocale) {

    public record Jwt(String issuer, String kek, String keyId, String privateKeyPath, Duration rotationInterval,
                      Duration activationDelay, Duration retiringGrace) { }

    public record Tokens(Duration accessTtl, Duration refreshTtl, Duration adminRefreshTtl, Duration handoffTtl,
                         Duration verificationTtl, Duration serviceTokenTtl) { }

    public record Urls(String appBaseUrl, String adminBaseUrl) { }

    public record Mail(String from, boolean logCode) { }

    public record Web(boolean cookieSecure, List<String> corsOrigins, boolean rateLimitEnabled, int authPerMinute,
                      int handoffPerMinute, Duration resendMinInterval, int resendPerHour,
                      boolean hideExistingAccounts) { }

    public record Outbox(Duration relayInterval, int batchSize) { }

    public record Rabbit(boolean declareTopology) { }
}
