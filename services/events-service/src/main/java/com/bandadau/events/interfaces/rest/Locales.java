package com.bandadau.events.interfaces.rest;

import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Locale;

/** Accept-Language resolution: only es and en are supported, es is the fallback (D14). */
public final class Locales {
    private Locales() { }

    public static Locale resolve(HttpServletRequest request) {
        String header = request.getHeader("Accept-Language");
        if (header != null && !header.isBlank()) {
            try {
                List<Locale.LanguageRange> ranges = Locale.LanguageRange.parse(header);
                for (Locale.LanguageRange range : ranges) {
                    String lang = range.getRange().toLowerCase(Locale.ROOT);
                    if (lang.equals("es") || lang.startsWith("es-")) return Locale.forLanguageTag("es");
                    if (lang.equals("en") || lang.startsWith("en-")) return Locale.forLanguageTag("en");
                }
            } catch (IllegalArgumentException ignored) {
                // malformed header: fall back to es
            }
        }
        return Locale.forLanguageTag("es");
    }

}
