package com.bandadau.identity.application.port.in;

public interface ResendVerificationCodeUseCase {
    void resend(String email);
}
