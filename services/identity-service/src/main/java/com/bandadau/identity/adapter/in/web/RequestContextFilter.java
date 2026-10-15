package com.bandadau.identity.adapter.in.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.security.SecureRandom;
import java.util.HexFormat;
import java.util.UUID;
import java.util.regex.Pattern;
import org.slf4j.MDC;
import org.springframework.web.filter.OncePerRequestFilter;

/** Correlation id, W3C trace context and Content-Language for every response; fills the logging MDC. */
public class RequestContextFilter extends OncePerRequestFilter {
    private static final Pattern CORRELATION = Pattern.compile("^[A-Za-z0-9._-]{1,64}$");
    private static final Pattern TRACEPARENT = Pattern.compile("^[0-9a-f]{2}-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$");
    private final SecureRandom random = new SecureRandom();

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String correlation = request.getHeader("X-Correlation-Id");
        if (correlation == null || !CORRELATION.matcher(correlation).matches()) correlation = UUID.randomUUID().toString();
        String traceparent = request.getHeader("traceparent");
        String traceId;
        var matcher = traceparent == null ? null : TRACEPARENT.matcher(traceparent);
        if (matcher != null && matcher.matches()) {
            traceId = matcher.group(1);
        } else {
            traceId = hex(16);
            traceparent = "00-" + traceId + "-" + hex(8) + "-01";
        }
        MDC.put("correlationId", correlation);
        MDC.put("traceId", traceId);
        MDC.put("traceparent", traceparent);
        response.setHeader("X-Correlation-Id", correlation);
        response.setHeader("Content-Language", Locales.resolve(request).getLanguage());
        try {
            chain.doFilter(request, response);
        } finally {
            MDC.clear();
        }
    }

    private String hex(int bytes) {
        byte[] buffer = new byte[bytes];
        random.nextBytes(buffer);
        return HexFormat.of().formatHex(buffer);
    }
}
