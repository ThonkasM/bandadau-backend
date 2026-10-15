package com.bandadau.identity.adapter.out.external;

import com.bandadau.identity.application.port.out.PasswordHasherPort;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;

/** Argon2id with the OWASP parameters of seguridad-y-sso.md (19 MiB, t=2, p=1). */
public class Argon2PasswordHasherAdapter implements PasswordHasherPort {
    private final Argon2PasswordEncoder encoder = new Argon2PasswordEncoder(16, 32, 1, 19456, 2);
    private volatile String dummyHash;

    @Override
    public String hash(String rawPassword) { return encoder.encode(rawPassword); }

    @Override
    public boolean matches(String rawPassword, String hash) { return encoder.matches(rawPassword, hash); }

    @Override
    public void burn(String rawPassword) {
        String dummy = dummyHash;
        if (dummy == null) {
            dummy = encoder.encode("bandada-dummy-password");
            dummyHash = dummy;
        }
        encoder.matches(rawPassword, dummy);
    }
}
