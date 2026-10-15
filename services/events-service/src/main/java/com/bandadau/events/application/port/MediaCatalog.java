package com.bandadau.events.application.port;

import java.util.Collection;
import java.util.Map;
import java.util.UUID;

/** Anti-corruption port over media-service (getMediaInternal / getMediaUrls). */
public interface MediaCatalog {
    /** @throws com.bandadau.events.domain.shared.DomainException MEDIA_NOT_APPROVED or MEDIA_UNAVAILABLE. */
    void ensureApprovedCover(UUID mediaId, UUID ownerId);

    /** Presigned URLs by media id; ids that cannot be resolved (or any failure) are simply absent. */
    Map<UUID, String> coverUrls(Collection<UUID> mediaIds);
}
