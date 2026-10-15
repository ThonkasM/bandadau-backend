package com.bandadau.events.application.port;

import java.util.function.Supplier;

public interface TransactionRunner {
    <T> T run(Supplier<T> work);

    default void runVoid(Runnable work) {
        run(() -> {
            work.run();
            return null;
        });
    }
}
