package com.bandadau.identity.application.port.out;

public interface SecretsPort {
    String sixDigitCode();

    /** {@code prefix + base64url(random bytes)}. */
    String opaqueToken(String prefix, int bytes);

    String sha256Hex(String value);

    /** BASE64URL(SHA256(verifier)) without padding (RFC 7636 S256). */
    String pkceS256(String verifier);

    boolean constantTimeEquals(String a, String b);
}
