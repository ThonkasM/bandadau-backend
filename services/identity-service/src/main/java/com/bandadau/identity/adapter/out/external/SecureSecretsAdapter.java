package com.bandadau.identity.adapter.out.external;

import com.bandadau.identity.application.port.out.SecretsPort;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;

public class SecureSecretsAdapter implements SecretsPort {
    private final SecureRandom random = new SecureRandom();

    @Override
    public String sixDigitCode() {
        return String.format("%06d", random.nextInt(1_000_000));
    }

    @Override
    public String opaqueToken(String prefix, int bytes) {
        byte[] buffer = new byte[bytes];
        random.nextBytes(buffer);
        return prefix + Base64.getUrlEncoder().withoutPadding().encodeToString(buffer);
    }

    @Override
    public String sha256Hex(String value) {
        return HexFormat.of().formatHex(sha256(value.getBytes(StandardCharsets.UTF_8)));
    }

    @Override
    public String pkceS256(String verifier) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(sha256(verifier.getBytes(StandardCharsets.US_ASCII)));
    }

    @Override
    public boolean constantTimeEquals(String a, String b) {
        return MessageDigest.isEqual(a.getBytes(StandardCharsets.UTF_8), b.getBytes(StandardCharsets.UTF_8));
    }

    private static byte[] sha256(byte[] input) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(input);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
