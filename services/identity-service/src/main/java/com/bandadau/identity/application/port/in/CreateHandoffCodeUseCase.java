package com.bandadau.identity.application.port.in;

import com.bandadau.identity.domain.model.TargetApp;
import java.util.UUID;

public interface CreateHandoffCodeUseCase {

    HandoffCreated create(UUID userId, TargetApp targetApp, String codeChallenge, String createdIp);

    record HandoffCreated(String code, String redirectUrl, long expiresIn) { }
}
