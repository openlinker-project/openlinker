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
import { Button, CheckboxCell, Input, ProductThumbnail } from '../../../../shared/ui';
import type { StatusBadgeTone } from '../../../../shared/ui';
import type { OfferBlockerDescriptor } from '../../../../shared/plugins';
import type { Connection } from '../../../connections';
import type { BulkPerProductOverride } from '../../api/bulk-listings.types';
import {
  computeResolvedPrice,
  computeResolvedStock,
  distinguishingLabel,
  effectivePricingPolicy,
  effectiveStockPolicy,
} from './bulk-policy';
import type {
  BulkVariantRow,
  BulkWizardConfig,
  BulkWizardRow,
} from './bulk-wizard.types';
import { BulkEditModal } from './bulk-edit-modal';
import { BulkImageLightbox } from './bulk-image-lightbox';
import {
  FALLBACK_CHIP,
  NEUTRAL_BLOCKER_CHIPS,
  type ChipDescriptor,
} from './bulk-blockers';

interface BulkReviewStepProps {
  rows: BulkWizardRow[];
  connection: Connection | null;
  config: BulkWizardConfig;
  paramsResolving: boolean;
  platformBlockerChips: readonly OfferBlockerDescriptor[];
  canBrowseCategories: boolean;
  batchDeliveryPriceList?: string;
  /** Demo read-only viewer - gates the editor's field edits + "Save all" (#1704). */
  demoReadOnly: boolean;
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
}

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
    default:
      return 'bulk-chip--neutral';
  }
}

interface VariantReadiness {
  included: boolean;
  ready: boolean;
}

function variantReadiness(v: BulkVariantRow): VariantReadiness {
  return { included: v.included, ready: v.included && v.blockers.length === 0 };
}

export function BulkReviewStep({
  rows,
  connection,
  config,
  paramsResolving,
  platformBlockerChips,
  canBrowseCategories,
  batchDeliveryPriceList,
  demoReadOnly,
  onSetVariantIncluded,
  onSetProductIncluded,
  onSaveEditor,
  onApproveAll,
  onBack,
}: BulkReviewStepProps): ReactElement {
  const blockerChips = useMemo<Record<string, ChipDescriptor>>(() => {
    const merged: Record<string, ChipDescriptor> = { ...NEUTRAL_BLOCKER_CHIPS };
    for (const chip of platformBlockerChips) {
      merged[chip.id] = { tone: chip.tone as StatusBadgeTone, label: chip.label, fixable: true };
    }
    return merged;
  }, [platformBlockerChips]);

  const [filter, setFilter] = useState('');
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [editing, setEditing] = useState<{ productId: string; focusVariantId?: string } | null>(
    null,
  );
  const [zoom, setZoom] = useState<{ src: string; name: string } | null>(null);
  // "Jump to next flagged" cursor + deferred scroll target so the jump can cross
  // pagination boundaries: it advances a cursor through the flagged set, flips to
  // the target's page, then scrolls once that page has rendered (#1741 review #10).
  const [jumpIndex, setJumpIndex] = useState(-1);
  const [pendingScroll, setPendingScroll] = useState<string | null>(null);

  const counts = useMemo(() => countBatch(rows), [rows]);
  const canApprove =
    counts.includedReady > 0 && counts.includedNeedsAttention === 0 && !paramsResolving;

  const filteredRows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return rows.filter((r) => {
      if (needle !== '') {
        const name = (r.product?.name ?? '').toLowerCase();
        const sku = (r.primaryVariant?.sku ?? '').toLowerCase();
        if (!name.includes(needle) && !sku.includes(needle)) return false;
      }
      if (onlyFlagged) {
        return r.variants.some((v) => v.included && v.blockers.length > 0);
      }
      return true;
    });
  }, [rows, filter, onlyFlagged]);

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
      r.variants.some((v) => v.included && v.blockers.length > 0),
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
        <p>No products selected. Go back and pick products to create offers for.</p>
        <Button tone="primary" onClick={onBack}>
          Choose products
        </Button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <header className="bulk-review__header">
        <div className="bulk-review__intro">
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>
            Review {rows.length} {rows.length === 1 ? 'product' : 'products'}
          </h2>
          <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 13 }}>
            Expand a product to review each variant. Switch a variant off to skip it - the rest
            still list and group together.
          </p>
        </div>
        <div className="bulk-review__toolbar">
          <Input
            type="search"
            placeholder="Filter products..."
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
            }}
            className="bulk-review__filter"
            aria-label="Filter products by name or SKU"
          />
          <Button
            tone="primary"
            className="bulk-review__cta bulk-review__cta--top"
            disabled={!canApprove}
            onClick={onApproveAll}
          >
            Create offers ({counts.includedReady})
          </Button>
        </div>
      </header>

      <div className="bulk-review__summary" role="status">
        <div className="ready">
          <span className="n">{counts.includedReady}</span> <span className="lbl">ready</span>
        </div>
        <div className="attn">
          <span className="n">{counts.includedNeedsAttention}</span>{' '}
          <span className="lbl">need attention</span>
        </div>
        <div className="off">
          <span className="n">{counts.excluded}</span> <span className="lbl">excluded</span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--space-2)' }}>
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              color: 'var(--text-secondary)',
            }}
          >
            <input
              type="checkbox"
              checked={onlyFlagged}
              onChange={(e) => {
                setOnlyFlagged(e.target.checked);
              }}
            />
            Only flagged
          </label>
          {counts.includedNeedsAttention > 0 ? (
            <Button tone="ghost" className="button--xs" onClick={jumpToNextFlagged}>
              Jump to next flagged
            </Button>
          ) : null}
        </div>
      </div>

      <div
        className={counts.includedNeedsAttention === 0 ? 'bulk-review__banner bulk-review__banner--ok' : 'bulk-review__banner'}
        role="status"
      >
        {counts.includedNeedsAttention === 0 ? (
          <>
            <b>All included variants are ready.</b> {counts.includedReady} offers will be created;
            the marketplace groups each product's variants into one listing.
          </>
        ) : (
          <>
            <b>
              {counts.includedNeedsAttention}{' '}
              {counts.includedNeedsAttention === 1 ? 'variant needs' : 'variants need'} attention.
            </b>{' '}
            Fix the blocker(s), or switch them off to skip - then Create offers unlocks.
          </>
        )}
      </div>

      <div className="bulk-review__table">
        {/* Header is announced (not aria-hidden) so screen-reader users get the
            column labels for the rows below (#1741 review #9). */}
        <div className="bulk-review__grid bulk-review__head">
          <span className="bulk-review__c-lead" />
          <span>Product</span>
          <span className="bulk-review__c-status">Status</span>
          <span className="bulk-review__c-stock">Stock</span>
          <span className="bulk-review__c-price">Price</span>
          <span className="bulk-review__c-action" />
        </div>

        {pageRows.map((row) => (
          <ProductRow
            key={row.productId}
            row={row}
            config={config}
            chips={blockerChips}
            open={expanded.has(row.productId)}
            onToggleExpand={() => {
              toggleExpand(row.productId);
            }}
            onSetVariantIncluded={onSetVariantIncluded}
            onSetProductIncluded={onSetProductIncluded}
            onEdit={(focusVariantId) => {
              setEditing({ productId: row.productId, focusVariantId });
            }}
            onZoom={(src, name) => {
              setZoom({ src, name });
            }}
          />
        ))}
      </div>

      {total > REVIEW_PAGE_SIZE ? (
        <div className="bulk-review__pager">
          <span className="bulk-review__pager-count">
            Showing {safePage * REVIEW_PAGE_SIZE + 1} to{' '}
            {Math.min((safePage + 1) * REVIEW_PAGE_SIZE, total)} of {total} products
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
              Previous
            </Button>
            <span className="bulk-review__pager-page">
              {safePage + 1} / {pageCount}
            </span>
            <Button
              tone="ghost"
              className="button--sm"
              disabled={safePage >= pageCount - 1}
              onClick={() => {
                setPage(safePage + 1);
              }}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}

      <Button
        tone="primary"
        className="bulk-review__cta bulk-review__cta--mobile"
        disabled={!canApprove}
        onClick={onApproveAll}
      >
        Create offers ({counts.includedReady})
      </Button>

      <footer className="bulk-wizard__footer bulk-wizard__footer--start">
        <Button tone="ghost" className="bulk-review__back" onClick={onBack}>
          Back to Config
        </Button>
      </footer>

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
          demoReadOnly={demoReadOnly}
          onSave={onSaveEditor}
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
  open: boolean;
  onToggleExpand: () => void;
  onSetVariantIncluded: (productId: string, variantId: string, included: boolean) => void;
  onSetProductIncluded: (productId: string, included: boolean) => void;
  onEdit: (focusVariantId?: string) => void;
  onZoom: (src: string, name: string) => void;
}

function ProductRow({
  row,
  config,
  chips,
  open,
  onToggleExpand,
  onSetVariantIncluded,
  onSetProductIncluded,
  onEdit,
  onZoom,
}: ProductRowProps): ReactElement {
  const isMulti = row.variants.length > 1;
  const isSimple = row.variants.length === 1;
  const noVariants = row.variants.length === 0;

  const includedCount = row.variants.filter((v) => v.included).length;
  const allExcluded = row.variants.length > 0 && includedCount === 0;
  const parentState: 'all' | 'some' | 'none' =
    includedCount === 0 ? 'none' : includedCount === row.variants.length ? 'all' : 'some';

  const agg = useMemo(() => {
    let ready = 0;
    let attn = 0;
    let off = 0;
    for (const v of row.variants) {
      const r = variantReadiness(v);
      if (!r.included) off += 1;
      else if (r.ready) ready += 1;
      else attn += 1;
    }
    return { ready, attn, off };
  }, [row.variants]);

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
          {noVariants ? null : (
            <CheckboxCell
              state={parentState}
              ariaLabel={`Include all ${row.product?.name ?? 'product'} variants`}
              onToggle={() => {
                onSetProductIncluded(row.productId, parentState !== 'all');
              }}
            />
          )}
          {isMulti ? (
            <button
              type="button"
              className="bulk-review__toggle"
              aria-expanded={open}
              aria-label={`${open ? 'Collapse' : 'Expand'} ${row.product?.name ?? 'product'} variants`}
              onClick={onToggleExpand}
            >
              <span className="bulk-review__caret" aria-hidden="true">&#9656;</span>
            </button>
          ) : null}
        </span>
        <div className="bulk-review__name">
          {row.product?.images?.[0] ? (
            <button
              type="button"
              className="bulk-review__thumb-btn"
              aria-label={`Zoom image of ${row.product?.name ?? 'product'}`}
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
            <b>{row.product?.name ?? 'Loading...'}</b>
            <small>
              {row.primaryVariant?.sku ?? ''}
              {row.primaryVariant?.sku ? ' · ' : ''}
              {noVariants
                ? 'no variants'
                : isMulti
                  ? `${row.variants.length} variants`
                  : '1 variant'}
            </small>
          </div>
        </div>
        <div className="bulk-review__c-status bulk-review__chips">
          {noVariants ? (
            <Chip descriptor={NEUTRAL_BLOCKER_CHIPS['no-variant']} />
          ) : isSimple ? (
            <VariantChips
              variant={row.variants[0]}
              chips={chips}
              label={distinguishingLabel(row.variants[0], 0)}
              onFix={() => {
                onEdit(row.variants[0].variantId);
              }}
            />
          ) : (
            <AggregateChips ready={agg.ready} attn={agg.attn} off={agg.off} />
          )}
        </div>
        <div
          className={[
            'bulk-review__c-stock tabular',
            isMulti ? 'bulk-review__c-stock--note' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {isSimple ? row.variants[0].masterStock ?? '-' : isMulti ? 'per variant' : '-'}
        </div>
        <div className="bulk-review__c-price tabular">
          {productPrice !== null ? `${productPrice.toFixed(2)} ${config.currency}` : '-'}
        </div>
        <div className="bulk-review__c-action">
          {noVariants ? (
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>No variant</span>
          ) : (
            <Button
              tone="ghost"
              className="button--xs bulk-review__edit"
              onClick={(e) => {
                e.stopPropagation();
                onEdit(isSimple ? row.variants[0].variantId : undefined);
              }}
            >
              Edit
            </Button>
          )}
        </div>
      </div>

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
              onSetVariantIncluded={onSetVariantIncluded}
              onEdit={() => {
                onEdit(variant.variantId);
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

interface VariantRowProps {
  row: BulkWizardRow;
  variant: BulkVariantRow;
  index: number;
  config: BulkWizardConfig;
  chips: Record<string, ChipDescriptor>;
  onSetVariantIncluded: (productId: string, variantId: string, included: boolean) => void;
  onEdit: () => void;
}

function VariantRow({
  row,
  variant,
  index,
  config,
  chips,
  onSetVariantIncluded,
  onEdit,
}: VariantRowProps): ReactElement {
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
        <input
          type="checkbox"
          className="bulk-review__chk"
          checked={variant.included}
          onChange={(e) => {
            onSetVariantIncluded(row.productId, variant.variantId, e.target.checked);
          }}
          aria-label={`Include ${label}`}
        />
        <div className="t">
          <b>{label}</b>
          <small className={catBlocked ? 'bad' : undefined}>{variant.ean ?? 'no EAN'}</small>
        </div>
      </div>
      <div className="bulk-review__c-status bulk-review__chips">
        <VariantChips variant={variant} chips={chips} onFix={onEdit} label={label} />
      </div>
      <div className="bulk-review__c-stock tabular">{stock.value ?? '-'}</div>
      <div className="bulk-review__c-price tabular">
        {price.value !== null ? `${price.value.toFixed(2)} ${config.currency}` : '-'}
      </div>
      <div className="bulk-review__c-action">
        <Button tone="ghost" className="button--xs bulk-review__edit" onClick={onEdit}>
          Edit
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
}: {
  variant: BulkVariantRow;
  chips: Record<string, ChipDescriptor>;
  onFix: () => void;
  /** Human variant label ("Colour: Red" / "Variant 2") — never the raw ol_variant id. */
  label: string;
}): ReactElement {
  if (!variant.included) {
    return <Chip descriptor={{ tone: 'neutral', label: 'excluded', fixable: false }} />;
  }
  if (variant.blockers.length === 0) {
    return <Chip descriptor={{ tone: 'success', label: 'ready', fixable: false }} />;
  }
  return (
    <>
      {variant.blockers.map((b) => {
        const descriptor = chips[b] ?? FALLBACK_CHIP;
        return (
          <Chip
            key={b}
            descriptor={descriptor}
            onFix={descriptor.fixable ? onFix : undefined}
            fixLabel={`Fix: ${descriptor.label} - ${label}`}
          />
        );
      })}
    </>
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
  return (
    <>
      {ready > 0 ? <Chip descriptor={{ tone: 'success', label: `${ready} ready`, fixable: false }} /> : null}
      {attn > 0 ? <Chip descriptor={{ tone: 'warning', label: `${attn} attention`, fixable: false }} /> : null}
      {off > 0 ? <Chip descriptor={{ tone: 'neutral', label: `${off} off`, fixable: false }} /> : null}
    </>
  );
}

function Chip({
  descriptor,
  onFix,
  fixLabel,
}: {
  descriptor: ChipDescriptor;
  onFix?: () => void;
  fixLabel?: string;
}): ReactElement {
  const cls = `bulk-chip ${chipToneClass(descriptor.tone)}`;
  if (onFix) {
    return (
      <button
        type="button"
        className={cls}
        aria-label={fixLabel ?? descriptor.label}
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
    <span className={cls}>
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

function countBatch(rows: BulkWizardRow[]): BatchCounts {
  let includedReady = 0;
  let includedNeedsAttention = 0;
  let excluded = 0;
  for (const row of rows) {
    for (const v of row.variants) {
      if (!v.included) {
        excluded += 1;
        continue;
      }
      if (v.blockers.length === 0) includedReady += 1;
      else includedNeedsAttention += 1;
    }
  }
  return { includedReady, includedNeedsAttention, excluded };
}

export { countBatch as countBatchForTest };
