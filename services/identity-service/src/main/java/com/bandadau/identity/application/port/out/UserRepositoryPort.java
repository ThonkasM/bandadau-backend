package com.bandadau.identity.application.port.out;

import com.bandadau.identity.application.port.in.ManageUsersUseCase.UserFilter;
import com.bandadau.identity.application.port.in.Page;
import com.bandadau.identity.domain.model.Email;
import com.bandadau.identity.domain.model.Role;
import com.bandadau.identity.domain.model.User;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

public interface UserRepositoryPort {
    Optional<User> findById(UUID id);

    Optional<User> findByEmail(Email email);

    /** @throws com.bandadau.identity.domain.exception.DomainException EMAIL_ALREADY_REGISTERED on duplicates. */
    void insert(User user);

    /** Optimistic update; throws CONCURRENT_MODIFICATION when the version changed. */
    void update(User user);

    boolean existsOtherAdmin(UUID excludedUserId);

    void recordRoleChange(UUID userId, UUID actorId, Set<Role> oldRoles, Set<Role> newRoles);

    Page<User> search(UserFilter filter, String cursor, int limit);
}
