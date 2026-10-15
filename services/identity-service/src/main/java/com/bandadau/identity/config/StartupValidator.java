package com.bandadau.identity.config;

import jakarta.annotation.PostConstruct;
import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.stereotype.Component;

/** Fail fast: reports every invalid or missing environment variable at startup (12-factor). */
@Component
public class StartupValidator {
    private final AppProperties props;
    private final Environment env;

    public StartupValidator(AppProperties props, Environment env) {
        this.props = props;
        this.env = env;
    }

    @PostConstruct
    void validate() {
        List<String> problems = new ArrayList<>();
        boolean dev = env.acceptsProfiles(Profiles.of("dev", "test"));
        requireJdbcUrl(problems);
        requireText(problems, "DATABASE_USER", env.getProperty("spring.datasource.username"));
        if (!dev) requireText(problems, "DATABASE_PASSWORD", env.getProperty("spring.datasource.password"));
        requireText(problems, "RABBITMQ_URL", env.getProperty("spring.rabbitmq.addresses"));
        requireUrl(problems, "JWT_ISSUER", props.jwt().issuer());
        requireUrl(problems, "APP_BASE_URL", props.urls().appBaseUrl());
        requireUrl(problems, "ADMIN_BASE_URL", props.urls().adminBaseUrl());
        requireText(problems, "SMTP_HOST", env.getProperty("spring.mail.host"));
        requireText(problems, "MAIL_FROM", props.mail().from());
        if (!List.of("es", "en").contains(props.defaultLocale())) problems.add("DEFAULT_LOCALE must be es or en");
        if (props.tokens().accessTtl().isNegative() || props.tokens().accessTtl().isZero()) {
            problems.add("ACCESS_TOKEN_TTL must be positive");
        }
        if (!dev) {
            if (props.jwt().kek() == null || props.jwt().kek().length() < 32) {
                problems.add("JWT_KEK is required (at least 32 characters) outside dev");
            }
            if (props.serviceClients() == null || props.serviceClients().isBlank()) {
                problems.add("SERVICE_CLIENTS is required outside dev");
            }
            if (!props.web().cookieSecure()) problems.add("COOKIE_SECURE must be true outside dev");
            if (props.mail().logCode()) problems.add("MAIL_LOG_CODE must be false outside dev");
        } else if (props.jwt().kek() == null || props.jwt().kek().isBlank()) {
            problems.add("JWT_KEK is required (any non-empty value in dev)");
        }
        if (!problems.isEmpty()) {
            throw new IllegalStateException("Invalid configuration:\n - " + String.join("\n - ", problems));
        }
    }

    private void requireJdbcUrl(List<String> problems) {
        String url = env.getProperty("spring.datasource.url");
        if (url == null || !url.startsWith("jdbc:postgresql://")) problems.add("DATABASE_URL must start with jdbc:postgresql://");
    }

    private static void requireText(List<String> problems, String name, String value) {
        if (value == null || value.isBlank()) problems.add(name + " is required");
    }

    private static void requireUrl(List<String> problems, String name, String value) {
        try {
            URI uri = URI.create(value == null ? "" : value);
            if (uri.getScheme() == null || uri.getHost() == null) problems.add(name + " must be an absolute URL");
        } catch (IllegalArgumentException e) {
            problems.add(name + " must be an absolute URL");
        }
    }
}
