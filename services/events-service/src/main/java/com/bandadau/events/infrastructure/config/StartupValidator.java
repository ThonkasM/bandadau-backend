package com.bandadau.events.infrastructure.config;

import jakarta.annotation.PostConstruct;
import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.stereotype.Component;

/** Fail fast: reports every invalid or missing environment variable at startup. */
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
        String db = env.getProperty("spring.datasource.url");
        if (db == null || !db.startsWith("jdbc:postgresql://")) problems.add("DATABASE_URL must start with jdbc:postgresql://");
        text(problems, "DATABASE_USER", env.getProperty("spring.datasource.username"));
        if (!dev) text(problems, "DATABASE_PASSWORD", env.getProperty("spring.datasource.password"));
        text(problems, "RABBITMQ_URL", env.getProperty("spring.rabbitmq.addresses"));
        url(problems, "JWT_ISSUER", props.jwt().issuer());
        url(problems, "JWKS_URL", props.jwt().jwksUrl());
        if (!List.of("es", "en").contains(props.defaultLocale())) problems.add("DEFAULT_LOCALE must be es or en");
        if (props.media().enabled()) {
            url(problems, "MEDIA_SERVICE_URL", props.media().url());
            text(problems, "SERVICE_CLIENT_ID", props.identity().clientId());
            text(problems, "SERVICE_CLIENT_SECRET", props.identity().clientSecret());
            if (identityUrl(props).isBlank()) problems.add("IDENTITY_SERVICE_URL (or a JWKS_URL to derive it from) is required when COVER_CHECK=on");
        }
        if (props.saga().resendOffsets() == null) problems.add("SAGA_RESEND_OFFSETS must be a list of ISO-8601 durations");
        if (props.saga().stepTimeout().isZero() || props.saga().stepTimeout().isNegative()) problems.add("SAGA_STEP_TIMEOUT must be positive");
        if (!problems.isEmpty()) throw new IllegalStateException("Invalid configuration:\n - " + String.join("\n - ", problems));
    }

    /** IDENTITY_SERVICE_URL, or the origin of JWKS_URL when it is not set. */
    public static String identityUrl(AppProperties props) {
        String explicit = props.identity().url();
        if (explicit != null && !explicit.isBlank()) return explicit.endsWith("/") ? explicit.substring(0, explicit.length() - 1) : explicit;
        try {
            URI jwks = URI.create(props.jwt().jwksUrl());
            return jwks.getScheme() + "://" + jwks.getAuthority();
        } catch (RuntimeException e) {
            return "";
        }
    }

    private static void text(List<String> problems, String name, String value) {
        if (value == null || value.isBlank()) problems.add(name + " is required");
    }

    private static void url(List<String> problems, String name, String value) {
        try {
            URI uri = URI.create(value == null ? "" : value);
            if (uri.getScheme() == null || uri.getHost() == null) problems.add(name + " must be an absolute URL");
        } catch (IllegalArgumentException e) {
            problems.add(name + " must be an absolute URL");
        }
    }
}
