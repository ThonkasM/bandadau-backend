package com.bandadau.identity.domain.model;

import com.bandadau.identity.domain.exception.Errors;
import java.time.Instant;
import java.util.EnumSet;
import java.util.Set;
import java.util.UUID;

public final class User {
    private final UUID id;
    private final Email email;
    private final UUID universityId;
    private UserStatus status;
    private Set<Role> roles;
    private Language language;
    private ThemePreference theme;
    private Instant emailVerifiedAt;
    private String suspendedReason;
    private final Instant createdAt;
    private Instant updatedAt;
    private long version;

    public User(UUID id, Email email, UUID universityId, UserStatus status, Set<Role> roles, Language language,
                ThemePreference theme, Instant emailVerifiedAt, String suspendedReason, Instant createdAt,
                Instant updatedAt, long version) {
        this.id = id;
        this.email = email;
        this.universityId = universityId;
        this.status = status;
        this.roles = EnumSet.copyOf(roles);
        this.language = language;
        this.theme = theme;
        this.emailVerifiedAt = emailVerifiedAt;
        this.suspendedReason = suspendedReason;
        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
        this.version = version;
    }

    /** RN-01.7: the initial role is always STUDENT. */
    public static User register(UUID id, Email email, UUID universityId, Language language, Instant now) {
        return new User(id, email, universityId, UserStatus.PENDING_VERIFICATION, EnumSet.of(Role.STUDENT), language,
                ThemePreference.SYSTEM, null, null, now, now, 0);
    }

    public void verifyEmail(Instant now) {
        if (status != UserStatus.PENDING_VERIFICATION) throw Errors.emailAlreadyVerified();
        status = UserStatus.ACTIVE;
        emailVerifiedAt = now;
        updatedAt = now;
    }

    public Set<Role> changeRoles(Set<Role> newRoles, Instant now) {
        Set<Role> previous = EnumSet.copyOf(roles);
        roles = EnumSet.copyOf(newRoles);
        updatedAt = now;
        return previous;
    }

    /** @return true when the status changed. */
    public boolean suspend(String reason, Instant now) {
        if (status == UserStatus.SUSPENDED) return false;
        if (status != UserStatus.ACTIVE) throw Errors.invalidStatusTransition(status.name(), UserStatus.SUSPENDED.name());
        status = UserStatus.SUSPENDED;
        suspendedReason = reason;
        updatedAt = now;
        return true;
    }

    /** @return true when the status changed. */
    public boolean reactivate(Instant now) {
        if (status == UserStatus.ACTIVE) return false;
        if (status != UserStatus.SUSPENDED) throw Errors.invalidStatusTransition(status.name(), UserStatus.ACTIVE.name());
        status = UserStatus.ACTIVE;
        suspendedReason = null;
        updatedAt = now;
        return true;
    }

    /** @return true when something changed. */
    public boolean updatePreferences(Language newLanguage, ThemePreference newTheme, Instant now) {
        boolean changed = false;
        if (newLanguage != null && newLanguage != language) { language = newLanguage; changed = true; }
        if (newTheme != null && newTheme != theme) { theme = newTheme; changed = true; }
        if (changed) updatedAt = now;
        return changed;
    }

    public boolean canAccess(TargetApp target) {
        return switch (target) {
            case APP -> true;
            case ADMIN -> roles.contains(Role.MODERATOR) || roles.contains(Role.ADMIN);
        };
    }

    public boolean isActive() { return status == UserStatus.ACTIVE; }

    public UUID id() { return id; }
    public Email email() { return email; }
    public UUID universityId() { return universityId; }
    public UserStatus status() { return status; }
    public Set<Role> roles() { return Set.copyOf(roles); }
    public Language language() { return language; }
    public ThemePreference theme() { return theme; }
    public Instant emailVerifiedAt() { return emailVerifiedAt; }
    public String suspendedReason() { return suspendedReason; }
    public Instant createdAt() { return createdAt; }
    public Instant updatedAt() { return updatedAt; }
    public long version() { return version; }
}
