package com.bandadau.identity.application.port.in;

import com.bandadau.identity.domain.model.University;
import java.util.List;
import java.util.UUID;

public interface ManageUniversitiesUseCase {

    University create(String name, List<String> allowedDomains);

    /** Only non-null arguments are changed. */
    University update(UUID universityId, String name, List<String> allowedDomains, Boolean enabled);
}
