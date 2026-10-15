package com.bandadau.identity.application.port.in;

import com.bandadau.identity.domain.model.Language;
import com.bandadau.identity.domain.model.ThemePreference;
import com.bandadau.identity.domain.model.User;
import java.util.UUID;

public interface UpdatePreferencesUseCase {
    User update(UUID userId, Language language, ThemePreference theme);
}
