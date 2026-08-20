/**
 * Bulk wizard Step 2 - streamed per-variant resolve (#792 / #1741 / #2211)
 *
 * Renders the progress of the NDJSON `categories/resolve-stream` run and turns
 * each variant's outcome into its blocker set. The stream loop itself lives in
 * `use-resolve-stream.ts`; this file is the view plus the per-variant policy
 * (its own EAN x master values x the batch pricing/stock policy).
 *
 * What the operator sees, and why it is shaped this way:
 * - one bar for the whole batch, because that is the only number that answers
 *   "how much longer";
 * - a second bar ONLY for a product with several siblings, because a
 *   single-variant product's bar is either 0% or 100% and a full bar under a
 *   12% batch bar is exactly the "nearly done" misreading this step exists to
 *   remove;
 * - an estimate, which is cheap now that progress is continuous and is the most
 *   useful thing to put on a wait that can run into minutes;
 * - a way out at all times (Back, and Stop-with-what-resolved), because the
 *   streamed path traded a shorter wait for a visible one.
 *
 * Availability is still pulled per chunk, but it is an instant OL-store read and
 * no longer counts as a unit of progress - mixing the two is what made the old
 * counter say "1 of 2" when it meant "0 of 1".
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useQueries } from '@tanstack/react-query';
import { Alert, Button } from '../../../../shared/ui';
import { useApiClient } from '../../../../app/api/api-client-provider';
import { inventoryQueryKeys } from '../../../inventory';
import type { OfferRowValidationInput } from '../../../../shared/plugins';
import type { EanMatchCandidate, EanMatchResult } from '../../api/listings.types';
import {
  computeBlockers,
  effectiveVariantEan,
  imageCountForVariant,
  isValidGtin,
  productCategoryIdOf,
  titleForVariant,
} from './bulk-policy';
import {
  resolveRetryDelay,
  shouldRetryTransient,
  useResolveStream,
  type ResolveItem,
} from './use-resolve-stream';
import type {
  BulkRowBlocker,
  BulkVariantRow,
  BulkWizardRow,
  PricingPolicy,
  StockPolicy,
} from './bulk-wizard.types';

// Re-exported so call sites (and the availability queries below) keep one
// import path for the retry policy the stream loop owns.
export { shouldRetryTransient } from './use-resolve-stream';

/** Per-sibling resolved outcome merged back into `row.variants` (#1741). */
export interface BulkResolveVariantOutcome {
  variantId: string;
  blockers: readonly BulkRowBlocker[];
  resolvedCategoryId: string | null;
  resolvedProductCardId: string | null;
  resolutionMethod: 'auto_detect' | 'category_mapping' | 'manual' | null;
  masterPrice: number | null;
  masterStock: number | null;
  masterCurrency: string | null;
  categoryCandidates: readonly EanMatchCandidate[];
  ean: string | null;
}

export interface BulkResolveOutcome {
  productId: string;
  variants: BulkResolveVariantOutcome[];
}

/**
 * What the step learned about the destination while resolving, reported to the
 * wizard alongside the outcomes.
 *
 * `catalogueLookupPerformed: false` means no destination catalogue was consulted
 * at all, so every `no-match` in that run says nothing about the operator's
 * barcodes and must not gate a row on a missing category. The wizard cannot
 * derive this from the static manifest - a destination that borrows a matcher
 * (#1045) looks identical there - which is the #1934/F10 mistake in reverse.
 */
export interface BulkResolveCompletion {
  catalogueLookupPerformed: boolean;
}

interface BulkResolveStepProps {
  rows: BulkWizardRow[];
  connectionId: string;
  pricingPolicy: PricingPolicy;
  stockPolicy: StockPolicy;
  currency: string;
  platformValidate?: (input: OfferRowValidationInput) => string[];
  destinationResolvesCategoryAtSubmit?: boolean;
  /**
   * Leave the step without resolving. Optional only so the component keeps
   * rendering in isolation; the wizard always supplies it, because a step that
   * can run for a minute with no way back is a trap (#2205 review I7).
   */
  onBack?: () => void;
  onComplete: (outcomes: BulkResolveOutcome[], completion: BulkResolveCompletion) => void;
}

/**
 * Availability read size. Unrelated to the resolve request cap: this bounds one
 * `inventory.availability` query, which is an OL-store read with its own
 * 200-id limit, and it is deliberately smaller so the first stock numbers land
 * early. The resolve stream splits at `RESOLVE_CATEGORY_STREAM_CHUNK_SIZE`,
 * owned by the api module.
 */
const AVAILABILITY_CHUNK_SIZE = 50;
/** How many products the live list keeps on screen at once. */
const RESOLVE_FEED_SIZE = 4;
/**
 * How often the screen-reader region restates progress.
 *
 * The visible counter changes about five times a second, and a `polite` region
 * on it never drains its queue - a screen reader narrates the counter for the
 * whole step and the user hears nothing else. So the counter is NOT a live
 * region; this separate, visually-hidden one is, at a pace a person can follow.
 */
const PROGRESS_ANNOUNCE_INTERVAL_MS = 8000;
/** Below this, an estimate is noise rather than information. */
const ESTIMATE_MIN_RESOLVED = 3;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function sourceCategoriesOf(row: BulkWizardRow): string[] {
  return (row.product?.categories ?? []).filter((c) => typeof c === 'string' && c.trim() !== '');
}

/** "about 40 seconds left" / "about 3 minutes left", never a false precision. */
function formatEstimate(remainingMs: number): string {
  const seconds = Math.max(1, Math.round(remainingMs / 1000));
  if (seconds < 90) {
    return `about ${Math.max(5, Math.round(seconds / 5) * 5)} seconds left`;
  }
  const minutes = Math.round(seconds / 60);
  return `about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} left`;
}

interface ResolveProduct {
  productId: string;
  name: string;
  /** Only the variants this run actually asks the destination about. */
  variantIds: string[];
}

export function BulkResolveStep({
  rows,
  connectionId,
  pricingPolicy,
  stockPolicy,
  currency,
  platformValidate,
  destinationResolvesCategoryAtSubmit,
  onBack,
  onComplete,
}: BulkResolveStepProps): ReactElement {
  const apiClient = useApiClient();

  // Flatten every sibling of every product into a resolve unit.
  const allVariants = useMemo(() => {
    const list: { row: BulkWizardRow; variant: BulkVariantRow }[] = [];
    for (const row of rows) {
      for (const variant of row.variants) {
        list.push({ row, variant });
      }
    }
    return list;
  }, [rows]);

  const allVariantIds = useMemo(() => allVariants.map((x) => x.variant.variantId), [allVariants]);

  const resolveItems = useMemo<ResolveItem[]>(() => {
    return allVariants
      .map(({ row, variant }) => {
        const cats = sourceCategoriesOf(row);
        return {
          variantId: variant.variantId,
          ean: effectiveVariantEan(variant),
          ...(cats.length > 0 ? { sourceCategoryIds: cats } : {}),
        };
      })
      .filter((i) => i.ean !== null || (i.sourceCategoryIds?.length ?? 0) > 0);
  }, [allVariants]);

  /** variantId -> owning product id, for placing each stream event. */
  const productIdByVariantId = useMemo(() => {
    const map = new Map<string, string>();
    for (const { row, variant } of allVariants) {
      map.set(variant.variantId, row.productId);
    }
    return map;
  }, [allVariants]);

  /** Products this run resolves, with only their streamed variants. */
  const resolveProductsById = useMemo(() => {
    const streamed = new Set(resolveItems.map((i) => i.variantId));
    const map = new Map<string, ResolveProduct>();
    for (const { row, variant } of allVariants) {
      if (!streamed.has(variant.variantId)) continue;
      const existing = map.get(row.productId);
      if (existing) {
        existing.variantIds.push(variant.variantId);
      } else {
        map.set(row.productId, {
          productId: row.productId,
          name: row.product?.name ?? row.productId,
          variantIds: [variant.variantId],
        });
      }
    }
    return map;
  }, [allVariants, resolveItems]);

  const availabilityChunks = useMemo(
    () => chunk(allVariantIds, AVAILABILITY_CHUNK_SIZE),
    [allVariantIds],
  );

  // Availability stays a TanStack query: it is an instant OL-store read, not a
  // per-variant marketplace call, and it is deliberately absent from the
  // progress denominator (#2211).
  const availabilityResults = useQueries({
    queries: availabilityChunks.map((ids) => ({
      queryKey: inventoryQueryKeys.availability([...ids]),
      queryFn: () => apiClient.inventory.availability(ids),
      enabled: ids.length > 0,
      retry: shouldRetryTransient,
      retryDelay: resolveRetryDelay,
    })),
  });

  const availabilitySettled = availabilityResults.every((q) => q.isSuccess);
  const availabilityError = availabilityResults.find((q) => q.isError)?.error ?? null;

  const stream = useResolveStream({
    apiClient,
    connectionId,
    resolveItems,
    productIdByVariantId,
  });


  const catalogueLookupPerformed = stream.catalogueLookupPerformed ?? true;
  // A destination that looked nothing up cannot have produced a meaningful
  // `no-match`, so its rows are not gated on a category the wizard was never
  // in a position to resolve.
  const categoryResolvesAtSubmit =
    destinationResolvesCategoryAtSubmit === true || !catalogueLookupPerformed;

  const buildOutcomes = useCallback((): BulkResolveOutcome[] => {
    const categoryByVariant = stream.results;
    const availabilityByVariant = new Map<string, number>();
    for (const q of availabilityResults) {
      for (const item of q.data?.items ?? []) {
        availabilityByVariant.set(item.productVariantId, item.totalAvailable);
      }
    }

    return rows.map((row) => ({
      productId: row.productId,
      variants: row.variants.map((variant) => {
        const isMulti = row.variants.length > 1;
        const ean = effectiveVariantEan(variant);
        const categoryResult: EanMatchResult =
          categoryByVariant[variant.variantId] ??
          (ean !== null ? { kind: 'no-match' } : { kind: 'no-ean' });
        const masterPrice = variant.variant.price;
        const masterCurrency = row.product?.currency ?? null;
        const masterStock = availabilityByVariant.has(variant.variantId)
          ? availabilityByVariant.get(variant.variantId)!
          : null;

        let blockers = computeBlockers({
          hasVariant: true,
          categoryResult,
          pricingPolicy,
          stockPolicy,
          masterPrice,
          masterStock,
          masterCurrency,
          batchCurrency: currency,
          override: variant.override,
          // A category already pinned at the product tier clears the sibling's
          // category blocker (#2240) - the submit inherits it as the family pin.
          productCategoryId: productCategoryIdOf(row),
          imageCount: imageCountForVariant(row, variant),
          effectiveTitle: titleForVariant(row, variant),
          platformValidate,
          destinationResolvesCategoryAtSubmit: categoryResolvesAtSubmit,
        });
        // Master stock is authoritative + read-only for multi-variant siblings
        // (incl. 0 -> out-of-stock, not a create error). Plan §11.
        if (isMulti) blockers = blockers.filter((b) => b !== 'no-master-stock');
        // A supplied-but-invalid barcode is a hard GS1 gate (plan §10.1 / B5) and
        // its own cause since #2240, replacing the downstream category cause so
        // the row carries one explanation rather than two.
        if (ean !== null && !isValidGtin(ean) && !blockers.includes('invalid-barcode')) {
          blockers = [
            ...blockers.filter((b) => b !== 'no-match' && b !== 'no-ean'),
            'invalid-barcode',
          ];
        }

        return {
          variantId: variant.variantId,
          blockers,
          resolvedCategoryId:
            categoryResult.kind === 'matched' ? categoryResult.allegroCategoryId : null,
          resolvedProductCardId:
            categoryResult.kind === 'matched' && categoryResult.productCardId !== ''
              ? categoryResult.productCardId
              : null,
          resolutionMethod:
            categoryResult.kind === 'matched' ? (categoryResult.method ?? 'auto_detect') : null,
          masterPrice,
          masterStock,
          masterCurrency,
          categoryCandidates:
            categoryResult.kind === 'multi-match' ? categoryResult.candidates : [],
          ean,
        };
      }),
    }));
  }, [
    rows,
    stream.results,
    availabilityResults,
    pricingPolicy,
    stockPolicy,
    currency,
    platformValidate,
    categoryResolvesAtSubmit,
  ]);

  const settled = stream.phase === 'done' && availabilitySettled;
  const hasError = stream.phase === 'error' || availabilityError !== null;

  const completedRef = useRef(false);
  useEffect(() => {
    if (completedRef.current || hasError || !settled) return;
    completedRef.current = true;
    onComplete(buildOutcomes(), { catalogueLookupPerformed });
  }, [settled, hasError, buildOutcomes, onComplete, catalogueLookupPerformed]);

  const totalVariants = resolveItems.length;
  const resolvedVariants = Object.keys(stream.results).length;

  const retry = useCallback(() => {
    for (const q of availabilityResults) {
      if (q.isError) void q.refetch();
    }
    stream.retry();
  }, [availabilityResults, stream]);

  /**
   * Ticks once a second while the stream runs, so the estimate ages instead of
   * freezing at whatever the last event implied. Nothing else re-renders on it -
   * every result event already re-renders the component.
   */
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (stream.phase !== 'streaming') return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [stream.phase]);

  /**
   * Progress read by the announcer's interval. Written in an effect rather than
   * listed as a dep, so the interval is not torn down and re-armed on every
   * event - which would stop it ever firing.
   */
  const progressRef = useRef({ resolved: 0, total: 0 });
  useEffect(() => {
    progressRef.current = { resolved: resolvedVariants, total: totalVariants };
  }, [resolvedVariants, totalVariants]);

  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    if (stream.phase === 'done') {
      // The one moment worth announcing immediately.
      setAnnouncement(
        `Resolved ${progressRef.current.resolved} of ${progressRef.current.total} variants.`,
      );
      return;
    }
    if (stream.phase !== 'streaming') return;
    const id = setInterval(() => {
      setAnnouncement(
        `Resolved ${progressRef.current.resolved} of ${progressRef.current.total} variants.`,
      );
    }, PROGRESS_ANNOUNCE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [stream.phase]);

  /**
   * Rate-based estimate from this attempt's own start. Absent until a few
   * variants have landed: the first result carries the whole connection setup,
   * so extrapolating from it overstates the wait by a wide margin.
   */
  const estimate = ((): string | null => {
    if (stream.phase !== 'streaming' || stream.startedAt === null) return null;
    if (resolvedVariants < ESTIMATE_MIN_RESOLVED || resolvedVariants >= totalVariants) return null;
    const elapsed = nowMs - stream.startedAt;
    if (elapsed <= 0) return null;
    return formatEstimate((elapsed / resolvedVariants) * (totalVariants - resolvedVariants));
  })();

  if (hasError) {
    const message =
      stream.errorMessage ??
      (availabilityError instanceof Error ? availabilityError.message : 'Resolution failed.');
    const resolvedSoFar = Object.keys(stream.results).length;
    return (
      // No `role="alert"` on the wrapper: `Alert` carries it, and nesting the
      // two makes several screen readers announce the message twice.
      <div className="bulk-wizard__body--center">
        <Alert tone="error">
          Could not resolve categories and stock for this batch. {message}
        </Alert>
        {resolvedSoFar > 0 ? (
          <p className="bulk-wizard__resolve-sub">
            {resolvedSoFar} of {resolveItems.length} variants already resolved. Retrying picks up
            the remaining ones instead of starting over.
          </p>
        ) : null}
        <div className="bulk-wizard__footer">
          {onBack ? (
            <Button tone="ghost" onClick={onBack}>
              Back
            </Button>
          ) : null}
          <div className="bulk-wizard__footer-spacer" />
          <Button tone="secondary" onClick={retry}>
            Retry resolve
          </Button>
          {/* A batch that lost its last few variants does not need a second full
              wait: an unresolved variant carries a `no-match` into Review, which
              Review already surfaces and lets the operator fix per row. Only
              offered once something did resolve - with nothing resolved there is
              no partial result to continue with. */}
          {resolvedSoFar > 0 ? (
            <Button tone="primary" onClick={stream.stop}>
              Continue with {resolvedSoFar} resolved
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  // Nothing has come back yet. Rendering the bars here would put two tracks at
  // 0% on screen for a destination that terminates immediately (epic #2205
  // decision 4), so the waiting state is its own panel.
  if (stream.eventCount === 0) {
    // Two different situations reach here, and saying the wrong one is worse
    // than saying nothing. Still running: the shimmer plus what is being waited
    // on. Already finished with no results at all (a destination that could
    // borrow no catalogue, epic #2205 decision 4): the previous copy claimed the
    // marketplace catalog was being asked about the first barcode, which never
    // happened.
    const waiting = stream.phase !== 'done';
    const resumed = resolvedVariants > 0;
    return (
      <div className="bulk-wizard__body--center" role="status" aria-live="polite">
        {waiting ? <div className="bulk-wizard__resolve-pending" aria-hidden="true" /> : null}
        <h2 className="bulk-wizard__resolve-title">
          {!waiting
            ? 'Nothing to match against the catalog'
            : totalVariants > 0
              ? `Resolving ${totalVariants} ${totalVariants === 1 ? 'variant' : 'variants'}`
              : 'Pulling master price and stock'}
        </h2>
        <p className="bulk-wizard__resolve-sub">
          {!waiting
            ? 'This destination has no product catalog to match barcodes against, so categories are picked in Review or resolved at submit.'
            : totalVariants === 0
              ? 'No variant in this batch carries a barcode or a source category, so there is nothing to match against the catalog.'
              : resumed
                ? `Picking up where the last attempt stopped: ${resolvedVariants} of ${totalVariants} variants already resolved.`
                : 'Asking the marketplace catalog about the first barcode. Results appear one product at a time as they come back.'}
        </p>
        {waiting && onBack ? (
          <div className="bulk-wizard__footer">
            <Button tone="ghost" onClick={onBack}>
              Back
            </Button>
            <div className="bulk-wizard__footer-spacer" />
          </div>
        ) : null}
      </div>
    );
  }

  const overallPct = totalVariants > 0 ? (resolvedVariants / totalVariants) * 100 : 100;

  const feedProducts = [...stream.touchedProductIds]
    .reverse()
    .slice(0, RESOLVE_FEED_SIZE)
    .map((productId) => {
      const product = resolveProductsById.get(productId);
      const variantIds = product?.variantIds ?? [];
      const done = variantIds.filter((id) => stream.results[id] !== undefined).length;
      const outcome = productOutcome(variantIds, stream.results, done === variantIds.length);
      return {
        productId,
        name: product?.name ?? productId,
        done,
        total: variantIds.length,
        outcome,
      };
    });

  // Only a product still IN FLIGHT, and only one with siblings to count through.
  // No fallback to a finished product: parking a full second bar under a batch
  // bar at 12% is the "nearly done" misreading this step exists to remove, and
  // for a single-variant product the bar can only ever read 0% or 100%.
  const current = feedProducts.find((p) => p.done < p.total && p.total > 1);

  // Products whose every streamed variant has landed. `touchedProductIds`
  // counts products STARTED, which on one line after the word "resolved" reads
  // as products finished - and with multi-variant products it reaches 100%
  // while the variant bar sits at 40%.
  const completedProducts = [...resolveProductsById.values()].filter(
    (product) =>
      product.variantIds.length > 0 &&
      product.variantIds.every((id) => stream.results[id] !== undefined),
  ).length;

  return (
    <div className="bulk-wizard__body--center">
      <h2 className="bulk-wizard__resolve-title">
        Resolving {totalVariants} {totalVariants === 1 ? 'variant' : 'variants'}
      </h2>

      {/* Deliberately NOT a live region - see `PROGRESS_ANNOUNCE_INTERVAL_MS`.
          The visually-hidden region at the end of this panel is. */}
      <div className="bulk-wizard__resolve-track bulk-wizard__resolve-track--batch">
        <p className="bulk-wizard__resolve-track-meta">
          <span>
            {resolvedVariants} of {totalVariants} variants resolved
          </span>
          <span>
            {completedProducts} of {resolveProductsById.size} products done
          </span>
        </p>
        <div
          className="bulk-wizard__progress-bar"
          role="progressbar"
          aria-label="Variants resolved in this batch"
          aria-valuemin={0}
          aria-valuemax={totalVariants}
          aria-valuenow={resolvedVariants}
        >
          <div className="bulk-wizard__progress-fill" style={{ width: `${overallPct}%` }} />
        </div>
      </div>

      {current ? (
        <div className="bulk-wizard__resolve-track">
          <p className="bulk-wizard__resolve-track-meta">
            <span className="bulk-wizard__resolve-track-name">{current.name}</span>
            {/* `done`, not `done + 1`: the label used to count the variant in
                flight while `aria-valuenow` and the fill counted the ones
                finished, so a sighted user read "1 of 3" as a screen reader
                announced "0 of 3". All three now report the same number. */}
            <span>
              {current.done} of {current.total} variants
            </span>
          </p>
          <div
            className="bulk-wizard__progress-bar"
            role="progressbar"
            aria-label={`Variants resolved for ${current.name}`}
            aria-valuemin={0}
            aria-valuemax={current.total}
            aria-valuenow={current.done}
          >
            <div
              className="bulk-wizard__progress-fill bulk-wizard__progress-fill--product"
              style={{ width: `${current.total > 0 ? (current.done / current.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      ) : null}

      <ul className="bulk-progress__list bulk-wizard__resolve-feed">
        {feedProducts.map((product) => {
          const complete = product.done >= product.total;
          const incomplete = complete && product.outcome === 'manual';
          const pct = product.total > 0 ? (product.done / product.total) * 100 : 0;
          const rowClass = [
            'bulk-progress__row',
            !complete ? 'bulk-progress__row--current' : '',
            incomplete ? 'bulk-progress__row--incomplete' : '',
          ]
            .filter(Boolean)
            .join(' ');
          const barClass = ['bulk-progress__bar', incomplete ? 'bulk-progress__bar--warn' : '']
            .filter(Boolean)
            .join(' ');
          return (
            <li key={product.productId} className={rowClass}>
              <div className="bulk-progress__name">
                {product.name}
                <small>
                  variant {product.done} of {product.total}
                </small>
              </div>
              <div className={barClass}>
                <span style={{ width: `${pct}%` }} />
              </div>
              <span
                className={['chip', OUTCOME_CHIP[product.outcome].tone].filter(Boolean).join(' ')}
              >
                {OUTCOME_CHIP[product.outcome].label}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="bulk-wizard__resolve-sub">
        Each variant&apos;s barcode is matched against the marketplace catalog, then per-variant
        master price and stock are pulled. Products that need a category are flagged here so you
        can fix them in Review before submit.
        {estimate !== null ? ` Roughly ${estimate}.` : ''}
      </p>

      {/* The only live region on this panel, restated on a slow interval. The
          counter above changes about five times a second; announcing that would
          fill the queue and drown out everything else on the page. */}
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      <div className="bulk-wizard__footer">
        {onBack ? (
          <Button tone="ghost" onClick={onBack}>
            Back
          </Button>
        ) : null}
        <div className="bulk-wizard__footer-spacer" />
        {/* A minute-long wait needs a way out that keeps the work already paid
            for. Stopping settles the step with what arrived; the rest carry a
            `no-match` into Review, which Review already handles per row. */}
        {stream.phase === 'streaming' && resolvedVariants > 0 ? (
          <Button tone="secondary" onClick={stream.stop}>
            Stop and review {resolvedVariants}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

type ProductResolveOutcome = 'catalogue' | 'mapping' | 'manual' | 'pending';

const OUTCOME_CHIP: Record<ProductResolveOutcome, { tone: string; label: string }> = {
  catalogue: { tone: 'chip--success', label: 'Matched in catalog' },
  mapping: { tone: 'chip--review', label: 'From category mapping' },
  manual: { tone: 'chip--warning', label: 'Needs a category' },
  pending: { tone: '', label: 'Checking barcode' },
};

/**
 * One product's headline outcome. Worst case wins: a single sibling needing a
 * category is what the operator has to act on, so it must not be hidden behind
 * the ones that matched.
 */
function productOutcome(
  variantIds: readonly string[],
  results: Record<string, EanMatchResult>,
  complete: boolean,
): ProductResolveOutcome {
  if (!complete) return 'pending';
  let sawMapping = false;
  for (const variantId of variantIds) {
    const result = results[variantId];
    if (result === undefined || result.kind !== 'matched') return 'manual';
    if (result.method === 'category_mapping') sawMapping = true;
  }
  return sawMapping ? 'mapping' : 'catalogue';
}
