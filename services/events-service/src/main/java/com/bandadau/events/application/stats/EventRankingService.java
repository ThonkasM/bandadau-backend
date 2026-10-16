package com.bandadau.events.application.stats;

import com.bandadau.events.application.port.EventRankingQuery;
import com.bandadau.events.application.port.EventRankingQuery.Metric;
import com.bandadau.events.application.port.EventRankingQuery.Row;
import com.bandadau.events.domain.shared.Errors;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

/** getEventRanking: validates the request and delegates to the read model. */
public class EventRankingService {
    public static final int DEFAULT_LIMIT = 5;
    public static final int MAX_LIMIT = 50;
    public static final int MAX_IDS = 50;
    static final int MAX_RANGE_DAYS = 366;

    private final EventRankingQuery query;

    public EventRankingService(EventRankingQuery query) {
        this.query = query;
    }

    public List<Row> rank(LocalDate from, LocalDate to, Metric metric, List<UUID> ids, Integer limit) {
        if (to.isBefore(from)) throw Errors.validation("to", "INVALID_FORMAT");
        if (ChronoUnit.DAYS.between(from, to) > MAX_RANGE_DAYS) throw Errors.validation("to", "TOO_LARGE");
        List<UUID> filter = ids == null || ids.isEmpty() ? null : List.copyOf(ids);
        if (filter != null && filter.size() > MAX_IDS) throw Errors.validation("ids", "TOO_LARGE");
        int max = limit == null ? DEFAULT_LIMIT : limit;
        if (max < 1) throw Errors.validation("limit", "TOO_SMALL");
        if (max > MAX_LIMIT) throw Errors.validation("limit", "TOO_LARGE");
        return query.rank(from, to, metric, filter, filter != null ? filter.size() : max);
    }
}
