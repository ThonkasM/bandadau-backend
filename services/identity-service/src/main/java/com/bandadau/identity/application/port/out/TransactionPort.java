package com.bandadau.identity.application.port.out;

import java.util.function.Supplier;

public interface TransactionPort {
    <T> T inTransaction(Supplier<T> work);

    default void inTransaction(Runnable work) {
        inTransaction(() -> {
            work.run();
            return null;
        });
    }
}
