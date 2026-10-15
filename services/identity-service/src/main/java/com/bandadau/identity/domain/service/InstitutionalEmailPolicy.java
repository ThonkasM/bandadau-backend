package com.bandadau.identity.domain.service;

import com.bandadau.identity.domain.exception.Errors;
import com.bandadau.identity.domain.model.Email;
import com.bandadau.identity.domain.model.University;

/** The email must belong to an enabled university that allows its domain. */
public final class InstitutionalEmailPolicy {
    private InstitutionalEmailPolicy() { }

    public static void ensureAllowed(University university, Email email) {
        if (!university.enabled() || !university.allows(email)) throw Errors.emailDomainNotAllowed(email.domain());
    }
}
