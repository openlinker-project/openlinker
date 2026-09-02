/**
 * Unsupported Availability Scope Error (#2321, ADR-061)
 *
 * Raised when `IAvailabilityService` is asked for a scope it cannot answer for.
 *
 * Wave 1b answers `channel` (the publishing shape — every shipped buffer site
 * asks per destination connection) and `global`. `location`, `order` and `work`
 * are declared arms of `AvailabilityScope` that the computed path has no
 * partitioned read behind yet.
 *
 * **This throws rather than degrading to an unfiltered answer**, which is the
 * decision worth stating: silently ignoring a `location` filter returns a
 * number that is correct on a single-location install and oversells the day a
 * second warehouse appears — a defect that would ship green and surface as lost
 * stock months later. It also throws rather than returning provenance
 * `'unknown'`, because `'unknown'` means "OL asked and could not find out",
 * which callers are built to hold and retry; a scope the seam does not
 * implement is a coding bug in the caller, and dressing it as an outage would
 * send an operator hunting a healthy integration.
 *
 * @module libs/core/src/inventory/domain/exceptions
 * @see docs/architecture/adrs/061-advisory-reservations-and-availability-authority.md
 */
export class UnsupportedAvailabilityScopeError extends Error {
  constructor(public readonly scopeKind: string) {
    super(
      `Availability cannot be resolved for scope kind '${scopeKind}'. ` +
        `The computed path supports 'channel' and 'global' only (#2321); ` +
        `'location', 'order' and 'work' need a partitioned read that does not exist yet.`
    );
    this.name = 'UnsupportedAvailabilityScopeError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, UnsupportedAvailabilityScopeError);
    }
  }
}
