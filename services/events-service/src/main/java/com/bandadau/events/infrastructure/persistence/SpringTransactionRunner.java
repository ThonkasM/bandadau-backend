package com.bandadau.events.infrastructure.persistence;

import com.bandadau.events.application.port.TransactionRunner;
import java.util.function.Supplier;
import org.springframework.transaction.support.TransactionTemplate;

public class SpringTransactionRunner implements TransactionRunner {
    private final TransactionTemplate template;

    public SpringTransactionRunner(TransactionTemplate template) {
        this.template = template;
    }

    @Override
    public <T> T run(Supplier<T> work) { return template.execute(status -> work.get()); }
}
