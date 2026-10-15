package com.bandadau.identity.application;

import java.time.Duration;

/** Plain settings consumed by the use cases (built from configuration properties in {@code config}). */
public record AuthSettings(Duration accessTtl, Duration refreshTtl, Duration adminRefreshTtl, Duration handoffTtl,
                           Duration verificationTtl, Duration serviceTokenTtl, String appBaseUrl, String adminBaseUrl,
                           boolean hideExistingAccounts) {
}
