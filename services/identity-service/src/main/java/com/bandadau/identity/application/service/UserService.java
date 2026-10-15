package com.bandadau.identity.application.service;

import com.bandadau.identity.application.port.in.GetJwksUseCase;
import com.bandadau.identity.application.port.in.GetUserUseCase;
import com.bandadau.identity.application.port.in.UpdatePreferencesUseCase;
import com.bandadau.identity.application.port.out.*;
import com.bandadau.identity.domain.event.UserPreferencesChanged;
import com.bandadau.identity.domain.exception.Errors;
import com.bandadau.identity.domain.model.Language;
import com.bandadau.identity.domain.model.ThemePreference;
import com.bandadau.identity.domain.model.User;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public final class UserService implements GetUserUseCase, UpdatePreferencesUseCase, GetJwksUseCase {
    private final UserRepositoryPort users;
    private final EventPublisherPort events;
    private final TokenIssuerPort tokens;
    private final ClockPort clock;
    private final TransactionPort tx;

    public UserService(UserRepositoryPort users, EventPublisherPort events, TokenIssuerPort tokens, ClockPort clock,
                       TransactionPort tx) {
        this.users = users;
        this.events = events;
        this.tokens = tokens;
        this.clock = clock;
        this.tx = tx;
    }

    @Override
    public User get(UUID userId) {
        return users.findById(userId).orElseThrow(Errors::userNotFound);
    }

    @Override
    public User update(UUID userId, Language language, ThemePreference theme) {
        return tx.inTransaction(() -> {
            User user = users.findById(userId).orElseThrow(Errors::userNotFound);
            Instant now = clock.now();
            if (user.updatePreferences(language, theme, now)) {
                users.update(user);
                events.publish(new UserPreferencesChanged(user.id(), user.language(), user.theme(), now));
                return users.findById(userId).orElseThrow(Errors::userNotFound);
            }
            return user;
        });
    }

    @Override
    public List<Map<String, Object>> publicKeys() {
        return tokens.publicKeys();
    }
}
