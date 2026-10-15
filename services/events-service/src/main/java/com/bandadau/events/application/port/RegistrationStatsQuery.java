package com.bandadau.events.application.port;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

public interface RegistrationStatsQuery {

    record Counts(long pending, long confirmed, long failed, long cancelled, long creditsCollected, long creditsRefunded) { }

    record Bucket(String key, String label, Counts counts) { }

    record Stats(LocalDate from, LocalDate to, String groupBy, Counts totals, List<Bucket> series) { }

    Stats stats(LocalDate from, LocalDate to, String groupBy, UUID eventId);
}
