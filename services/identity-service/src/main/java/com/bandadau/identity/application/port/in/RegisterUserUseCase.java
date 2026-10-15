package com.bandadau.identity.application.port.in;

import com.bandadau.identity.domain.model.Language;
import com.bandadau.identity.domain.model.UserStatus;
import java.util.UUID;

public interface RegisterUserUseCase {

    RegisteredUser register(RegisterUserCommand command);

    record RegisterUserCommand(String email, String password, UUID universityId, Language language) { }

    record RegisteredUser(UUID userId, String email, UserStatus status, long verificationExpiresIn) { }
}
