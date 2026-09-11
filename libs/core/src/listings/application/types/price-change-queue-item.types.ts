/**
 * Price Change Queue Item (#3145)
 *
 * The enriched, review-queue-ready projection of a `PriceChangeEpisode`.
 * Carries everything `docs/plans/mockups/price-changes-review-queue.html`'s
 * `ITEMS` render — the mockup's `buildItem`'s job is done SERVER-SIDE here
 * (`deltaPct`, rounding math already applied by the detection service), so
 * the frontend never re-implements `applyPricingRule`.
 *
 * `ruleSummary` is deliberately STRUCTURED, not a pre-composed sentence —
 * the frontend composes the plain-language copy (mirroring the
 * `stock-and-pricing-preview.ts` browser-side-mirror precedent, since
 * `apps/web` cannot import `@openlinker/core`, #591).
 *
 * @module libs/core/src/listings/application/types
 */
import type {
  PriceChangeBlockReason,
  PriceChangeResolution,
} from '../../domain/types/price-change-episode.types';
import type { PricingRule } from '@openlinker/core/identifier-mapping';

export interface PriceChangeQueueItemRuleSummary {
  type: PricingRule['type'];
  percent: number;
  rounding: NonNullable<PricingRule['rounding']>;
}

export interface PriceChangeQueueItem {
  id: string;
  productVariantId: string;
  productName: string;
  variantLabel: string | null;
  sku: string | null;

  sourceConnectionId: string;
  sourceLabel: string;
  sourceOldAmount: number;
  sourceNewAmount: number;
  sourceCurrency: string;

  destinationConnectionId: string;
  destinationLabel: string;
  /**
   * The DESTINATION's own currency (`readConnectionCurrency`), never the
   * source's (#3162 review — this field previously always fabricated the
   * source's currency, which is wrong exactly on the one row where it
   * matters: a `'currency-mismatch'` `blockReason` is true *because* the two
   * differ). `null` mirrors `'destination-currency-unknown'` — the
   * destination's currency is not configured/resolvable at all.
   */
  destinationCurrency: string | null;

  /**
   * `null` mirrors `PriceChangeEpisode.computedOldAmount` (#3159 — widened
   * onto the entity by a sibling in this stack after this type was first
   * written): a brand-new mapping's first detection has no recorded
   * baseline to diff against.
   */
  computedOldAmount: number | null;
  computedNewAmount: number;
  /** `null` when `computedOldAmount` is `null` — see `PriceChangeEpisode.deltaPct()`. */
  deltaPct: number | null;
  isSteep: boolean;

  ruleSummary: PriceChangeQueueItemRuleSummary;

  blockReason: PriceChangeBlockReason | null;
  /** `true` when a re-detection landed after this episode was opened. */
  needsRefresh: boolean;
  /** The version token the accept/edit staleness guard compares against. */
  version: string;

  manualPriceOverride: number | null;
  resolution: PriceChangeResolution | null;
  resolvedAt: string | null;
  resolvedByUserId: string | null;
  detectedAt: string;
}

export interface PriceChangeQueuePage {
  items: readonly PriceChangeQueueItem[];
  /** Episodes excluded because their variant's offer mapping is stale (#1689). */
  hiddenStaleCount: number;
  /**
   * The total count of open episodes matching the same filters (#3162
   * review — the list read is now paginated; `total` is what lets a caller
   * render "N of M" / drive further pages without hydrating the whole set).
   * A real SQL `COUNT`, from `PriceChangeEpisodeRepositoryPort.countOpen`
   * with the SAME filters as the page — never derived from `items.length`.
   */
  total: number;
}
