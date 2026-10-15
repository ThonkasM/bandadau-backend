package com.bandadau.identity.application.port.out;

import com.bandadau.identity.application.port.in.Page;
import com.bandadau.identity.domain.model.University;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface UniversityRepositoryPort {
    Optional<University> findById(UUID id);

    /** @throws com.bandadau.identity.domain.exception.DomainException UNIVERSITY_DOMAIN_TAKEN. */
    void insert(University university);

    void update(University university);

    Page<University> listEnabled(String cursor, int limit);

    List<String> domainsTakenByOthers(List<String> domains, UUID universityId);
}
