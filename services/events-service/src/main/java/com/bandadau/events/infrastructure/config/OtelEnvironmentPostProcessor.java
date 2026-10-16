package com.bandadau.events.infrastructure.config;

import java.util.HashMap;
import java.util.Map;
import org.springframework.boot.EnvironmentPostProcessor;
import org.springframework.boot.SpringApplication;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.MapPropertySource;

/**
 * Traduce las variables estándar de OpenTelemetry (las mismas que usan los demás servicios del stack) a las
 * propiedades de Spring Boot 4:
 * <ul>
 *   <li>{@code OTEL_SDK_DISABLED=true} o {@code OTEL_EXPORTER_OTLP_ENDPOINT} vacío → exportación desactivada
 *       (arranque y pruebas no necesitan colector).</li>
 *   <li>Con endpoint (p. ej. {@code http://lgtm:4318}, OTLP/HTTP) → trazas a {@code <endpoint>/v1/traces} y métricas a
 *       {@code <endpoint>/v1/metrics}.</li>
 * </ul>
 * Se registra con prioridad más baja que {@code application.yml} y que las propiedades explícitas.
 */
public class OtelEnvironmentPostProcessor implements EnvironmentPostProcessor {

    static final String SOURCE_NAME = "bandadaOtel";

    @Override
    public void postProcessEnvironment(ConfigurableEnvironment env, SpringApplication application) {
        boolean disabled = Boolean.parseBoolean(env.getProperty("OTEL_SDK_DISABLED", "false").trim());
        String endpoint = env.getProperty("OTEL_EXPORTER_OTLP_ENDPOINT", "").trim();
        while (endpoint.endsWith("/")) endpoint = endpoint.substring(0, endpoint.length() - 1);
        boolean enabled = !disabled && !endpoint.isEmpty();

        Map<String, Object> p = new HashMap<>();
        p.put("management.otlp.metrics.export.enabled", enabled);
        p.put("management.opentelemetry.tracing.export.otlp.enabled", enabled);
        if (enabled) {
            p.put("management.otlp.metrics.export.url", endpoint + "/v1/metrics");
            p.put("management.opentelemetry.tracing.export.otlp.endpoint", endpoint + "/v1/traces");
        }
        env.getPropertySources().addLast(new MapPropertySource(SOURCE_NAME, p));
    }
}
