package com.bandadau.identity.adapter.in.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.time.Duration;
import java.util.Map;
import java.util.Set;
import org.springframework.web.filter.OncePerRequestFilter;

/** Per-IP limit on the sensitive authentication endpoints (UC-01, UC-02, UC-03). */
public class RateLimitFilter extends OncePerRequestFilter {
    private static final Set<String> LIMITED = Set.of("/api/v1/auth/login", "/api/v1/auth/register",
            "/api/v1/auth/verify-email", "/api/v1/auth/resend-code", "/api/v1/auth/refresh",
            "/api/v1/auth/handoff/exchange", "/api/v1/auth/service-token");

    private final RateLimiter limiter;
    private final ProblemFactory problems;
    private final int perMinute;

    public RateLimitFilter(RateLimiter limiter, ProblemFactory problems, int perMinute) {
        this.limiter = limiter;
        this.problems = problems;
        this.perMinute = perMinute;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !"POST".equals(request.getMethod()) || !LIMITED.contains(request.getRequestURI());
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        long retry = limiter.check("ip:" + request.getRequestURI() + ":" + request.getRemoteAddr(), perMinute,
                Duration.ofMinutes(1));
        if (retry > 0) {
            response.setHeader("Retry-After", String.valueOf(retry));
            problems.write(request, response, 429, "RATE_LIMITED", new Object[] {retry}, Map.of());
            return;
        }
        chain.doFilter(request, response);
    }
}
