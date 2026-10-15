package com.bandadau.identity.application.port.out;

import com.bandadau.identity.domain.model.Email;
import com.bandadau.identity.domain.model.Language;

public interface VerificationCodeSenderPort {
    void sendCode(Email to, String code, Language language);

    void sendExistingAccountNotice(Email to, Language language);
}
