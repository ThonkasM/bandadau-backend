package com.bandadau.identity.adapter.in.web.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/** Request bodies of the identity API (names mirror the OpenAPI schemas). */
public final class Requests {
    private Requests() { }

    public record RegisterUserRequest(
            @NotBlank @Size(max = 254) @Email String email,
            @NotBlank @Size(min = 8, max = 128) String password,
            @NotNull UUID universityId,
            @Pattern(regexp = "es|en") String locale) { }

    public record VerifyEmailRequest(
            @NotBlank @Size(max = 254) @Email String email,
            @NotBlank @Pattern(regexp = "^[0-9]{6}$") String code) { }

    public record ResendVerificationCodeRequest(@NotBlank @Size(max = 254) @Email String email) { }

    public record LoginRequest(
            @NotBlank @Size(max = 254) @Email String email,
            @NotBlank @Size(min = 8, max = 128) String password) { }

    /** The token may be absent when the client keeps it in the HttpOnly cookie. */
    public record RefreshTokenRequest(@Size(min = 16, max = 512) String refreshToken) { }

    public record CreateHandoffCodeRequest(
            @NotNull @Pattern(regexp = "ADMIN|APP") String targetApp,
            @NotBlank @Pattern(regexp = "^[A-Za-z0-9_-]{43,128}$") String codeChallenge,
            @NotNull @Pattern(regexp = "S256") String codeChallengeMethod) { }

    public record ExchangeHandoffCodeRequest(
            @NotBlank @Size(min = 16, max = 256) String code,
            @NotBlank @Pattern(regexp = "^[A-Za-z0-9._~-]{43,128}$") String codeVerifier) { }

    public record ServiceTokenRequest(@NotBlank String clientId, @NotBlank String clientSecret, Set<String> scopes) { }

    public record UpdatePreferencesRequest(@Pattern(regexp = "es|en") String locale,
                                           @Pattern(regexp = "SYSTEM|LIGHT|DARK") String theme) { }

    public record UpdateUserRolesRequest(
            @NotEmpty Set<@Pattern(regexp = "STUDENT|ORGANIZER|MODERATOR|ADMIN") String> roles) { }

    public record UpdateUserStatusRequest(@NotNull @Pattern(regexp = "ACTIVE|SUSPENDED") String status,
                                          @Size(min = 3, max = 500) String reason) { }

    public record CreateUniversityRequest(
            @NotBlank @Size(min = 3, max = 150) String name,
            @NotEmpty List<@Pattern(regexp = Domains.PATTERN) String> allowedDomains) { }

    public record UpdateUniversityRequest(
            @Size(min = 3, max = 150) String name,
            List<@Pattern(regexp = Domains.PATTERN) String> allowedDomains,
            Boolean enabled) { }

    public static final class Domains {
        public static final String PATTERN = "^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,}$";

        private Domains() { }
    }
}
