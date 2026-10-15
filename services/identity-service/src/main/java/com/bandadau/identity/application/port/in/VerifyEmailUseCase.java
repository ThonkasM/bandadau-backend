package com.bandadau.identity.application.port.in;

import com.bandadau.identity.domain.model.TargetApp;

public interface VerifyEmailUseCase {
    Session verify(String email, String code, TargetApp client);
}
