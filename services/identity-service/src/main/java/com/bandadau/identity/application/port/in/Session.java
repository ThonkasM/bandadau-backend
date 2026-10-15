package com.bandadau.identity.application.port.in;

import com.bandadau.identity.domain.model.User;

public record Session(String accessToken, String refreshToken, long expiresIn, long refreshExpiresIn, User user) {
}
