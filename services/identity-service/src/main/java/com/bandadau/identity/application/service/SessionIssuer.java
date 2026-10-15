package com.bandadau.identity.application.service;

import com.bandadau.identity.application.AuthSettings;
import com.bandadau.identity.application.port.in.Session;
import com.bandadau.identity.application.port.out.*;
import com.bandadau.identity.domain.model.RefreshToken;
import com.bandadau.identity.domain.model.TargetApp;
import com.bandadau.identity.domain.model.User;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

/** Creates refresh-token families and access tokens; shared by login, verify, refresh and handoff. */
final class SessionIssuer {
    private final RefreshTokenRepositoryPort refreshTokens;
    private final TokenIssuerPort tokens;
    private final SecretsPort secrets;
    private final IdGeneratorPort ids;
    private final AuthSettings settings;

    SessionIssuer(RefreshTokenRepositoryPort refreshTokens, TokenIssuerPort tokens, SecretsPort secrets,
                  IdGeneratorPort ids, AuthSettings settings) {
        this.refreshTokens = refreshTokens;
        this.tokens = tokens;
        this.secrets = secrets;
        this.ids = ids;
        this.settings = settings;
    }

    Session newFamily(User user, TargetApp client, Instant now) {
        return issue(user, client, ids.newId(), null, now);
    }

    Session rotate(User user, RefreshToken parent, Instant now) {
        return issue(user, parent.client(), parent.familyId(), parent.id(), now);
    }

    private Session issue(User user, TargetApp client, UUID familyId, UUID parentId, Instant now) {
        Duration refreshTtl = client == TargetApp.ADMIN ? settings.adminRefreshTtl() : settings.refreshTtl();
        String refresh = secrets.opaqueToken("rt_", 32);
        refreshTokens.insert(new RefreshToken(ids.newId(), user.id(), familyId, client, secrets.sha256Hex(refresh),
                parentId, now.plus(refreshTtl), null, null, now));
        String access = tokens.issueAccess(user, client, settings.accessTtl());
        return new Session(access, refresh, settings.accessTtl().toSeconds(), refreshTtl.toSeconds(), user);
    }
}
