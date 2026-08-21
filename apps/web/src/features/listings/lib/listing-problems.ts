/**
 * Listing channel problems (#2231)
 *
 * One place that reads "why can this listing not sell?" off a row, so the row's
 * reason line, the connection banner and the mobile card cannot disagree about
 * which problems belong where.
 *
 * Two rules live here.
 *
 * **Fallback, not assumption.** `validationProblems` is absent on any snapshot
 * written before #2231 and on any response from an older API build. In that case
 * the flat `validationMessages` are read as offer-scoped problems with no code -
 * i.e. the surface renders exactly what it rendered before, rather than going
 * blank.
 *
 * **The scope decides the surface.** An `account`-scoped problem describes the
 * seller's shop on the channel, so the channel reports it against every one of
 * that shop's offers. Rendering it per row would stamp one sentence on every row
 * and bury the single fact worth acting on, so rows drop it entirely and it is
 * rendered once, above the table.
 *
 * @module apps/web/src/features/listings/lib
 */
import type {
  OfferMapping,
  OfferMappingChannelStatus,
  OfferValidationProblem,
} from '../api/listings.types';

/** Every problem the channel reported for this row, whatever shape it arrived in. */
export function readListingProblems(
  status: OfferMappingChannelStatus | undefined
): OfferValidationProblem[] {
  if (!status) return [];
  if (status.validationProblems && status.validationProblems.length > 0) {
    return status.validationProblems;
  }
  return status.validationMessages.map((message) => ({ code: '', message, scope: 'offer' }));
}

/** The problems that belong on the row itself. */
export function readOfferScopedProblems(row: OfferMapping): OfferValidationProblem[] {
  return readListingProblems(row.channelStatus).filter((problem) => problem.scope !== 'account');
}

/** The problems that belong once per connection, above the table. */
export function readAccountScopedProblems(row: OfferMapping): OfferValidationProblem[] {
  return readListingProblems(row.channelStatus).filter((problem) => problem.scope === 'account');
}

/**
 * The one line a problem gets where there is room for one line. Falls back to
 * the full sentence when the channel supplied no short form - a long line that
 * ellipsis-clips still beats an empty slot.
 */
export function problemLine(problem: OfferValidationProblem): string {
  return problem.summary && problem.summary.length > 0 ? problem.summary : problem.message;
}
