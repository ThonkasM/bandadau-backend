package com.bandadau.events.interfaces.rest;

import com.bandadau.events.domain.shared.DomainException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolationException;
import java.util.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.FieldError;
import org.springframework.web.HttpMediaTypeNotAcceptableException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingRequestHeaderException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

@RestControllerAdvice
public class ProblemDetailsAdvice {
    private static final Logger log = LoggerFactory.getLogger(ProblemDetailsAdvice.class);
    private static final MediaType PROBLEM = MediaType.APPLICATION_PROBLEM_JSON;

    private final ProblemFactory problems;

    public ProblemDetailsAdvice(ProblemFactory problems) {
        this.problems = problems;
    }

    private ResponseEntity<Map<String, Object>> respond(HttpServletRequest req, int status, String code, Object[] args,
                                                        Map<String, Object> extra, HttpHeaders headers) {
        HttpHeaders out = new HttpHeaders();
        out.setContentType(PROBLEM);
        out.set(HttpHeaders.CONTENT_LANGUAGE, Locales.resolve(req).getLanguage());
        if (headers != null) out.putAll(headers);
        return new ResponseEntity<>(problems.build(req, status, code, args, extra), out, status);
    }

    public static int statusOf(DomainException.Kind kind) {
        return switch (kind) {
            case INVALID -> 400;
            case UNAUTHORIZED -> 401;
            case FORBIDDEN -> 403;
            case NOT_FOUND -> 404;
            case CONFLICT -> 409;
            case UNPROCESSABLE -> 422;
            case TOO_MANY -> 429;
            case UNAVAILABLE -> 503;
        };
    }

    @ExceptionHandler(DomainException.class)
    ResponseEntity<Map<String, Object>> domain(DomainException e, HttpServletRequest req) {
        Map<String, Object> params = new LinkedHashMap<>(e.params());
        HttpHeaders headers = new HttpHeaders();
        Object retryAfter = params.remove("retryAfter");
        if (retryAfter != null) headers.set(HttpHeaders.RETRY_AFTER, String.valueOf(retryAfter));
        Object[] args = params.values().toArray();
        Map<String, Object> extra = new LinkedHashMap<>();
        if (params.containsKey("registrationId")) extra.put("registrationId", params.get("registrationId"));
        if (params.get("errors") instanceof List<?> list) {
            List<Map<String, Object>> errors = new ArrayList<>();
            for (Object item : list) {
                Map<?, ?> m = (Map<?, ?>) item;
                errors.add(fieldError(req, String.valueOf(m.get("field")), String.valueOf(m.get("code"))));
            }
            extra.put("errors", errors);
        }
        if (e.kind() == DomainException.Kind.UNAUTHORIZED) headers.set(HttpHeaders.WWW_AUTHENTICATE, "Bearer");
        return respond(req, statusOf(e.kind()), e.code(), args, extra, headers);
    }

    private Map<String, Object> fieldError(HttpServletRequest req, String field, String code) {
        Map<String, Object> error = new LinkedHashMap<>();
        error.put("field", field);
        error.put("pointer", "/" + field.replace('.', '/'));
        error.put("code", code);
        error.put("message", problems.fieldMessage(req, code));
        return error;
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<Map<String, Object>> invalidBody(MethodArgumentNotValidException e, HttpServletRequest req) {
        List<Map<String, Object>> errors = new ArrayList<>();
        for (FieldError fe : e.getBindingResult().getFieldErrors()) {
            errors.add(fieldError(req, fe.getField(), codeOf(fe)));
        }
        return respond(req, 400, "VALIDATION_FAILED", null, Map.of("errors", errors), null);
    }

    static String codeOf(FieldError fe) {
        String constraint = fe.getCode() == null ? "" : fe.getCode();
        return switch (constraint) {
            case "NotNull", "NotBlank", "NotEmpty" -> "REQUIRED";
            case "Size", "Length" -> {
                Object value = fe.getRejectedValue();
                Object[] args = fe.getArguments();
                int max = args != null && args.length > 1 && args[1] instanceof Integer i ? i : Integer.MAX_VALUE;
                int length = value instanceof CharSequence cs ? cs.length() : value instanceof Collection<?> c ? c.size() : 0;
                yield length > max ? "TOO_LONG" : "TOO_SHORT";
            }
            case "Min", "DecimalMin", "Positive", "PositiveOrZero" -> "TOO_SMALL";
            case "Max", "DecimalMax" -> "TOO_LARGE";
            default -> "INVALID_FORMAT";
        };
    }

    @ExceptionHandler({HandlerMethodValidationException.class, ConstraintViolationException.class})
    ResponseEntity<Map<String, Object>> invalidParams(Exception e, HttpServletRequest req) {
        return respond(req, 400, "VALIDATION_FAILED", null,
                Map.of("errors", List.of(fieldError(req, "request", "INVALID_FORMAT"))), null);
    }

    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    ResponseEntity<Map<String, Object>> typeMismatch(MethodArgumentTypeMismatchException e, HttpServletRequest req) {
        return respond(req, 400, "VALIDATION_FAILED", null,
                Map.of("errors", List.of(fieldError(req, e.getName(), "INVALID_FORMAT"))), null);
    }

    @ExceptionHandler({MissingRequestHeaderException.class, MissingServletRequestParameterException.class})
    ResponseEntity<Map<String, Object>> missing(Exception e, HttpServletRequest req) {
        String name = e instanceof MissingRequestHeaderException h ? h.getHeaderName()
                : ((MissingServletRequestParameterException) e).getParameterName();
        return respond(req, 400, "VALIDATION_FAILED", null,
                Map.of("errors", List.of(fieldError(req, name, "REQUIRED"))), null);
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<Map<String, Object>> unreadable(HttpMessageNotReadableException e, HttpServletRequest req) {
        return respond(req, 400, "MALFORMED_REQUEST", null, null, null);
    }

    @ExceptionHandler(NoResourceFoundException.class)
    ResponseEntity<Map<String, Object>> noResource(NoResourceFoundException e, HttpServletRequest req) {
        return respond(req, 404, "NOT_FOUND", new Object[] {"resource"}, null, null);
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    ResponseEntity<Map<String, Object>> method(HttpRequestMethodNotSupportedException e, HttpServletRequest req) {
        return respond(req, 405, "METHOD_NOT_ALLOWED", null, null, null);
    }

    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    ResponseEntity<Map<String, Object>> mediaType(HttpMediaTypeNotSupportedException e, HttpServletRequest req) {
        return respond(req, 415, "UNSUPPORTED_MEDIA_TYPE", null, null, null);
    }

    @ExceptionHandler(HttpMediaTypeNotAcceptableException.class)
    ResponseEntity<Map<String, Object>> notAcceptable(HttpMediaTypeNotAcceptableException e, HttpServletRequest req) {
        return respond(req, 406, "NOT_ACCEPTABLE", null, null, null);
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<Map<String, Object>> unexpected(Exception e, HttpServletRequest req) {
        log.error("event=request.failed path={} error={}", req.getRequestURI(), e.toString(), e);
        return respond(req, 500, "INTERNAL_ERROR", null, null, null);
    }
}
