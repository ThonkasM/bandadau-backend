package com.bandadau.identity.adapter.in.web;

import com.bandadau.identity.adapter.in.web.dto.Requests.UpdatePreferencesRequest;
import com.bandadau.identity.adapter.in.web.dto.UserResponse;
import com.bandadau.identity.application.port.in.GetUserUseCase;
import com.bandadau.identity.application.port.in.UpdatePreferencesUseCase;
import com.bandadau.identity.domain.exception.Errors;
import com.bandadau.identity.domain.model.Language;
import com.bandadau.identity.domain.model.ThemePreference;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/users")
public class UserController {
    private final GetUserUseCase getUser;
    private final UpdatePreferencesUseCase updatePreferences;

    public UserController(GetUserUseCase getUser, UpdatePreferencesUseCase updatePreferences) {
        this.getUser = getUser;
        this.updatePreferences = updatePreferences;
    }

    @GetMapping("/me")
    public UserResponse getMe(@AuthenticationPrincipal Jwt jwt) {
        return UserResponse.from(getUser.get(UUID.fromString(jwt.getSubject())));
    }

    @PatchMapping(value = "/me/preferences", consumes = {"application/json", "application/merge-patch+json"})
    public UserResponse updateMyPreferences(@Valid @RequestBody UpdatePreferencesRequest body,
                                            @AuthenticationPrincipal Jwt jwt) {
        if (body.locale() == null && body.theme() == null) throw Errors.validation("locale", "REQUIRED");
        return UserResponse.from(updatePreferences.update(UUID.fromString(jwt.getSubject()),
                body.locale() == null ? null : Language.fromCode(body.locale()),
                body.theme() == null ? null : ThemePreference.valueOf(body.theme())));
    }
}
