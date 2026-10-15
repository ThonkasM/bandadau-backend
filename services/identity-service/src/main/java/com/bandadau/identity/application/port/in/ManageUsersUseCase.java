package com.bandadau.identity.application.port.in;

import com.bandadau.identity.domain.model.Role;
import com.bandadau.identity.domain.model.User;
import com.bandadau.identity.domain.model.UserStatus;
import java.util.List;
import java.util.Set;
import java.util.UUID;

public interface ManageUsersUseCase {

    Page<User> search(UserFilter filter, String cursor, int limit);

    User updateRoles(UUID userId, Set<Role> roles, UUID actorId);

    User updateStatus(UUID userId, UserStatus status, String reason, UUID actorId);

    record UserFilter(String emailPrefix, UserStatus status, Role role, UUID universityId, List<UUID> ids) { }
}
