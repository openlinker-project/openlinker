/**
 * Raised by the accept/edit endpoints' staleness guard (#3145): the caller's
 * `expectedVersion` (the episode's `refreshedAt ?? detectedAt`, ISO string —
 * see `PriceChangesService.versionOf`) does not match the episode's CURRENT
 * version, meaning a re-detection landed after the caller last read this
 * episode (the review queue's `row-needs-refresh` state). Applying anyway
 * would publish a price the operator never actually reviewed.
 */
export class PriceChangeEpisodeStaleException extends Error {
  constructor(
    public readonly episodeId: string,
    public readonly expectedVersion: string,
    public readonly currentVersion: string
  ) {
    super(
      `Price change episode ${episodeId} changed since it was last read (expected version ${expectedVersion}, current ${currentVersion})`
    );
    this.name = 'PriceChangeEpisodeStaleException';
    Error.captureStackTrace(this, this.constructor);
  }
}
