package com.bandadau.identity.application.service;

import com.bandadau.identity.application.port.in.ManageUsersUseCase;
import com.bandadau.identity.application.port.in.Page;
import com.bandadau.identity.application.port.out.*;
import com.bandadau.identity.domain.event.UserReactivated;
import com.bandadau.identity.domain.event.UserRoleChanged;
import com.bandadau.identity.domain.event.UserSuspended;
import com.bandadau.identity.domain.exception.Errors;
import com.bandadau.identity.domain.model.Role;
import com.bandadau.identity.domain.model.User;
import com.bandadau.identity.domain.model.UserStatus;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;

public final class ManageUsersService implements ManageUsersUseCase {
    private final UserRepositoryPort users;
    private final RefreshTokenRepositoryPort refreshTokens;
    private final EventPublisherPort events;
    private final ClockPort clock;
    private final TransactionPort tx;

    public ManageUsersService(UserRepositoryPort users, RefreshTokenRepositoryPort refreshTokens,
                              EventPublisherPort events, ClockPort clock, TransactionPort tx) {
        this.users = users;
        this.refreshTokens = refreshTokens;
        this.events = events;
        this.clock = clock;
        this.tx = tx;
    }

    @Override
    public Page<User> search(UserFilter filter, String cursor, int limit) {
        return users.search(filter, cursor, limit);
    }

    @Override
    public User updateRoles(UUID userId, Set<Role> roles, UUID actorId) {
        return tx.inTransaction(() -> {
            User user = users.findById(userId).orElseThrow(Errors::userNotFound);
            boolean losesAdmin = user.roles().contains(Role.ADMIN) && !roles.contains(Role.ADMIN);
            if (losesAdmin && !users.existsOtherAdmin(userId)) throw Errors.lastAdmin();
            Instant now = clock.now();
            Set<Role> previous = user.changeRoles(roles, now);
            if (!previous.equals(user.roles())) {
                users.update(user);
                users.recordRoleChange(userId, actorId, previous, user.roles());
                events.publish(new UserRoleChanged(userId, previous, user.roles(), actorId, now));
            }
            return users.findById(userId).orElseThrow(Errors::userNotFound);
        });
    }

    @Override
    public User updateStatus(UUID userId, UserStatus status, String reason, UUID actorId) {
        return tx.inTransaction(() -> {
            User user = users.findById(userId).orElseThrow(Errors::userNotFound);
            Instant now = clock.now();
            switch (status) {
                case SUSPENDED -> {
                    if (user.suspend(reason, now)) {
                        users.update(user);
                        refreshTokens.revokeAllForUser(userId, now);
                        events.publish(new UserSuspended(userId, reason, actorId, now));
                    }
                }
                case ACTIVE -> {
                    if (user.reactivate(now)) {
                        users.update(user);
                        events.publish(new UserReactivated(userId, actorId, now));
                    }
                }
                default -> throw Errors.invalidStatusTransition(user.status().name(), status.name());
            }
            return users.findById(userId).orElseThrow(Errors::userNotFound);
        });
    }
}
