package com.bandadau.identity.adapter.in.web;

import com.bandadau.identity.adapter.in.web.dto.AuthTokensResponse;
import com.bandadau.identity.adapter.in.web.dto.Requests.*;
import com.bandadau.identity.adapter.in.web.dto.Responses.*;
import com.bandadau.identity.application.port.in.*;
import com.bandadau.identity.application.port.in.CreateHandoffCodeUseCase.HandoffCreated;
import com.bandadau.identity.application.port.in.RegisterUserUseCase.RegisterUserCommand;
import com.bandadau.identity.application.port.in.RegisterUserUseCase.RegisteredUser;
import com.bandadau.identity.domain.exception.DomainException;
import com.bandadau.identity.domain.exception.Errors;
import com.bandadau.identity.domain.model.Language;
import com.bandadau.identity.domain.model.TargetApp;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import java.net.URI;
import java.time.Duration;
import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    public record Settings(boolean cookieSecure, List<String> allowedOrigins, int handoffPerMinute,
                           Duration resendMinInterval, int resendPerHour) { }

    private final RegisterUserUseCase register;
    private final VerifyEmailUseCase verify;
    private final ResendVerificationCodeUseCase resend;
    private final LoginUseCase login;
    private final RefreshTokenUseCase refresh;
    private final LogoutUseCase logout;
    private final CreateHandoffCodeUseCase createHandoff;
    private final ExchangeHandoffCodeUseCase exchangeHandoff;
    private final IssueServiceTokenUseCase serviceToken;
    private final RateLimiter limiter;
    private final Settings settings;

    public AuthController(RegisterUserUseCase register, VerifyEmailUseCase verify, ResendVerificationCodeUseCase resend,
                          LoginUseCase login, RefreshTokenUseCase refresh, LogoutUseCase logout,
                          CreateHandoffCodeUseCase createHandoff, ExchangeHandoffCodeUseCase exchangeHandoff,
                          IssueServiceTokenUseCase serviceToken, RateLimiter limiter, Settings settings) {
        this.register = register;
        this.verify = verify;
        this.resend = resend;
        this.login = login;
        this.refresh = refresh;
        this.logout = logout;
        this.createHandoff = createHandoff;
        this.exchangeHandoff = exchangeHandoff;
        this.serviceToken = serviceToken;
        this.limiter = limiter;
        this.settings = settings;
    }

    @PostMapping("/register")
    public ResponseEntity<RegisterUserResponse> registerUser(@Valid @RequestBody RegisterUserRequest body,
                                                             HttpServletRequest request) {
        Language language = body.locale() != null ? Language.fromCode(body.locale()) : Locales.language(request);
        RegisteredUser result = register.register(new RegisterUserCommand(body.email(), body.password(),
                body.universityId(), language));
        return ResponseEntity.status(HttpStatus.CREATED).body(new RegisterUserResponse(result.userId(), result.email(),
                result.status().name(), result.verificationExpiresIn()));
    }

    @PostMapping("/verify-email")
    public ResponseEntity<AuthTokensResponse> verifyEmail(@Valid @RequestBody VerifyEmailRequest body,
                                                          @RequestHeader(value = "X-Bandada-Client", required = false) String client,
                                                          HttpServletResponse response) {
        ClientMode mode = ClientMode.parse(client);
        return tokens(verify.verify(body.email(), body.code(), mode.target()), mode, response);
    }

    @PostMapping("/resend-code")
    public ResponseEntity<Void> resendVerificationCode(@Valid @RequestBody ResendVerificationCodeRequest body) {
        String key = "resend:" + body.email().trim().toLowerCase(java.util.Locale.ROOT);
        long wait = Math.max(limiter.check(key + ":interval", 1, settings.resendMinInterval()),
                limiter.check(key + ":hour", settings.resendPerHour(), Duration.ofHours(1)));
        if (wait > 0) throw Errors.loginLocked(wait);
        resend.resend(body.email());
        return ResponseEntity.accepted().build();
    }

    @PostMapping("/login")
    public ResponseEntity<AuthTokensResponse> loginUser(@Valid @RequestBody LoginRequest body,
                                                        @RequestHeader(value = "X-Bandada-Client", required = false) String client,
                                                        HttpServletResponse response) {
        ClientMode mode = ClientMode.parse(client);
        return tokens(login.login(body.email(), body.password(), mode.target()), mode, response);
    }

    @PostMapping("/refresh")
    public ResponseEntity<AuthTokensResponse> refreshToken(@RequestBody(required = false) @Valid RefreshTokenRequest body,
                                                           @RequestHeader(value = "X-Bandada-Client", required = false) String client,
                                                           HttpServletRequest request, HttpServletResponse response) {
        ClientMode mode = ClientMode.parse(client);
        String token = presentedToken(body, mode, request);
        return tokens(refresh.refresh(token), mode, response);
    }

    @PostMapping("/logout")
    public ResponseEntity<Void> logoutUser(@RequestBody(required = false) @Valid RefreshTokenRequest body,
                                           @RequestHeader(value = "X-Bandada-Client", required = false) String client,
                                           @AuthenticationPrincipal Jwt jwt, HttpServletRequest request,
                                           HttpServletResponse response) {
        ClientMode mode = ClientMode.parse(client);
        String token = presentedToken(body, mode, request);
        logout.logout(UUID.fromString(jwt.getSubject()), token);
        if (mode.usesCookie()) response.addHeader(HttpHeaders.SET_COOKIE, cookie(mode, "", Duration.ZERO).toString());
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/handoff")
    public ResponseEntity<HandoffCodeResponse> createHandoffCode(@Valid @RequestBody CreateHandoffCodeRequest body,
                                                                 @AuthenticationPrincipal Jwt jwt,
                                                                 HttpServletRequest request) {
        long wait = limiter.check("handoff:" + jwt.getSubject(), settings.handoffPerMinute(), Duration.ofMinutes(1));
        if (wait > 0) throw Errors.loginLocked(wait);
        HandoffCreated created = createHandoff.create(UUID.fromString(jwt.getSubject()),
                TargetApp.valueOf(body.targetApp()), body.codeChallenge(), request.getRemoteAddr());
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(new HandoffCodeResponse(created.code(), created.redirectUrl(), created.expiresIn()));
    }

    @PostMapping("/handoff/exchange")
    public ResponseEntity<AuthTokensResponse> exchangeHandoffCode(@Valid @RequestBody ExchangeHandoffCodeRequest body,
                                                                  @RequestHeader(value = "X-Bandada-Client", required = false) String client,
                                                                  HttpServletResponse response) {
        ClientMode mode = ClientMode.parse(client);
        return tokens(exchangeHandoff.exchange(body.code(), body.codeVerifier()), mode, response);
    }

    @PostMapping("/service-token")
    public ResponseEntity<ServiceTokenResponse> issueServiceToken(@Valid @RequestBody ServiceTokenRequest body) {
        IssueServiceTokenUseCase.ServiceToken token = serviceToken.issue(body.clientId(), body.clientSecret(), body.scopes());
        return ResponseEntity.ok().header(HttpHeaders.CACHE_CONTROL, "no-store")
                .body(new ServiceTokenResponse(token.accessToken(), "Bearer", token.expiresIn(), token.scopes()));
    }

    /** Out of phase 1: MCP tokens are not issued yet. */
    @PostMapping("/mcp-tokens")
    public ResponseEntity<Void> createMcpToken() {
        throw Errors.featureDisabled();
    }

    @DeleteMapping("/mcp-tokens/{tokenId}")
    public ResponseEntity<Void> revokeMcpToken(@PathVariable UUID tokenId) {
        throw Errors.featureDisabled();
    }

    private ResponseEntity<AuthTokensResponse> tokens(Session session, ClientMode mode, HttpServletResponse response) {
        ResponseEntity.BodyBuilder builder = ResponseEntity.ok().header(HttpHeaders.CACHE_CONTROL, "no-store");
        if (mode.usesCookie()) {
            builder.header(HttpHeaders.SET_COOKIE,
                    cookie(mode, session.refreshToken(), Duration.ofSeconds(session.refreshExpiresIn())).toString());
        }
        return builder.body(AuthTokensResponse.from(session, !mode.usesCookie()));
    }

    private ResponseCookie cookie(ClientMode mode, String value, Duration maxAge) {
        return ResponseCookie.from(mode.cookieName(), value).httpOnly(true).secure(settings.cookieSecure())
                .sameSite("Strict").path("/api/v1/auth").maxAge(maxAge).build();
    }

    private String presentedToken(RefreshTokenRequest body, ClientMode mode, HttpServletRequest request) {
        if (body != null && body.refreshToken() != null && !body.refreshToken().isBlank()) return body.refreshToken();
        if (mode.usesCookie()) {
            checkOrigin(request);
            Cookie[] cookies = request.getCookies();
            if (cookies != null) {
                String name = mode.cookieName();
                return Arrays.stream(cookies).filter(c -> c.getName().equals(name)).map(Cookie::getValue)
                        .filter(v -> !v.isBlank()).findFirst().orElseThrow(Errors::invalidRefreshToken);
            }
        }
        throw Errors.invalidRefreshToken();
    }

    /** CSRF defence for cookie-based refresh/logout: Origin, when present, must be an allowed origin. */
    private void checkOrigin(HttpServletRequest request) {
        String origin = request.getHeader("Origin");
        if (origin == null || settings.allowedOrigins().isEmpty()) return;
        boolean allowed = settings.allowedOrigins().stream().anyMatch(o -> matches(o, origin));
        if (!allowed) throw new DomainException(DomainException.Kind.FORBIDDEN, "FORBIDDEN");
    }

    private static boolean matches(String pattern, String origin) {
        if (pattern.equals(origin)) return true;
        if (!pattern.contains("*")) return false;
        String regex = java.util.regex.Pattern.quote(pattern).replace("*", "\\E[^/]*\\Q");
        return origin.matches(regex);
    }
}
