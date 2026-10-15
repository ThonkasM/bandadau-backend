package com.bandadau.identity.domain.exception;

import static com.bandadau.identity.domain.exception.DomainException.Kind.*;

/** Factory of every business error of the identity context (codes match the OpenAPI contract). */
public final class Errors {
    private Errors() { }

    public static DomainException emailDomainNotAllowed(String domain) {
        return new DomainException(UNPROCESSABLE, "EMAIL_DOMAIN_NOT_ALLOWED").with("domain", domain);
    }
    public static DomainException universityNotFound() { return new DomainException(UNPROCESSABLE, "UNIVERSITY_NOT_FOUND"); }
    public static DomainException weakPassword() { return new DomainException(UNPROCESSABLE, "WEAK_PASSWORD"); }
    public static DomainException emailAlreadyRegistered() { return new DomainException(CONFLICT, "EMAIL_ALREADY_REGISTERED"); }
    public static DomainException emailAlreadyVerified() { return new DomainException(CONFLICT, "EMAIL_ALREADY_VERIFIED"); }
    public static DomainException invalidVerificationCode(int remaining) {
        return new DomainException(UNPROCESSABLE, "INVALID_VERIFICATION_CODE").with("remainingAttempts", remaining);
    }
    public static DomainException verificationAttemptsExceeded() { return new DomainException(UNPROCESSABLE, "VERIFICATION_ATTEMPTS_EXCEEDED"); }
    public static DomainException invalidCredentials() { return new DomainException(UNAUTHORIZED, "INVALID_CREDENTIALS"); }
    public static DomainException emailNotVerified() { return new DomainException(FORBIDDEN, "EMAIL_NOT_VERIFIED"); }
    public static DomainException accountSuspended() { return new DomainException(FORBIDDEN, "ACCOUNT_SUSPENDED"); }
    public static DomainException accountSuspendedOnRefresh() { return new DomainException(UNAUTHORIZED, "ACCOUNT_SUSPENDED"); }
    public static DomainException loginLocked(long retryAfterSeconds) {
        return new DomainException(TOO_MANY, "RATE_LIMITED").with("retryAfter", retryAfterSeconds);
    }
    public static DomainException invalidRefreshToken() { return new DomainException(UNAUTHORIZED, "INVALID_REFRESH_TOKEN"); }
    public static DomainException refreshTokenReused() { return new DomainException(UNAUTHORIZED, "REFRESH_TOKEN_REUSED"); }
    public static DomainException handoffCodeInvalid() { return new DomainException(UNAUTHORIZED, "HANDOFF_CODE_INVALID"); }
    public static DomainException handoffTargetForbidden() { return new DomainException(FORBIDDEN, "HANDOFF_TARGET_FORBIDDEN"); }
    public static DomainException adminAccessForbidden() { return new DomainException(FORBIDDEN, "FORBIDDEN"); }
    public static DomainException invalidClient() { return new DomainException(UNAUTHORIZED, "INVALID_CLIENT"); }
    public static DomainException userNotFound() { return new DomainException(NOT_FOUND, "NOT_FOUND").with("resource", "user"); }
    public static DomainException universityMissing() { return new DomainException(NOT_FOUND, "NOT_FOUND").with("resource", "university"); }
    public static DomainException lastAdmin() { return new DomainException(UNPROCESSABLE, "LAST_ADMIN"); }
    public static DomainException invalidStatusTransition(String from, String to) {
        return new DomainException(CONFLICT, "INVALID_STATUS_TRANSITION").with("from", from).with("to", to);
    }
    public static DomainException universityDomainTaken(String domain) {
        return new DomainException(CONFLICT, "UNIVERSITY_DOMAIN_TAKEN").with("domain", domain);
    }
    /** Single-field validation failure rendered as VALIDATION_FAILED with an errors[] entry. */
    public static DomainException validation(String field, String code) {
        return new DomainException(INVALID, "VALIDATION_FAILED")
                .with("errors", java.util.List.of(java.util.Map.of("field", field, "code", code)));
    }
    public static DomainException invalidInput(String code) { return new DomainException(INVALID, code); }
    public static DomainException concurrentModification() { return new DomainException(CONFLICT, "CONCURRENT_MODIFICATION"); }
    public static DomainException featureDisabled() { return new DomainException(NOT_IMPLEMENTED, "FEATURE_DISABLED"); }
}
