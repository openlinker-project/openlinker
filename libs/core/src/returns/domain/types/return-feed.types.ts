/**
 * Return Feed Types
 *
 * The cursor-paged enumeration half of the `ReturnSourceReader` sub-capability —
 * the returns counterpart of the order feed, kept beside the observation it
 * enumerates so the return vocabulary has one home.
 *
 * **There is no event-type union here, deliberately.** A return feed reports
 * that a return EXISTS at the source, not that something happened to it;
 * Allegro's customer-returns listing carries no event vocabulary at all
 * (SPIKE-2289 E2/E3), so inventing one would fabricate semantics no shipped
 * source can honour. Change detection is the single-return re-read
 * (`ReturnSourceReader.getReturn`), not a feed event.
 *
 * Domain-only: no framework dependencies.
 *
 * @module libs/core/src/returns/domain/types
 * @see docs/plans/analysis/SPIKE-2289-allegro-returns-feed.md
 */

import type { MarketplaceCursor } from '@openlinker/core/integrations';

/**
 * Input for listing incremental return-feed items from a return source.
 *
 * Carries no date window and no event filter: a source that must bootstrap from
 * a creation timestamp (Allegro) does so **internally, behind the opaque
 * cursor**, so core never has to know which sources page by id and which by
 * date.
 */
export interface ReturnFeedInput {
  /**
   * Cursor to resume from. Null means "start from the beginning"
   * (adapter-defined).
   */
  fromCursor: MarketplaceCursor | null;

  /**
   * Max items to return.
   */
  limit: number;
}

/**
 * One item in the return feed — a reference, never the return itself.
 */
export interface ReturnFeedItem {
  externalReturnId: string;

  /**
   * The source-native order this return refers to, or `null` when the source
   * reports none. Nullable, **not optional** — orphan returns are first-class
   * (see `IncomingReturn.externalOrderId`).
   */
  externalOrderId: string | null;

  /**
   * When the source reports this item occurred (ISO 8601).
   */
  occurredAt: string;

  /**
   * Stable per-item dedupe key. A consumer that has already processed this key
   * may skip the item.
   *
   * For a source whose feed is the return listing itself this is tautologically
   * the return id (Allegro); the field is kept anyway, for symmetry with the
   * order feed's dedupe contract and so that a source with a real event journal
   * can supply a genuinely distinct key without a contract change.
   */
  eventKey: string;

  /**
   * Untouched source payload for this item, for debugging. Core never branches
   * on it.
   */
  raw?: unknown;
}

/**
 * Output of one return-feed page.
 *
 * Cursor invariants, identical to the order feed's:
 * - `nextCursor` must be monotonic per connection.
 * - `nextCursor = null` means "no cursor advancement possible" (adapter-defined).
 * - A consumer advances the persisted cursor **only after the page has been
 *   persisted** (the #2218 bounded-sweep rule) — a partially-handled page holds
 *   the cursor and retries rather than skipping ids silently.
 * - Termination is an **empty `items` array**, never a count field: no shipped
 *   source reports a reliable total (SPIKE-2289 risk 8), so a consumer that
 *   paged on a count would stop early or loop forever.
 */
export interface ReturnFeedOutput {
  items: ReturnFeedItem[];
  nextCursor: MarketplaceCursor | null;
}
