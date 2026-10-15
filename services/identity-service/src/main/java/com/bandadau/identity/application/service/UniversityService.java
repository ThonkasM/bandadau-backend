package com.bandadau.identity.application.service;

import com.bandadau.identity.application.port.in.ListUniversitiesUseCase;
import com.bandadau.identity.application.port.in.ManageUniversitiesUseCase;
import com.bandadau.identity.application.port.in.Page;
import com.bandadau.identity.application.port.out.IdGeneratorPort;
import com.bandadau.identity.application.port.out.TransactionPort;
import com.bandadau.identity.application.port.out.UniversityRepositoryPort;
import com.bandadau.identity.domain.exception.Errors;
import com.bandadau.identity.domain.model.University;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

public final class UniversityService implements ListUniversitiesUseCase, ManageUniversitiesUseCase {
    private final UniversityRepositoryPort universities;
    private final IdGeneratorPort ids;
    private final TransactionPort tx;

    public UniversityService(UniversityRepositoryPort universities, IdGeneratorPort ids, TransactionPort tx) {
        this.universities = universities;
        this.ids = ids;
        this.tx = tx;
    }

    @Override
    public Page<University> listEnabled(String cursor, int limit) {
        return universities.listEnabled(cursor, limit);
    }

    @Override
    public University create(String name, List<String> allowedDomains) {
        List<String> domains = normalize(allowedDomains);
        return tx.inTransaction(() -> {
            checkDomains(domains, null);
            University university = new University(ids.newId(), name.trim(), domains, true);
            universities.insert(university);
            return university;
        });
    }

    @Override
    public University update(UUID universityId, String name, List<String> allowedDomains, Boolean enabled) {
        List<String> domains = allowedDomains == null ? null : normalize(allowedDomains);
        return tx.inTransaction(() -> {
            University current = universities.findById(universityId).orElseThrow(Errors::universityMissing);
            if (domains != null) checkDomains(domains, universityId);
            University updated = current.with(name == null ? null : name.trim(), domains, enabled);
            universities.update(updated);
            return updated;
        });
    }

    private void checkDomains(List<String> domains, UUID self) {
        List<String> taken = universities.domainsTakenByOthers(domains, self);
        if (!taken.isEmpty()) throw Errors.universityDomainTaken(taken.get(0));
    }

    private static List<String> normalize(List<String> domains) {
        return domains.stream().map(d -> d.trim().toLowerCase(Locale.ROOT)).distinct().toList();
    }
}
