/**
 * Needs Attention Row Helpers
 *
 * Pure derivations that turn a `NeedsAttentionSummary` category into the
 * one-line headline + qualifier the mockup's `.attention-list__item` shape
 * expects (docs/plans/implementation-plan-analytics-needs-attention.md,
 * Decisions 1-3). Isolated from the component so the wording can be revised
 * without touching render logic or its tests.
 *
 * Connection-naming rule (Decision 1): when every item in a category shares
 * a single connection (and, for stock, the same buffer), name it explicitly.
 * Otherwise fall back to a connection-agnostic headline - the per-item
 * detail lives behind the row's deep link, not in this summary line.
 *
 * Sample-vs-total rule (#2120 review, BLOCKING): `items` is a preview capped
 * at `DEFAULT_AGGREGATE_LIMIT` (20) while `totalCount` is the true total, so
 * a connection-named headline is only sound when the sample IS the total -
 * `items.length === totalCount`. Otherwise the sampled items may all share
 * one connection/buffer while the un-sampled remainder don't, and naming a
 * channel for a total the sample can't speak for is exactly the false
 * claim-about-your-own-catalogue defect this repo repeatedly refuses to ship
 * (#2075, ADR-041 §54). A partial sample always falls through to the
 * connection-agnostic headline.
 *
 * Currency rule: `FailedSyncValueSummary.totalValue` is never rendered.
 * It carries no currency field in either the mixed or non-mixed case, and a
 * bare number formatted with no currency symbol ("6,120.64 of orders never
 * reached a destination") reads as a real, currency-denominated figure -
 * exactly the false claim this repo's currency-neutral-total precedent
 * exists to avoid making, just less obviously so than the mixed-currency
 * case. `deriveFailedSyncHeadline` therefore always renders the
 * currency-agnostic count, matching what the `mixedCurrency: true` branch
 * already did. `totalValue` stays on the wire (backend keeps computing it -
 * unrelated consumers may still want it) but this headline never reads it.
 *
 * The words live in the `analytics.needsAttention` namespace and are read
 * when a function is called, never at module load (ADR-081).
 *
 * @module apps/web/src/features/analytics/lib
 */
import { formatPlural, getLocale, getMessages, interpolate } from '../../../shared/i18n';
import type {
  CoverageGapItem,
  FailedSyncValueSummary,
  StockAtRiskItem,
} from '../api/needs-attention.types';

export interface AttentionRowCopy {
  headline: string;
  sub: string;
}

/**
 * `deriveCoverageHeadline`'s result additionally reports the ONE connection
 * id the headline named - `null` when it named none (ambiguous items, or a
 * partial sample per the rule above). A caller building a deep link MUST
 * read this field rather than re-deriving its own "single missing
 * connection" predicate: a weaker, independently-computed predicate can
 * pin a `connectionId` into a link that the headline copy right next to it
 * explicitly declined to name (#2120 re-review, IMPORTANT).
 */
export interface CoverageHeadlineResult extends AttentionRowCopy {
  connectionId: string | null;
}

type ConnectionNameResolver = (connectionId: string) => string;

function uniqueValues<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

export function deriveCoverageHeadline(
  items: CoverageGapItem[],
  totalCount: number,
  connectionName: ConnectionNameResolver
): CoverageHeadlineResult {
  const copy = getMessages('analytics').needsAttention.coverage;
  const locale = getLocale();
  const singleMissingConnectionIds = uniqueValues(
    items
      .filter((item) => item.missingFromConnectionIds.length === 1)
      .map((item) => item.missingFromConnectionIds[0])
  );

  const sharesOneMissingConnection =
    items.length > 0 &&
    items.length === totalCount &&
    items.every((item) => item.missingFromConnectionIds.length === 1) &&
    singleMissingConnectionIds.length === 1;

  if (sharesOneMissingConnection) {
    return {
      headline: formatPlural(totalCount, copy.named.headline, locale, {
        connection: connectionName(singleMissingConnectionIds[0]),
      }),
      sub: copy.named.sub,
      connectionId: singleMissingConnectionIds[0],
    };
  }

  return {
    headline: formatPlural(totalCount, copy.generic.headline, locale),
    sub: copy.generic.sub,
    connectionId: null,
  };
}

export function deriveStockHeadline(
  items: StockAtRiskItem[],
  totalCount: number,
  connectionName: ConnectionNameResolver
): AttentionRowCopy {
  const copy = getMessages('analytics').needsAttention.stock;
  const locale = getLocale();
  const connectionIds = uniqueValues(items.map((item) => item.connectionId));
  const buffers = uniqueValues(items.map((item) => item.stockSafetyBuffer));
  const thresholds = uniqueValues(items.map((item) => item.stockZeroThreshold));

  const sharesOneConnectionAndPolicy =
    items.length > 0 &&
    items.length === totalCount &&
    connectionIds.length === 1 &&
    buffers.length === 1 &&
    thresholds.length === 1;

  if (sharesOneConnectionAndPolicy) {
    // Naming the knob that actually silenced the line, since the two are
    // different fixes: raise the master stock, or lower the threshold.
    const sub =
      thresholds[0] > 0
        ? interpolate(copy.named.subWithFloor, { buffer: buffers[0], floor: thresholds[0] })
        : interpolate(copy.named.subBufferOnly, { buffer: buffers[0] });
    return {
      headline: formatPlural(totalCount, copy.named.headline, locale, {
        connection: connectionName(connectionIds[0]),
      }),
      sub,
    };
  }

  return {
    headline: formatPlural(totalCount, copy.generic.headline, locale),
    sub: copy.generic.sub,
  };
}

export function deriveFailedSyncHeadline(summary: FailedSyncValueSummary): AttentionRowCopy {
  const copy = getMessages('analytics').needsAttention.failedSync;

  return {
    headline: formatPlural(summary.count, copy.headline, getLocale()),
    sub: summary.mixedCurrency ? copy.subMixedCurrency : copy.sub,
  };
}
