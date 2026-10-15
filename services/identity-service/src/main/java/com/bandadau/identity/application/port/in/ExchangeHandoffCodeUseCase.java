package com.bandadau.identity.application.port.in;

public interface ExchangeHandoffCodeUseCase {
    Session exchange(String code, String codeVerifier);
}
