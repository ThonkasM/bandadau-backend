package com.bandadau.identity.application.port.in;

import java.util.UUID;

public interface LogoutUseCase {
    void logout(UUID userId, String refreshToken);
}
