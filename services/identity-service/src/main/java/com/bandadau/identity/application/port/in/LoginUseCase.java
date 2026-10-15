package com.bandadau.identity.application.port.in;

import com.bandadau.identity.domain.model.TargetApp;

public interface LoginUseCase {
    Session login(String email, String password, TargetApp client);
}
