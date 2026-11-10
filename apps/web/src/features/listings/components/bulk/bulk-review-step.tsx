/**
 * Bulk wizard Step 3 - per-variant Review (#792 / #1741)
 *
 * Expandable product rows -> per-variant sub-rows built on a bespoke aligned
 * CSS grid (`.bulk-review__grid`) shared by the header, the product-main row,
 * and each variant sub-row so sub-rows column-align to the header - which
 * DataTable's single full-width detail panel cannot do. Single-variant / simple
 * products render flat (no expand caret). Each variant shows the exact
 * NEUTRAL_BLOCKER_CHIPS + platform blocker chips as real <button>s (fix chips)
 * whose accessible name carries the variant identity. Product-level include is a
 * tri-state parent (CheckboxCell); per-variant include/exclude drives the
 * submit fan-out + exclusions. Discovery-at-scale: filter box + "only flagged"
 * + "jump to next flagged".
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { StickyActionBar } from '../../../../shared/ui/sticky-action-bar';
import { Link } from 'react-router-dom';
import { interpolate, useFormat, useMessages, usePlural } from '../../../../shared/i18n';
import { Alert, Button, CheckboxCell, Input, ProductThumbnail } from '../../../../shared/ui';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../shared/ui/tooltip';
import { StatusBadge, type StatusBadgeTone } from '../../../../shared/ui';
import type { OfferBatchIssue, OfferBlockerDescriptor } from '../../../../shared/plugins';
import type { Connection } from '../../../connections';
import type { BulkPerProductOverride } from '../../api/bulk-listings.types';
import {
  computeResolvedPrice,
  computeResolvedStock,
  distinguishingLabel,
  duplicateEanVariantIds,
  effectivePricingPolicy,
  effectiveStockPolicy,
  submitCategoryIdOf,
} from './bulk-policy';
import type {
  BulkVariantRow,
  BulkWizardConfig,
  BulkWizardRow,
} from './bulk-wizard.types';
import { BulkEditModal } from './bulk-edit-modal';
import { BulkImageLightbox } from './bulk-image-lightbox';
import { AlreadyListedChip } from '../already-listed-chip';
import type { OfferBlockerField } from '../../../../shared/plugins';
import {
  FALLBACK_CHIP,
  NEUTRAL_BLOCKER_CHIPS,
  describeBlocker,
  gatingBlockers,
  type BlockerCopyContext,
  type ChipDescriptor,
} from './bulk-blockers';
import {
  AttributeRulesPanel,
  type ParameterCoverage,
  type RejectedRuleValue,
} from './attribute-rules-panel';
import type { AttributeProjectionPreview } from '../../hooks/use-attribute-projection-preview';
import type { BundleOfferPreview, BundleOfferPreviewOk } from '../../hooks/use-bundle-offer-preview';
import { BundleComposition } from './bundle-composition';
import {
  listParameterNames,
  summarizeProjection,
  type ProjectionSummary,
} from '../../lib/attribute-projection-summary';
import {
  ReviewCategoryCell,
  describeProductCategory,
  describeVariantCategory,
} from './bulk-review-category-cell';
import { BulkCardCategoryDialog } from './bulk-card-category-dialog';

interface BulkReviewStepProps {
  rows: BulkWizardRow[];
  connection: Connection | null;
  config: BulkWizardConfig;
  paramsResolving: boolean;
  platformBlockerChips: readonly OfferBlockerDescriptor[];
  /** Unmet batch-level platform preconditions (#2240). Empty ⇒ nothing to warn. */
  batchIssues: readonly OfferBatchIssue[];
  canBrowseCategories: boolean;
  batchDeliveryPriceList?: string;
  /** Demo read-only viewer - gates the editor's field edits + "Save all" (#1704). */
  demoReadOnly: boolean;
  /** Variants already published on the destination (#1837) - shown as a soft
   *  "already on {destination}" chip; publishing again creates a duplicate. */
  alreadyListedVariantIds: ReadonlySet<string>;
  /** Destination name for the "already on {name}" chip copy. */
  destinationName: string;
  onSetVariantIncluded: (productId: string, variantId: string, included: boolean) => void;
  onSetProductIncluded: (productId: string, included: boolean) => void;
  onSaveEditor: (
    productId: string,
    baseOverride: BulkPerProductOverride,
    perVariantOverrides: Record<string, BulkPerProductOverride>,
    includedByVariantId: Record<string, boolean>,
    editFormValues: Record<string, unknown>,
  ) => void;
  onApproveAll: () => void;
  onBack: () => void;
  /**
   * What the connection's attribute mappings and rules fill per variant
   * (#3995). Absent for a destination that has no category parameters.
   */
  projection?: AttributeProjectionPreview;
  /**
   * Adopt the catalogue card the resolver set aside in favour of the mapping
   * (#3994). Single-variant products only; absent ⇒ the dialog offers no adopt.
   */
  onUseCardCategory?: (productId: string) => void;
  /** The destination resolves the category itself at submit (borrowed taxonomy). */
  destinationResolvesCategoryAtSubmit?: boolean;
  /**
   * Which variants publish as one product-set offer, and how (#3520). A bundle
   * row shows its composition instead of a variant count and lists at the sets
   * it can make.
   */
  bundles?: BundleOfferPreview;
  /** Sets a bundle's category to the one of its first component's card. */
  onUseBundleCategory?: (productId: string, categoryId: string) => void;
}

/** What every row needs to render its Category cell and open the card dialog (#3994). */
interface CategoryColumn {
  connectionId: string;
  resolvesAtSubmit: boolean;
  onCompareCard: (productId: string, variantId: string) => void;
}

/** Blockers rendered inside the Category cell rather than as a status chip (#3994). */
const CATEGORY_CELL_BLOCKERS: ReadonlySet<string> = new Set(['card-category-differs']);

/** The set-aside catalogue product a row's Category cell should flag, if any (#3994). */
function cardConflict(
  row: BulkWizardRow,
  variant: BulkVariantRow,
  category: CategoryColumn,
): { card: NonNullable<BulkVariantRow['overriddenCard']>; onCompare: () => void } | null {
  if (!variant.overriddenCard || !variant.blockers.includes('card-category-differs')) return null;
  return {
    card: variant.overriddenCard,
    onCompare: () => {
      category.onCompareCard(row.productId, variant.variantId);
    },
  };
}

/**
 * Server-side ceiling shared by the expanded fan-out (`EXPANDED_OFFER_CEILING`,
 * 422) and the `excludedVariantIds` array cap (`@ArrayMaxSize(1000)`, 400).
 * Mirrored here so Review can say so before submit (#1934/F8).
 */
const BULK_SUBMIT_LIMIT = 1000;

/** Products per page in the Review table (keeps a large batch from rendering every row at once). */
const REVIEW_PAGE_SIZE = 20;

/** Map a StatusBadge tone to a `.bulk-chip--{...}` modifier. */
function chipToneClass(tone: StatusBadgeTone): string {
  switch (tone) {
    case 'success':
      return 'bulk-chip--success';
    case 'error':
      return 'bulk-chip--error';
    case 'warning':
    case 'review':
      return 'bulk-chip--warning';
    case 'info':
      return 'bulk-chip--info';
    default:
      return 'bulk-chip--neutral';
  }
}

interface VariantReadiness {
  included: boolean;
  ready: boolean;
}

function variantReadiness(
  v: BulkVariantRow,
  chips: Record<string, ChipDescriptor>,
): VariantReadiness {
  return { included: v.included, ready: v.included && gatingBlockers(v.blockers, chips).length === 0 };
}

/**
 * Values the blocker sentences interpolate (#2240). Assembled at the call site
 * rather than inside `describeBlocker` so the copy module stays pure and free of
 * wizard row types.
 */
function blockerCopyContext(
  row: BulkWizardRow,
  variant: BulkVariantRow,
  destinationName: string,
  config: BulkWizardConfig,
  bundle?: BundleOfferPreviewOk,
): BlockerCopyContext {
  return {
    ...(bundle
      ? {
          bundle: {
            componentsWithProblem: bundle.components
              .filter((component) => component.problems.length > 0)
              .map((component) => ({
                name: component.name,
                codes: component.problems.map((problem) => problem.code),
              })),
          },
        }
      : {}),
    ean: variant.ean,
    destinationName,
    variantCount: row.variants.length,
    batchCurrency: config.currency,
  };
}

export function BulkReviewStep({
  rows,
  connection,
  config,
  paramsResolving,
  platformBlockerChips,
  batchIssues,
  canBrowseCategories,
  batchDeliveryPriceList,
  demoReadOnly,
  alreadyListedVariantIds,
  destinationName,
  onSetVariantIncluded,
  onSetProductIncluded,
  onSaveEditor,
  onApproveAll,
  onBack,
  projection,
  onUseCardCategory,
  destinationResolvesCategoryAtSubmit = false,
  bundles,
  onUseBundleCategory,
}: BulkReviewStepProps): ReactElement {
  const copy = useMessages('listings').bulkReviewStep;
  const plural = usePlural();
  const format = useFormat();
  const blockerChips = useMemo<Record<string, ChipDescriptor>>(() => {
    const merged: Record<string, ChipDescriptor> = { ...NEUTRAL_BLOCKER_CHIPS };
    for (const chip of platformBlockerChips) {
      merged[chip.id] = {
        tone: chip.tone as StatusBadgeTone,
        label: chip.label,
        fixable: true,
        advisory: chip.advisory === true,
      };
    }
    return merged;
  }, [platformBlockerChips]);

  const [filter, setFilter] = useState('');
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [editing, setEditing] = useState<{
    productId: string;
    focusVariantId?: string;
    focusField?: OfferBlockerField;
  } | null>(null);
  const [zoom, setZoom] = useState<{ src: string; name: string } | null>(null);
  // The card-vs-mapping comparison (#3994), keyed by the row it was opened from.
  const [comparing, setComparing] = useState<{ productId: string; variantId: string } | null>(null);
  const categoryColumn = useMemo<CategoryColumn>(
    () => ({
      connectionId: config.connectionId,
      resolvesAtSubmit: destinationResolvesCategoryAtSubmit,
      onCompareCard: (productId, variantId): void => {
        setComparing({ productId, variantId });
      },
    }),
    [config.connectionId, destinationResolvesCategoryAtSubmit],
  );
  const comparingRow = comparing ? rows.find((r) => r.productId === comparing.productId) ?? null : null;
  const comparingVariant =
    comparing && comparingRow
      ? comparingRow.variants.find((v) => v.variantId === comparing.variantId) ?? null
      : null;
  // "Jump to next flagged" cursor + deferred scroll target so the jump can cross
  // pagination boundaries: it advances a cursor through the flagged set, flips to
  // the target's page, then scrolls once that page has rendered (#1741 review #10).
  const [jumpIndex, setJumpIndex] = useState(-1);
  const [pendingScroll, setPendingScroll] = useState<string | null>(null);

  const counts = useMemo(() => countBatch(rows, blockerChips), [rows, blockerChips]);

  // Per-variant reading of the rule preview (#3995), checked against the
  // category each variant submits under NOW - an answer for a category the
  // operator has since changed says nothing about this one.
  const projectionSummaries = useMemo(() => {
    const map = new Map<string, ProjectionSummary>();
    if (!projection) return map;
    for (const row of rows) {
      for (const variant of row.variants) {
        const summary = summarizeProjection(
          projection.byVariant.get(variant.variantId),
          submitCategoryIdOf(row, variant),
        );
        if (summary) map.set(variant.variantId, summary);
      }
    }
    return map;
  }, [projection, rows]);

  // The rules panel's reading of the batch (#3995): per parameter, one segment
  // per checked variant, plus every value the destination will not accept.
  const rulesPanel = useMemo(() => {
    const checked: { productId: string; variantId: string; label: string; summary: ProjectionSummary }[] = [];
    let failedVariantCount = 0;
    for (const row of rows) {
      const productName = row.product?.name ?? 'Product';
      row.variants.forEach((variant, index) => {
        if (!variant.included) return;
        if (projection?.failedVariantIds.has(variant.variantId)) failedVariantCount += 1;
        const summary = projectionSummaries.get(variant.variantId);
        if (!summary) return;
        const label =
          row.variants.length > 1 ? `${productName}, ${distinguishingLabel(variant, index)}` : productName;
        checked.push({ productId: row.productId, variantId: variant.variantId, label, summary });
      });
    }
    const names = new Map<string, string>();
    for (const c of checked) {
      for (const o of c.summary.byParameterId.values()) {
        if (o.source === 'rule' && !names.has(o.parameterId)) names.set(o.parameterId, o.parameterName);
      }
    }
    const coverage: ParameterCoverage[] = Array.from(names, ([parameterId, name]) => ({
      parameterId,
      name,
      segments: checked.map(({ summary }) => {
        const o = summary.byParameterId.get(parameterId);
        if (!o || o.source !== 'rule') return 'none';
        return o.outcome === 'accepted' ? 'filled' : 'rejected';
      }),
    }));
    const rejected: RejectedRuleValue[] = checked.flatMap(({ productId, variantId, label, summary }) =>
      summary.rejected.map((o) => ({
        productId,
        variantId,
        variantLabel: label,
        parameterName: o.parameterName,
        rawValue: o.rawValue,
      })),
    );
    return { coverage, rejected, failedVariantCount, checkedVariantCount: checked.length };
  }, [rows, projection, projectionSummaries]);

  // Batch-wide effective-EAN collision (#1934/F7). `enforceIdentifierRules`
  // server-side throws `DuplicateBatchEanException` -> 400 for the WHOLE
  // request, so this has to gate submit, not merely warn: the operator would
  // otherwise get a rejection naming two variant ids nothing ever flagged.
  // Until now the helper only ever ran on a single row inside the editor,
  // so a cross-product collision was structurally invisible.
  const duplicateEanIds = useMemo(() => duplicateEanVariantIds(rows), [rows]);

  // Two server-side ceilings the wizard never compared against (#1934/F8), so
  // a large apparel catalogue only found out at submit: the post-exclusion
  // fan-out is capped at `EXPANDED_OFFER_CEILING` (422) and `excludedVariantIds`
  // at `@ArrayMaxSize(1000)` (400). Distinct layers, distinct statuses - and
  // both invisible until now, even though Review already counts exactly the
  // numbers they bound. (The 100-product cap IS already mirrored, in the
  // picker.)
  const overExpansionCeiling = counts.includedReady > BULK_SUBMIT_LIMIT;
  const overExclusionCap = counts.excluded > BULK_SUBMIT_LIMIT;

  // A batch-level precondition LOCKS the submit rather than warning (#2240
  // review). It is connection-wide and deterministic - every child job would be
  // rejected - so a banner the operator can read past does not prevent the
  // wasted batch, it explains it afterwards. Unlike a per-row blocker there is
  // nothing to switch off: no subset of this batch can succeed.
  const canApprove =
    counts.includedReady > 0 &&
    counts.includedNeedsAttention === 0 &&
    duplicateEanIds.size === 0 &&
    batchIssues.length === 0 &&
    !overExpansionCeiling &&
    !overExclusionCap &&
    !paramsResolving;

  const filteredRows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return rows.filter((r) => {
      if (needle !== '') {
        const name = (r.product?.name ?? '').toLowerCase();
        const sku = (r.primaryVariant?.sku ?? '').toLowerCase();
        if (!name.includes(needle) && !sku.includes(needle)) return false;
      }
      if (onlyFlagged) {
        return r.variants.some(
          (v) => v.included && gatingBlockers(v.blockers, blockerChips).length > 0,
        );
      }
      return true;
    });
  }, [rows, filter, onlyFlagged, blockerChips]);

  // Client-side pagination so a large batch (50+ products) does not render every
  // expandable product row at once. The filter runs across the whole set, then
  // the current page is sliced out.
  const [page, setPage] = useState(0);
  useEffect(() => {
    setPage(0);
    setJumpIndex(-1);
  }, [filter, onlyFlagged]);
  const total = filteredRows.length;
  const pageCount = Math.max(1, Math.ceil(total / REVIEW_PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = useMemo(
    () => filteredRows.slice(safePage * REVIEW_PAGE_SIZE, (safePage + 1) * REVIEW_PAGE_SIZE),
    [filteredRows, safePage],
  );

  const editingRow = useMemo(
    () => (editing ? rows.find((r) => r.productId === editing.productId) ?? null : null),
    [editing, rows],
  );

  function toggleExpand(productId: string): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  }

  // Scroll to the deferred target once its page has rendered. Depends on
  // `safePage` so a jump that changed the page runs after the new page mounts.
  useEffect(() => {
    if (pendingScroll === null) return;
    const el = document.querySelector(`[data-product-row="${pendingScroll}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setPendingScroll(null);
  }, [pendingScroll, safePage]);

  function jumpToNextFlagged(): void {
    // Flagged rows in current filter/display order, so "next" is relative to the
    // whole list, not just the rendered page.
    const flagged = filteredRows.filter((r) =>
      r.variants.some((v) => v.included && gatingBlockers(v.blockers, blockerChips).length > 0),
    );
    if (flagged.length === 0) return;
    const nextIndex = (jumpIndex + 1) % flagged.length;
    const target = flagged[nextIndex];
    const targetPage = Math.floor(filteredRows.indexOf(target) / REVIEW_PAGE_SIZE);
    setJumpIndex(nextIndex);
    setExpanded((prev) => new Set(prev).add(target.productId));
    setPage(targetPage);
    setPendingScroll(target.productId);
  }

  if (rows.length === 0) {
    return (
      <div className="bulk-wizard__body--center">
        <p>{copy.emptyState.message}</p>
        <Button tone="primary" onClick={onBack}>
          {copy.emptyState.chooseProducts}
        </Button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <header className="bulk-review__header">
        <div className="bulk-review__toolbar">
          <Input
            type="search"
            placeholder={copy.filter.placeholder}
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
            }}
            className="bulk-review__filter"
            aria-label={copy.filter.ariaLabel}
          />
        </div>
      </header>

      <div className="bulk-review__summary bulk-review__summary--chips" role="status">
        <StatusBadge tone="success" withDot data-testid="bulk-summary-ready">
          {copy.summary.ready}: <span className="n">{counts.includedReady}</span>
        </StatusBadge>
        <StatusBadge tone="warning" withDot data-testid="bulk-summary-attn">
          {copy.summary.needAttention}: <span className="n">{counts.includedNeedsAttention}</span>
        </StatusBadge>
        <StatusBadge tone="neutral" withDot data-testid="bulk-summary-excluded">
          {copy.summary.excluded}: <span className="n">{counts.excluded}</span>
        </StatusBadge>
        <label className="ol-toggle" style={{ marginLeft: 'auto' }}>
          <input
            type="checkbox"
            checked={onlyFlagged}
            onChange={(e) => {
              setOnlyFlagged(e.target.checked);
            }}
          />
          <span>{copy.onlyFlagged}</span>
        </label>
      </div>

      {/* Batch-level platform preconditions (#2240). One banner for the whole
          batch, above the readiness line: the fact belongs to the connection,
          so a chip per row would repeat it N times and still not name the fix. */}
      {batchIssues.map((issue) => (
        <Alert
          key={issue.id}
          tone="error"
          title={issue.title}
          action={
            <Link className="button button--sm" to={`/connections/${config.connectionId}`}>
              {copy.openConnectionSettings}
            </Link>
          }
        >
          {issue.detail}
        </Alert>
      ))}

      {projection ? (
        <AttributeRulesPanel
          connectionId={config.connectionId}
          destinationName={destinationName}
          coverage={rulesPanel.coverage}
          checkedVariantCount={rulesPanel.checkedVariantCount}
          rejected={rulesPanel.rejected}
          failedVariantCount={rulesPanel.failedVariantCount}
          onRetry={projection.retry}
          onFix={(productId, variantId) => {
            setEditing({ productId, focusVariantId: variantId, focusField: 'parameters' });
          }}
        />
      ) : null}

      <div
        className={
          counts.includedNeedsAttention === 0 &&
          duplicateEanIds.size === 0 &&
          batchIssues.length === 0
            ? 'bulk-review__banner bulk-review__banner--ok'
            : 'bulk-review__banner'
        }
        role="status"
      >
        {overExpansionCeiling ? (
          <>
            <b>
              {interpolate(copy.banner.overExpansion.title, {
                count: format.number(counts.includedReady),
                limit: format.number(BULK_SUBMIT_LIMIT),
              })}
            </b>{' '}
            {copy.banner.overExpansion.detail}
          </>
        ) : overExclusionCap ? (
          <>
            <b>
              {plural(counts.excluded, copy.banner.overExclusion.title, {
                limit: format.number(BULK_SUBMIT_LIMIT),
              })}
            </b>{' '}
            {copy.banner.overExclusion.detail}
          </>
        ) : duplicateEanIds.size > 0 ? (
          <>
            <b>{plural(duplicateEanIds.size, copy.banner.duplicateEan.title)}</b>{' '}
            {copy.banner.duplicateEan.detail}
          </>
        ) : batchIssues.length > 0 ? (
          <>
            <b>{copy.banner.batchIssue.title}</b> {copy.banner.batchIssue.detail}
          </>
        ) : counts.includedNeedsAttention === 0 ? (
          <>
            <b>{copy.banner.allReady.title}</b>{' '}
            {plural(counts.includedReady, copy.banner.allReady.detail)}
          </>
        ) : (
          <>
            <b>{plural(counts.includedNeedsAttention, copy.banner.needsAttention.title)}</b>{' '}
            {copy.banner.needsAttention.detail}
            <Button tone="secondary" className="button--sm" style={{ marginLeft: 'auto' }} onClick={jumpToNextFlagged}>
              {copy.jumpToNextFlagged}
            </Button>
          </>
        )}
      </div>

      <div className="bulk-review__table bulk-review__table--with-category">
        {/* Header is announced (not aria-hidden) so screen-reader users get the
            column labels for the rows below (#1741 review #9). */}
        <div className="bulk-review__grid bulk-review__head">
          <span className="bulk-review__c-lead" />
          <span>{copy.columns.product}</span>
          <span className="bulk-review__c-cat">{copy.columns.category}</span>
          <span className="bulk-review__c-price">{copy.columns.priceGross}</span>
          <span className="bulk-review__c-stock">{copy.columns.stock}</span>
          <span className="bulk-review__c-status">{copy.columns.status}</span>
          <span className="bulk-review__c-action" />
        </div>

        {pageRows.map((row) => (
          <ProductRow
            key={row.productId}
            row={row}
            config={config}
            chips={blockerChips}
            alreadyListedVariantIds={alreadyListedVariantIds}
            destinationName={destinationName}
            projectionSummaries={projectionSummaries}
            open={expanded.has(row.productId)}
            onToggleExpand={() => {
              toggleExpand(row.productId);
            }}
            onSetVariantIncluded={onSetVariantIncluded}
            onSetProductIncluded={onSetProductIncluded}
            onEdit={(focusVariantId, focusField) => {
              setEditing({ productId: row.productId, focusVariantId, focusField });
            }}
            onZoom={(src, name) => {
              setZoom({ src, name });
            }}
            category={categoryColumn}
            bundle={bundles?.bundles.get(row.variants[0]?.variantId ?? '')}
            onUseBundleCategory={onUseBundleCategory}
          />
        ))}
      </div>

      {total > REVIEW_PAGE_SIZE ? (
        <div className="bulk-review__pager">
          <span className="bulk-review__pager-count">
            {interpolate(copy.pager.showing, {
              from: format.number(safePage * REVIEW_PAGE_SIZE + 1),
              to: format.number(Math.min((safePage + 1) * REVIEW_PAGE_SIZE, total)),
              total: format.number(total),
            })}
          </span>
          <div className="bulk-review__pager-nav">
            <Button
              tone="ghost"
              className="button--sm"
              disabled={safePage === 0}
              onClick={() => {
                setPage(safePage - 1);
              }}
            >
              {copy.pager.previous}
            </Button>
            <span className="bulk-review__pager-page">
              {interpolate(copy.pager.page, {
                page: format.number(safePage + 1),
                pageCount: format.number(pageCount),
              })}
            </span>
            <Button
              tone="ghost"
              className="button--sm"
              disabled={safePage >= pageCount - 1}
              onClick={() => {
                setPage(safePage + 1);
              }}
            >
              {copy.pager.next}
            </Button>
          </div>
        </div>
      ) : null}

      <StickyActionBar
        missingLabel={copy.sticky.missingLabel}
        missing={
          counts.includedNeedsAttention > 0
            ? plural(counts.includedNeedsAttention, copy.sticky.needAttention, { count: format.number(counts.includedNeedsAttention) })
            : ''
        }
        readyText={interpolate(copy.sticky.ready, { count: format.number(counts.includedReady) })}
      >
        <Button tone="secondary" className="button--sm bulk-review__back" onClick={onBack}>
          {copy.backToConfig}
        </Button>
        <Button
          tone="primary"
          className="button--sm bulk-review__cta"
          disabled={!canApprove}
          onClick={onApproveAll}
        >
          {interpolate(copy.createOffers, { count: format.number(counts.includedReady) })}
        </Button>
      </StickyActionBar>

      {editingRow && connection ? (
        <BulkEditModal
          open={editing !== null}
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          row={editingRow}
          connection={connection}
          canBrowseCategories={canBrowseCategories}
          currency={config.currency}
          defaults={{ publishImmediately: config.publishImmediately }}
          pricingPolicy={config.pricingPolicy}
          stockPolicy={config.stockPolicy}
          batchDeliveryPriceList={batchDeliveryPriceList}
          focusVariantId={editing?.focusVariantId}
          focusField={editing?.focusField}
          demoReadOnly={demoReadOnly}
          onSave={onSaveEditor}
          projectionSummaries={projectionSummaries}
          bundles={bundles?.bundles}
        />
      ) : null}

      {comparingRow && comparingVariant?.overriddenCard ? (
        <BulkCardCategoryDialog
          open
          onOpenChange={(open) => {
            if (!open) setComparing(null);
          }}
          connectionId={config.connectionId}
          destinationName={destinationName}
          subject={
            comparingRow.variants.length > 1
              ? `${comparingRow.product?.name ?? 'Product'} - ${distinguishingLabel(
                  comparingVariant,
                  comparingRow.variants.indexOf(comparingVariant),
                )}`
              : (comparingRow.product?.name ?? 'Product')
          }
          ean={comparingVariant.ean}
          mappedCategoryId={comparingVariant.resolvedCategoryId ?? ''}
          card={comparingVariant.overriddenCard}
          canAdoptCard={comparingRow.variants.length === 1 && onUseCardCategory !== undefined}
          demoReadOnly={demoReadOnly}
          onUseCard={() => {
            onUseCardCategory?.(comparingRow.productId);
          }}
          onEditProduct={() => {
            setEditing({ productId: comparingRow.productId, focusField: 'category' });
          }}
        />
      ) : null}

      {zoom ? (
        <BulkImageLightbox
          src={zoom.src}
          name={zoom.name}
          onClose={() => {
            setZoom(null);
          }}
        />
      ) : null}
    </div>
  );
}

interface ProductRowProps {
  row: BulkWizardRow;
  config: BulkWizardConfig;
  chips: Record<string, ChipDescriptor>;
  alreadyListedVariantIds: ReadonlySet<string>;
  destinationName: string;
  projectionSummaries: ReadonlyMap<string, ProjectionSummary>;
  open: boolean;
  onToggleExpand: () => void;
  onSetVariantIncluded: (productId: string, variantId: string, included: boolean) => void;
  onSetProductIncluded: (productId: string, included: boolean) => void;
  onEdit: (focusVariantId?: string, focusField?: OfferBlockerField) => void;
  onZoom: (src: string, name: string) => void;
  category: CategoryColumn;
  /** Set when this (single-variant) row publishes as a product-set offer (#3520). */
  bundle?: BundleOfferPreviewOk;
  onUseBundleCategory?: (productId: string, categoryId: string) => void;
}

function ProductRow({
  row,
  config,
  chips,
  alreadyListedVariantIds,
  destinationName,
  projectionSummaries,
  open,
  onToggleExpand,
  onSetVariantIncluded,
  onSetProductIncluded,
  onEdit,
  onZoom,
  category,
  bundle,
  onUseBundleCategory,
}: ProductRowProps): ReactElement {
  const copy = useMessages('listings').bulkReviewStep;
  const bundleCopy = useMessages('listings').bundleOffer;
  const plural = usePlural();
  const format = useFormat();
  const productName = row.product?.name ?? copy.row.productFallback;
  const isMulti = row.variants.length > 1;
  const isSimple = row.variants.length === 1;
  const noVariants = row.variants.length === 0;
  const anyAlreadyListed = row.variants.some((v) => alreadyListedVariantIds.has(v.variantId));

  const includedCount = row.variants.filter((v) => v.included).length;
  const allExcluded = row.variants.length > 0 && includedCount === 0;
  const parentState: 'all' | 'some' | 'none' =
    includedCount === 0 ? 'none' : includedCount === row.variants.length ? 'all' : 'some';

  const agg = useMemo(() => {
    let ready = 0;
    let attn = 0;
    let off = 0;
    for (const v of row.variants) {
      const r = variantReadiness(v, chips);
      if (!r.included) off += 1;
      else if (r.ready) ready += 1;
      else attn += 1;
    }
    return { ready, attn, off };
  }, [row.variants, chips]);

  const productPrice =
    row.variants[0]?.masterPrice ?? row.masterPrice ?? null;

  const mainClass = [
    'bulk-review__grid',
    'bulk-review__prow-main',
    isSimple || noVariants ? 'bulk-review__prow-main--flat' : '',
    allExcluded ? 'bulk-review__prow-main--excluded' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={open ? 'bulk-review__prow bulk-review__prow--open' : 'bulk-review__prow'}
      data-product-row={row.productId}
    >
      {/* The whole row is no longer a role="button": it wrapped a checkbox, a
          zoom button, chip buttons and an Edit button, which is an ARIA
          nested-interactive violation. Expand/collapse is now a dedicated toggle
          button on the caret (#1741 review #9). */}
      <div className={mainClass}>
        <span className="bulk-review__c-lead bulk-review__lead">
          {isMulti || bundle ? (
            <button
              type="button"
              className="bulk-review__toggle"
              aria-expanded={open}
              aria-label={
                bundle
                  ? interpolate(open ? bundleCopy.collapse : bundleCopy.expand, { name: productName })
                  : interpolate(open ? copy.row.collapseVariants : copy.row.expandVariants, {
                      name: productName,
                    })
              }
              onClick={onToggleExpand}
            >
              <span className="bulk-review__caret" aria-hidden="true">&#9656;</span>
            </button>
          ) : (
            <span className="bulk-review__toggle-spacer" aria-hidden="true" />
          )}
          {noVariants ? null : (
            <IncludeToggle
              state={parentState}
              ariaLabel={interpolate(copy.row.includeAllVariants, { name: productName })}
              onToggle={() => {
                onSetProductIncluded(row.productId, parentState !== 'all');
              }}
            />
          )}
        </span>
        <div className="bulk-review__name">
          {bundle ? (
            <span className="cx-mosaic" aria-hidden="true">
              <i className="t-a" />
              <i className="t-d" />
              <i className="t-b" />
              <i className="t-c" />
            </span>
          ) : row.product?.images?.[0] ? (
            <button
              type="button"
              className="bulk-review__thumb-btn"
              aria-label={interpolate(copy.row.zoomImage, { name: productName })}
              onClick={(e) => {
                e.stopPropagation();
                onZoom(row.product?.images?.[0] ?? '', row.product?.name ?? '');
              }}
            >
              <ProductThumbnail
                src={row.product.images[0]}
                name={row.product?.name ?? ''}
                className="bulk-review__thumb"
              />
            </button>
          ) : (
            <ProductThumbnail
              src={undefined}
              name={row.product?.name ?? ''}
              className="bulk-review__thumb"
            />
          )}
          <div className="t">
            <b>{row.product?.name ?? copy.row.loading}</b>
            {bundle ? (
              <span className="cx-tag" data-testid="bundle-row-tag">
                <svg className="pm-ico" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8" />
                </svg>
                {plural(bundle.components.length, bundleCopy.marker)}
              </span>
            ) : null}
            <small>
              {row.primaryVariant?.sku ?? ''}
              {row.primaryVariant?.sku ? ' · ' : ''}
              {noVariants
                ? copy.row.noVariants
                : bundle
                  ? bundleCopy.noOwnEan
                  : plural(row.variants.length, copy.row.variantCount)}
            </small>
          </div>
        </div>
        {noVariants ? (
          <div className="bulk-review__c-cat" />
        ) : (
          <ReviewCategoryCell
            connectionId={category.connectionId}
            resolvesAtSubmit={category.resolvesAtSubmit}
            {...(isSimple ? describeVariantCategory(row, row.variants[0]) : describeProductCategory(row))}
            conflict={isSimple ? cardConflict(row, row.variants[0], category) : null}
            siblingConflicts={
              isMulti && !open
                ? {
                    count: row.variants.filter((v) => cardConflict(row, v, category) !== null).length,
                    onReveal: onToggleExpand,
                  }
                : null
            }
          />
        )}
        <div className="bulk-review__c-price tabular">
          {productPrice !== null ? format.money(productPrice, config.currency) : '-'}
        </div>
        <div
          className={[
            'bulk-review__c-stock tabular',
            isMulti ? 'bulk-review__c-stock--note' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {bundle ? (
            <BundleStock preview={bundle} />
          ) : isSimple ? (
            row.variants[0].masterStock ?? '-'
          ) : isMulti ? (
            copy.row.perVariant
          ) : (
            '-'
          )}
        </div>
        <div className="bulk-review__c-status bulk-review__chips">
          {noVariants ? (
            <Chip descriptor={NEUTRAL_BLOCKER_CHIPS['no-variant']} />
          ) : isSimple ? (
            <VariantChips
              variant={row.variants[0]}
              chips={chips}
              label={distinguishingLabel(row.variants[0], 0)}
              alreadyListed={alreadyListedVariantIds.has(row.variants[0].variantId)}
              destinationName={destinationName}
              projection={projectionSummaries.get(row.variants[0].variantId) ?? null}
              copyContext={blockerCopyContext(
                row,
                row.variants[0],
                destinationName,
                config,
                bundle
              )}
              onFix={(focusField) => {
                onEdit(row.variants[0].variantId, focusField);
              }}
            />
          ) : (
            <>
              <AggregateChips ready={agg.ready} attn={agg.attn} off={agg.off} />
              {anyAlreadyListed ? (
                <AlreadyListedChip
                  destinationName={destinationName}
                  title={interpolate(copy.alreadyOn, { destination: destinationName })}
                />
              ) : null}
            </>
          )}
        </div>
        <div className="bulk-review__c-action">
          {noVariants ? (
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{copy.row.noVariant}</span>
          ) : (
            <Button
              tone="secondary"
              className="button--sm bulk-review__edit"
              onClick={(e) => {
                e.stopPropagation();
                onEdit(isSimple ? row.variants[0].variantId : undefined);
              }}
            >
              {copy.row.edit}
            </Button>
          )}
        </div>
      </div>

      {bundle && open ? (
        <div className="bundle-comp-panel" data-testid="bundle-panel">
          <BundleComposition
            preview={bundle}
            connectionId={config.connectionId}
            heading={interpolate(bundleCopy.compositionHeading, { destination: destinationName })}
            showEanNote
            chosenCategoryId={submitCategoryIdOf(row, row.variants[0])}
            onUseSuggestedCategory={
              bundle.suggestedCategoryId && onUseBundleCategory
                ? () => {
                    onUseBundleCategory(row.productId, bundle.suggestedCategoryId ?? '');
                  }
                : undefined
            }
          />
        </div>
      ) : null}

      {isMulti && open ? (
        <div className="bulk-review__vrows">
          {row.variants.map((variant, index) => (
            <VariantRow
              key={variant.variantId}
              row={row}
              variant={variant}
              index={index}
              config={config}
              chips={chips}
              alreadyListed={alreadyListedVariantIds.has(variant.variantId)}
              destinationName={destinationName}
              projection={projectionSummaries.get(variant.variantId) ?? null}
              onSetVariantIncluded={onSetVariantIncluded}
              onEdit={(focusField) => {
                onEdit(variant.variantId, focusField);
              }}
              category={category}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** The include switch of a product row; the tri-state box only where some variants are off. */
function IncludeToggle({
  state,
  ariaLabel,
  onToggle,
}: {
  state: 'all' | 'some' | 'none';
  ariaLabel: string;
  onToggle: () => void;
}): ReactElement {
  if (state === 'some') {
    return <CheckboxCell state={state} ariaLabel={ariaLabel} onToggle={onToggle} />;
  }
  return (
    <label className="ol-toggle">
      <input type="checkbox" checked={state === 'all'} aria-label={ariaLabel} onChange={onToggle} />
    </label>
  );
}

/** What a bundle lists at: the whole sets it can make, and what limits that (#3520). */
function BundleStock({ preview }: { preview: BundleOfferPreviewOk }): ReactElement {
  const copy = useMessages('listings').bundleOffer;
  const limiting = preview.components.find(
    (component) => component.variantId === preview.limitingComponentVariantId,
  );
  return (
    <span className="bundle-stock">
      <span>{preview.availableSets ?? '-'}</span>
      {limiting ? <small title={limiting.name}>{interpolate(copy.limitedBy, { name: limiting.name })}</small> : null}
    </span>
  );
}

interface VariantRowProps {
  row: BulkWizardRow;
  variant: BulkVariantRow;
  index: number;
  config: BulkWizardConfig;
  chips: Record<string, ChipDescriptor>;
  alreadyListed: boolean;
  destinationName: string;
  projection: ProjectionSummary | null;
  onSetVariantIncluded: (productId: string, variantId: string, included: boolean) => void;
  onEdit: (focusField?: OfferBlockerField) => void;
  category: CategoryColumn;
}

function VariantRow({
  row,
  variant,
  index,
  config,
  chips,
  alreadyListed,
  destinationName,
  projection,
  onSetVariantIncluded,
  onEdit,
  category,
}: VariantRowProps): ReactElement {
  const copy = useMessages('listings').bulkReviewStep;
  const format = useFormat();
  const label = distinguishingLabel(variant, index);
  const catBlocked = variant.blockers.some(
    (b) => b === 'no-ean' || b === 'no-match' || b === 'multi-match',
  );
  const price = computeResolvedPrice(
    effectivePricingPolicy(row.override, config.pricingPolicy),
    variant.masterPrice,
    variant.override,
  );
  const stock = computeResolvedStock(
    effectiveStockPolicy(row.override, config.stockPolicy),
    variant.masterStock,
    variant.override,
  );

  return (
    <div
      className={
        variant.included
          ? 'bulk-review__grid bulk-review__vrow'
          : 'bulk-review__grid bulk-review__vrow bulk-review__vrow--excluded'
      }
    >
      <span className="bulk-review__c-lead" />
      <div className="bulk-review__name">
        <label className="ol-toggle bulk-review__chk">
          <input
            type="checkbox"
            checked={variant.included}
            onChange={(e) => {
              onSetVariantIncluded(row.productId, variant.variantId, e.target.checked);
            }}
            aria-label={interpolate(copy.row.includeVariant, { label })}
          />
        </label>
        <div className="t">
          <b>{label}</b>
          <small className={catBlocked ? 'bad' : undefined}>{variant.ean ?? copy.row.noEan}</small>
        </div>
      </div>
      <ReviewCategoryCell
        connectionId={category.connectionId}
        resolvesAtSubmit={category.resolvesAtSubmit}
        {...describeVariantCategory(row, variant)}
        conflict={cardConflict(row, variant, category)}
      />
      <div className="bulk-review__c-price tabular">
        {price.value !== null ? format.money(price.value, config.currency) : '-'}
      </div>
      <div className="bulk-review__c-stock tabular">{stock.value ?? '-'}</div>
      <div className="bulk-review__c-status bulk-review__chips">
        <VariantChips
          variant={variant}
          chips={chips}
          onFix={onEdit}
          label={label}
          alreadyListed={alreadyListed}
          destinationName={destinationName}
          projection={projection}
          copyContext={blockerCopyContext(row, variant, destinationName, config)}
        />
      </div>
      <div className="bulk-review__c-action">
        <Button
          tone="secondary"
          className="button--sm bulk-review__edit"
          onClick={() => {
            // No field: the plain Edit button is not about one, and passing the
            // click event as a field would route the modal nowhere.
            onEdit();
          }}
        >
          {copy.row.edit}
        </Button>
      </div>
    </div>
  );
}

function VariantChips({
  variant,
  chips,
  onFix,
  label,
  alreadyListed,
  destinationName,
  projection,
  copyContext,
}: {
  variant: BulkVariantRow;
  chips: Record<string, ChipDescriptor>;
  onFix: (focusField?: OfferBlockerField) => void;
  /** Human variant label ("Colour: Red" / "Variant 2") — never the raw ol_variant id. */
  label: string;
  /** Already published on the destination (#1837) - soft warning, not a blocker. */
  alreadyListed: boolean;
  destinationName: string;
  /** Values the blocker sentences interpolate (#2240) - barcode, destination, counts. */
  copyContext: BlockerCopyContext;
  /** What the attribute rules fill for this variant (#3995); null = nothing to say. */
  projection: ProjectionSummary | null;
}): ReactElement {
  const copy = useMessages('listings').bulkReviewStep;
  // The "already on {destination}" chip is a SOFT warning shown alongside the
  // readiness/blocker chips - it never marks the variant not-ready (#1837).
  const dupChip = alreadyListed ? <AlreadyListedChip destinationName={destinationName} title={interpolate(copy.alreadyOn, { destination: destinationName })} /> : null;
  if (!variant.included) {
    return (
      <>
        <Chip descriptor={{ tone: 'neutral', label: copy.chips.excluded, fixable: false }} head />
        {dupChip}
      </>
    );
  }
  const rulesChips = <ProjectionChips projection={projection} destinationName={destinationName} onFix={onFix} />;
  // The card-vs-mapping disagreement is shown on the category it is about, in
  // the Category column (#3994) - repeating it here as a status chip would say
  // the same thing twice, in the column furthest from the category.
  const visible = variant.blockers.filter((b) => !CATEGORY_CELL_BLOCKERS.has(b));
  if (visible.length === 0) {
    return (
      <>
        <Chip descriptor={{ tone: 'success', label: copy.chips.ready, fixable: false }} head />
        {rulesChips}
        {dupChip}
      </>
    );
  }
  const gating = visible.filter((b) => !(chips[b]?.advisory === true));
  return (
    <>
      {gating.length > 0 ? (
        <Chip
          descriptor={{ tone: 'warning', label: copy.summary.needAttention, fixable: false }}
          head
        />
      ) : null}
      {visible.map((b) => {
        const descriptor = chips[b] ?? FALLBACK_CHIP;
        // The cause sentence rides on the chip (#2240). One chip per row keeps
        // the identity column at its documented two lines; the explanation is a
        // hover/focus away rather than a second constant chip.
        const cause = describeBlocker(b, copyContext);
        return (
          <Chip
            key={b}
            descriptor={descriptor}
            onFix={descriptor.fixable ? () => onFix(descriptor.field) : undefined}
            fixLabel={interpolate(copy.chips.fixLabel, {
              chip: descriptor.label,
              variant: label,
              cause: cause.title,
            })}
            title={cause.title}
          />
        );
      })}
      {rulesChips}
      {dupChip}
    </>
  );
}

/**
 * What the attribute rules do for one variant (#3995): one chip, never gating.
 * A rule-filled value already counts toward the required-parameter check, and
 * a rejected one leaves that check's own chip standing - this names the cause
 * and, on hover, lists the values the variant will be created with.
 */
function ProjectionChips({
  projection,
  destinationName,
  onFix,
}: {
  projection: ProjectionSummary | null;
  destinationName: string;
  onFix: (focusField?: OfferBlockerField) => void;
}): ReactElement | null {
  const copy = useMessages('listings').attributeRules;
  const plural = usePlural();
  if (!projection) return null;
  const { ruleFilled, rejected } = projection;
  if (ruleFilled.length === 0 && rejected.length === 0) return null;
  const label =
    rejected.length === 1
      ? interpolate(copy.chip.rejectedOne, { parameter: rejected[0].parameterName })
      : rejected.length > 1
        ? plural(rejected.length, copy.chip.rejectedCount)
        : plural(ruleFilled.length, copy.chip.fromRules);
  const tone = rejected.length > 0 ? 'bulk-chip--warning' : 'bulk-chip--info';
  const values = (
    <dl className="rules-chip-tip">
      {ruleFilled.map((o) => (
        <div key={o.parameterId} style={{ display: 'contents' }}>
          <dt>{o.parameterName}</dt>
          <dd>{o.rawValue}</dd>
        </div>
      ))}
      {rejected.map((o) => (
        <div key={o.parameterId} style={{ display: 'contents' }}>
          <dt>{o.parameterName}</dt>
          <dd className="rules-chip-tip__rejected">
            {interpolate(copy.chip.notOnList, { value: o.rawValue, destination: destinationName })}
          </dd>
        </div>
      ))}
    </dl>
  );
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {rejected.length > 0 ? (
          <button
            type="button"
            className={`bulk-chip ${tone}`}
            aria-label={interpolate(copy.rejectedRowLabel, {
              names: listParameterNames(rejected, copy.parameterList, plural),
              destination: destinationName,
            })}
            onClick={(e) => {
              e.stopPropagation();
              onFix('parameters');
            }}
          >
            <span className="bulk-chip__dot" aria-hidden="true" />
            {label}
          </button>
        ) : (
          <span className={`bulk-chip ${tone} rules-chip`} tabIndex={0}>
            <span className="bulk-chip__dot" aria-hidden="true" />
            {label}
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent side="top" align="start">
        {values}
      </TooltipContent>
    </Tooltip>
  );
}

function AggregateChips({
  ready,
  attn,
  off,
}: {
  ready: number;
  attn: number;
  off: number;
}): ReactElement {
  const copy = useMessages('listings').bulkReviewStep.chips;
  const plural = usePlural();
  return (
    <>
      {ready > 0 ? (
        <Chip descriptor={{ tone: 'success', label: plural(ready, copy.readyCount), fixable: false }} />
      ) : null}
      {attn > 0 ? (
        <Chip
          descriptor={{ tone: 'warning', label: plural(attn, copy.attentionCount), fixable: false }}
        />
      ) : null}
      {off > 0 ? (
        <Chip descriptor={{ tone: 'neutral', label: plural(off, copy.offCount), fixable: false }} />
      ) : null}
    </>
  );
}

function Chip({
  descriptor,
  onFix,
  fixLabel,
  title,
  head = false,
}: {
  /** The row's status badge itself, not one of its cause buttons. */
  head?: boolean;
  descriptor: ChipDescriptor;
  onFix?: (focusField?: OfferBlockerField) => void;
  fixLabel?: string;
  /** Cause sentence, shown on hover; also folded into the accessible name. */
  title?: string;
}): ReactElement {
  const cls = `bulk-chip ${chipToneClass(descriptor.tone)}${head ? ' bulk-chip--head' : ''}`;
  if (onFix) {
    return (
      <button
        type="button"
        className={cls}
        aria-label={fixLabel ?? descriptor.label}
        title={title}
        onClick={(e) => {
          e.stopPropagation();
          onFix();
        }}
      >
        <span className="bulk-chip__dot" aria-hidden="true" />
        {descriptor.label}
      </button>
    );
  }
  return (
    <span className={cls} title={title}>
      <span className="bulk-chip__dot" aria-hidden="true" />
      {descriptor.label}
    </span>
  );
}

interface BatchCounts {
  includedReady: number;
  includedNeedsAttention: number;
  excluded: number;
}

function countBatch(
  rows: BulkWizardRow[],
  chips: Record<string, ChipDescriptor> = {},
): BatchCounts {
  let includedReady = 0;
  let includedNeedsAttention = 0;
  let excluded = 0;
  for (const row of rows) {
    for (const v of row.variants) {
      if (!v.included) {
        excluded += 1;
        continue;
      }
      if (gatingBlockers(v.blockers, chips).length === 0) includedReady += 1;
      else includedNeedsAttention += 1;
    }
  }
  return { includedReady, includedNeedsAttention, excluded };
}

export { countBatch as countBatchForTest };
