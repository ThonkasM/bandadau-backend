package com.bandadau.identity.application.port.in;

import com.bandadau.identity.domain.model.User;
import java.util.UUID;

public interface GetUserUseCase {
    User get(UUID userId);
}
