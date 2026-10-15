package com.bandadau.identity.domain.service;

import com.bandadau.identity.domain.model.Email;

/** RN-01.3: at least 10 characters and different from the email. */
public final class PasswordPolicy {
    public static final int MIN_LENGTH = 10;

    private PasswordPolicy() { }

    public static boolean isAcceptable(String password, Email email) {
        if (password == null || password.length() < MIN_LENGTH) return false;
        return !password.equalsIgnoreCase(email.value()) && !password.equalsIgnoreCase(email.localPart());
    }
}
