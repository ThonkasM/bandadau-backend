package com.bandadau.identity.adapter.out.external;

import com.bandadau.identity.application.port.out.VerificationCodeSenderPort;
import com.bandadau.identity.domain.model.Email;
import com.bandadau.identity.domain.model.Language;
import java.util.Locale;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.MessageSource;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;

/** Sends the verification email over SMTP (Mailpit in dev); in dev the code is also written to the log. */
public class SmtpVerificationCodeSenderAdapter implements VerificationCodeSenderPort {
    private static final Logger log = LoggerFactory.getLogger(SmtpVerificationCodeSenderAdapter.class);

    private final JavaMailSender mail;
    private final MessageSource messages;
    private final String from;
    private final boolean logCode;

    public SmtpVerificationCodeSenderAdapter(JavaMailSender mail, MessageSource messages, String from, boolean logCode) {
        this.mail = mail;
        this.messages = messages;
        this.from = from;
        this.logCode = logCode;
    }

    @Override
    public void sendCode(Email to, String code, Language language) {
        if (logCode) log.info("event=auth.verification_code.dev email={} code={}", to.value(), code);
        Locale locale = Locale.forLanguageTag(language.code());
        send(to, messages.getMessage("mail.verification.subject", null, locale),
                messages.getMessage("mail.verification.body", new Object[] {code}, locale));
    }

    @Override
    public void sendExistingAccountNotice(Email to, Language language) {
        Locale locale = Locale.forLanguageTag(language.code());
        send(to, messages.getMessage("mail.existing.subject", null, locale),
                messages.getMessage("mail.existing.body", null, locale));
    }

    private void send(Email to, String subject, String body) {
        SimpleMailMessage message = new SimpleMailMessage();
        message.setFrom(from);
        message.setTo(to.value());
        message.setSubject(subject);
        message.setText(body);
        long backoff = 200;
        for (int attempt = 1; attempt <= 3; attempt++) {
            try {
                mail.send(message);
                return;
            } catch (RuntimeException e) {
                log.warn("event=mail.send.failed attempt={} error={}", attempt, e.getClass().getSimpleName());
                if (attempt == 3) return;
                try {
                    Thread.sleep(backoff);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    return;
                }
                backoff *= 5;
            }
        }
    }
}
