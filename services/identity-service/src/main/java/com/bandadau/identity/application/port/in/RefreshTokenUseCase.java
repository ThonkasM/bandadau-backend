package com.bandadau.identity.application.port.in;

public interface RefreshTokenUseCase {
    Session refresh(String refreshToken);
}
