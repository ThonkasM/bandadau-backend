package com.bandadau.identity.adapter.in.web;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import org.slf4j.MDC;
import org.springframework.context.MessageSource;
import tools.jackson.databind.ObjectMapper;

/** Builds and writes RFC 9457 Problem Details with localized title/detail and a stable {@code code}. */
public class ProblemFactory {
    private static final String TYPE_BASE = "https://api.bandadau.com/problems/";

    private final MessageSource messages;
    private final ObjectMapper mapper;

    public ProblemFactory(MessageSource messages, ObjectMapper mapper) {
        this.messages = messages;
        this.mapper = mapper;
    }

    public Map<String, Object> build(HttpServletRequest request, int status, String code, Object[] args,
                                     Map<String, Object> extra) {
        Locale locale = Locales.resolve(request);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("type", TYPE_BASE + code.toLowerCase(Locale.ROOT).replace('_', '-'));
        body.put("title", messages.getMessage("problem." + code + ".title", args,
                messages.getMessage("problem.generic." + status + ".title", args, "Error", locale), locale));
        body.put("status", status);
        body.put("detail", messages.getMessage("problem." + code + ".detail", args,
                messages.getMessage("problem.generic." + status + ".detail", args, "", locale), locale));
        body.put("instance", request.getRequestURI());
        body.put("code", code);
        String traceId = MDC.get("traceId");
        if (traceId != null) body.put("traceId", traceId);
        String correlation = MDC.get("correlationId");
        if (correlation != null) body.put("correlationId", correlation);
        if (extra != null) body.putAll(extra);
        return body;
    }

    public String fieldMessage(HttpServletRequest request, String code) {
        return messages.getMessage("error." + code, null, code, Locales.resolve(request));
    }

    public void write(HttpServletRequest request, HttpServletResponse response, int status, String code, Object[] args,
                      Map<String, Object> extra) throws IOException {
        response.setStatus(status);
        response.setContentType("application/problem+json");
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.setHeader("Content-Language", Locales.resolve(request).getLanguage());
        response.getWriter().write(mapper.writeValueAsString(build(request, status, code, args, extra)));
    }
}
