package com.bandadau.identity.adapter.out.persistence;

import com.bandadau.identity.application.port.out.TransactionPort;
import java.util.function.Supplier;
import org.springframework.transaction.support.TransactionTemplate;

public class SpringTransactionAdapter implements TransactionPort {
    private final TransactionTemplate template;

    public SpringTransactionAdapter(TransactionTemplate template) {
        this.template = template;
    }

    @Override
    public <T> T inTransaction(Supplier<T> work) {
        return template.execute(status -> work.get());
    }
}
