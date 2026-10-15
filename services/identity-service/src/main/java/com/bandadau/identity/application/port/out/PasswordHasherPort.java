package com.bandadau.identity.application.port.out;

public interface PasswordHasherPort {
    String hash(String rawPassword);

    boolean matches(String rawPassword, String hash);

    /** Burns the same CPU as {@link #matches} so unknown accounts are not distinguishable by timing. */
    void burn(String rawPassword);
}
