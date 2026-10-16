package com.bandadau.events;

import static org.assertj.core.api.Assertions.assertThat;

import com.bandadau.events.infrastructure.config.OtelEnvironmentPostProcessor;
import org.junit.jupiter.api.Test;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.mock.env.MockPropertySource;

class OtelEnvironmentPostProcessorTest {

    private StandardEnvironment run(String disabled, String endpoint) {
        var env = new StandardEnvironment();
        var src = new MockPropertySource();
        if (disabled != null) src.setProperty("OTEL_SDK_DISABLED", disabled);
        if (endpoint != null) src.setProperty("OTEL_EXPORTER_OTLP_ENDPOINT", endpoint);
        env.getPropertySources().addFirst(src);
        new OtelEnvironmentPostProcessor().postProcessEnvironment(env, null);
        return env;
    }

    @Test
    void withoutEndpointExportIsDisabled() {
        var env = run(null, "");
        assertThat(env.getProperty("management.otlp.metrics.export.enabled")).isEqualTo("false");
        assertThat(env.getProperty("management.opentelemetry.tracing.export.otlp.enabled")).isEqualTo("false");
    }

    @Test
    void sdkDisabledWinsOverEndpoint() {
        var env = run("true", "http://lgtm:4318");
        assertThat(env.getProperty("management.otlp.metrics.export.enabled")).isEqualTo("false");
        assertThat(env.getProperty("management.opentelemetry.tracing.export.otlp.enabled")).isEqualTo("false");
    }

    @Test
    void endpointEnablesTracesAndMetrics() {
        var env = run("false", "http://lgtm:4318/");
        assertThat(env.getProperty("management.otlp.metrics.export.enabled")).isEqualTo("true");
        assertThat(env.getProperty("management.otlp.metrics.export.url")).isEqualTo("http://lgtm:4318/v1/metrics");
        assertThat(env.getProperty("management.opentelemetry.tracing.export.otlp.endpoint"))
                .isEqualTo("http://lgtm:4318/v1/traces");
    }
}
