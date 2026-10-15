package com.bandadau.identity.adapter;

import static org.assertj.core.api.Assertions.assertThat;

import com.bandadau.identity.adapter.in.web.Locales;
import com.bandadau.identity.adapter.in.web.RateLimiter;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

class WebSupportTest {

    @Test
    void localeFallsBackToSpanishAndHonoursEnglish() {
        MockHttpServletRequest req = new MockHttpServletRequest();
        assertThat(Locales.resolve(req).getLanguage()).isEqualTo("es");
        req.addHeader("Accept-Language", "fr-FR,fr;q=0.9");
        assertThat(Locales.resolve(req).getLanguage()).isEqualTo("es");
        MockHttpServletRequest en = new MockHttpServletRequest();
        en.addHeader("Accept-Language", "en-US,en;q=0.9,es;q=0.8");
        assertThat(Locales.resolve(en).getLanguage()).isEqualTo("en");
        MockHttpServletRequest bad = new MockHttpServletRequest();
        bad.addHeader("Accept-Language", ";;;");
        assertThat(Locales.resolve(bad).getLanguage()).isEqualTo("es");
    }

    @Test
    void rateLimiterAllowsUpToTheLimitThenReportsRetryAfter() {
        AtomicLong clock = new AtomicLong(0);
        RateLimiter limiter = new RateLimiter(true, clock::get);
        assertThat(limiter.check("k", 2, Duration.ofMinutes(1))).isZero();
        assertThat(limiter.check("k", 2, Duration.ofMinutes(1))).isZero();
        assertThat(limiter.check("k", 2, Duration.ofMinutes(1))).isPositive();
        assertThat(limiter.check("other", 2, Duration.ofMinutes(1))).isZero();
        clock.set(61_000);
        assertThat(limiter.check("k", 2, Duration.ofMinutes(1))).isZero();
        assertThat(new RateLimiter(false).check("k", 0, Duration.ofMinutes(1))).isZero();
    }
}
