package com.bandadau.identity.application.port.in;

import com.bandadau.identity.domain.model.University;

public interface ListUniversitiesUseCase {
    Page<University> listEnabled(String cursor, int limit);
}
