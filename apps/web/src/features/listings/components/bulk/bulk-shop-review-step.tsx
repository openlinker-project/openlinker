/**
 * Bulk wizard Shop Review step (#1829)
 *
 * The `ProductPublisher` (online shop) branch of the bulk wizard. Shops have no
 * marketplace category/EAN resolution, so the wizard skips the Resolve step and
 * lands here straight from Config. This step reviews every variant of the
 * seeded rows, computes each one's stock (from master availability + the batch
 * stock policy) and price (from the variant master price + the batch pricing
 * policy), lets the operator flip visibility (draft / published) and
 * include/exclude variants, then submits one `bulk-shop-publish` item per
 * included variant.
 *
 * Per-product content / category / attribute editing lands via the shared
 * two-pane editor (#1830, shop mode) opened from each row's Edit button; the
 * overrides it saves round-trip through each item's `content` /
 * `destinationCategoryIds` / `parameters` (backed by the #1831 transport).
 *
 * Structural + visual parity with the marketplace `BulkReviewStep` (#1838
 * whole-epic review): the row grid is the SAME bespoke aligned CSS grid
 * (`.bulk-review__table` / `.bulk-review__grid` / `.bulk-review__head`) with
 * PRODUCT / STATUS / STOCK / PRICE column headers, a thumbnail+name+sku
 * PRODUCT cell, compact inline status pills (`.bulk-chip`) sitting side by
 * side with the "already on {destination}" chip in the STATUS cell, and a
 * right-aligned Edit action cell - reused verbatim, not reinvented. Only the
 * underlying readiness rule differs (shop: stock only, via
 * `checkShopLineSellability`; marketplace: category/EAN/param blockers). Rows
 * still group by product with expand/collapse for a multi-variant product
 * (nested variant sub-rows under the product row, same as the marketplace
 * table), plus a filter box and an "only flagged" toggle (flagged = out of
 * stock OR already-listed).
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { RichTextView } from '../../../../shared/ui';

import { Alert, Button, CheckboxCell, Input, ProductThumbnail } from '../../../../shared/ui';
import { ReadOnlyLock } from '../../../../shared/ui/read-only-lock';
import { DEMO_READ_ONLY_ACTION_MESSAGE } from '../../../../shared/config/demo-mode';
import { useInventoryAvailabilityBatchQuery } from '../../../inventory';
import { publishDestinationKind } from '../../lib/publish-destinations';
import { checkShopLineSellability } from '../../lib/required-to-sell';
import type { Connection } from '../../../connections';
import type { BulkShopPublishItemRequest, ShopPublishContent } from '../../api/listings.types';
import type { BulkPerProductOverride } from '../../api/bulk-listings.types';
import {
  computeResolvedPrice,
  computeResolvedStock,
  effectivePricingPolicy,
  effectiveStockPolicy,
} from './bulk-policy';
import { BulkEditModal } from './bulk-edit-modal';
import { AlreadyListedChip } from '../already-listed-chip';
import type { BulkVariantRow, BulkWizardConfig, BulkWizardRow } from './bulk-wizard.types';

/** Visibility the batch publishes with; mirrors the shop publish status set. */
export type ShopPublishVisibility = 'draft' | 'published';

interface BulkShopReviewStepProps {
  rows: BulkWizardRow[];
  connection: Connection | null;
  config: BulkWizardConfig;
  demoReadOnly: boolean;
  isSubmitting: boolean;
  errorMessage: string | null;
  /** Variants already published on this shop (#1837) - shown as a soft
   *  "already on {destination}" chip; publishing upserts them. */
  alreadyListedVariantIds: ReadonlySet<string>;
  /** Destination name for the "already on {name}" chip copy. */
  destinationName: string;
  onSetVariantIncluded: (productId: string, variantId: string, included: boolean) => void;
  onBack: () => void;
  onPublish: (items: BulkShopPublishItemRequest[], status: ShopPublishVisibility) => void;
  /**
   * Commit a per-product edit session from the shop editor (#1830). Same
   * signature as the marketplace review's editor save; the wizard stores the
   * overrides on the row + per-variant map, which `buildBulkShopPublishItems`
   * threads onto each item's content / category / attribute payload.
   */
  onSaveEditor: (
    productId: string,
    baseOverride: BulkPerProductOverride,
    perVariantOverrides: Record<string, BulkPerProductOverride>,
    includedByVariantId: Record<string, boolean>,
    editFormValues: Record<string, unknown>
  ) => void;
}

/** A flattened variant paired with its owning product for display. The
 *  displayed `stock` / `price` are the SAME policy-resolved values the submit
 *  sends (see `buildBulkShopPublishItems`), so review == publish. */
interface ShopReviewLine {
  productId: string;
  productName: string;
  /** First master product image, if any - PRODUCT cell thumbnail (#1838). */
  productImage: string | null;
  variantId: string;
  variantLabel: string;
  /** SKU shown under the label in the PRODUCT cell, mirroring the
   *  marketplace review's variant sub-row (`.bulk-review__name .t small`). */
  variantSku: string;
  included: boolean;
  /** Policy-resolved published quantity; null when unresolved (shown as 0). */
  stock: number | null;
  /** Policy-resolved price; null when it falls back to master server-side. */
  price: number | null;
  /**
   * The description this line will actually publish, resolved exactly as the
   * payload resolves it (#2200). `null` when the operator overrode nothing and
   * the builder will fall back to the master product's own description
   * server-side - which the preview then says, rather than showing blank.
   */
  description: string | null;
}

/** Product-grouped lines (#1838) - a product with 2+ lines to review renders
 *  as an expand/collapse group; a single-variant product renders flat with no
 *  caret, mirroring the marketplace `BulkReviewStep` isSimple/isMulti split. */
interface ShopReviewGroup {
  productId: string;
  productName: string;
  productImage: string | null;
  isMulti: boolean;
  lines: ShopReviewLine[];
}

function groupReviewLines(lines: ShopReviewLine[]): ShopReviewGroup[] {
  const groups = new Map<string, ShopReviewGroup>();
  for (const line of lines) {
    let group = groups.get(line.productId);
    if (!group) {
      group = {
        productId: line.productId,
        productName: line.productName,
        productImage: line.productImage,
        isMulti: false,
        lines: [],
      };
      groups.set(line.productId, group);
    }
    group.lines.push(line);
  }
  for (const group of groups.values()) {
    group.isMulti = group.lines.length > 1;
  }
  return Array.from(groups.values());
}

function variantDisplayLabel(variant: BulkVariantRow): string {
  const attrs = variant.distinguishingAttributes
    ? Object.values(variant.distinguishingAttributes).join(' · ')
    : '';
  return attrs || variant.variant.sku || variant.variantId;
}

/**
 * Effective per-item content override (#1830). Title / images are base-only
 * (parent-scoped); description falls back base -> variant with the variant
 * winning. Returns `undefined` when the operator supplied no content override,
 * so the item omits `content` and the builder keeps its master/batch fallback.
 */
/**
 * What the disclosure should say when a line carries no markup.
 *
 * An absent description and a DELIBERATELY CLEARED one are different facts, and
 * both arrive here as falsy: `null`/`undefined` means "no override, the master
 * copy publishes", while `''` means the operator emptied the field on purpose.
 * Saying "from the master product" about the second is wrong in the direction
 * that matters - it tells the operator their old copy will go out.
 */
function describeEmptyDescription(description: string | null | undefined): string {
  return description === ''
    ? 'Cleared - this line publishes no description.'
    : 'From the master product — no override for this line.';
}

function effectiveShopContent(
  row: BulkWizardRow,
  variant: BulkVariantRow
): ShopPublishContent | undefined {
  const base = row.override.overrides ?? {};
  const variantOverrides = variant.override.overrides ?? {};
  const content: ShopPublishContent = {};
  if (typeof base.title === 'string' && base.title !== '') content.title = base.title;
  const description =
    typeof variantOverrides.description === 'string'
      ? variantOverrides.description
      : typeof base.description === 'string'
        ? base.description
        : undefined;
  if (description !== undefined) content.description = description;
  if (Array.isArray(base.imageUrls)) content.imageUrls = base.imageUrls;
  return Object.keys(content).length > 0 ? content : undefined;
}

/**
 * Build one `bulk-shop-publish` item per included variant. Stock resolves from
 * master availability + the row-effective stock policy; price from the variant
 * master price + the row-effective pricing policy (a per-product policy override
 * from the editor wins over the batch, #1741). A null resolved price is omitted
 * (the shop builder falls back to master at publish time); a null resolved stock
 * sends 0. Per-product content / destination category / attribute overrides from
 * the shop editor (#1830) thread onto the item so they beat the server-side
 * defaults (#1831 transport). Category / parameters are base-only (product
 * scoped); a defined-but-empty value is preserved (it means "uncategorised" /
 * "no attributes", which the builder honours by skipping provisioning).
 */
export function buildBulkShopPublishItems(
  rows: BulkWizardRow[],
  config: BulkWizardConfig,
  masterStockByVariantId: ReadonlyMap<string, number>
): BulkShopPublishItemRequest[] {
  const items: BulkShopPublishItemRequest[] = [];
  for (const row of rows) {
    const rowPricingPolicy = effectivePricingPolicy(row.override, config.pricingPolicy);
    const rowStockPolicy = effectiveStockPolicy(row.override, config.stockPolicy);
    const base = row.override.overrides ?? {};
    for (const variant of row.variants) {
      if (!variant.included) continue;
      const masterStock = masterStockByVariantId.get(variant.variantId) ?? variant.masterStock;
      const stock = computeResolvedStock(rowStockPolicy, masterStock, variant.override);
      const price = computeResolvedPrice(rowPricingPolicy, variant.masterPrice, variant.override);
      const content = effectiveShopContent(row, variant);
      items.push({
        internalVariantId: variant.variantId,
        stock: stock.value ?? 0,
        ...(price.value !== null
          ? { price: { amount: price.value, currency: config.currency } }
          : {}),
        ...(content ? { content } : {}),
        ...(base.destinationCategoryIds !== undefined
          ? { destinationCategoryIds: base.destinationCategoryIds }
          : {}),
        ...(base.parameters !== undefined ? { parameters: base.parameters } : {}),
      });
    }
  }
  return items;
}

/** Readiness counts across ALL lines (included + excluded) - the shop-side
 *  counterpart to the marketplace review's `countBatch` (#1838). "Ready" /
 *  "needs attention" only apply to included lines; excluded lines are their
 *  own bucket, mirroring the marketplace ready/attn/off summary. */
interface ShopBatchCounts {
  ready: number;
  needsAttention: number;
  excluded: number;
}

function countShopBatch(lines: ShopReviewLine[]): ShopBatchCounts {
  let ready = 0;
  let needsAttention = 0;
  let excluded = 0;
  for (const line of lines) {
    if (!line.included) {
      excluded += 1;
      continue;
    }
    if (checkShopLineSellability(line.stock ?? 0).length === 0) ready += 1;
    else needsAttention += 1;
  }
  return { ready, needsAttention, excluded };
}

export { countShopBatch as countShopBatchForTest };

export function BulkShopReviewStep({
  rows,
  connection,
  config,
  demoReadOnly,
  isSubmitting,
  errorMessage,
  alreadyListedVariantIds,
  destinationName,
  onSetVariantIncluded,
  onBack,
  onPublish,
  onSaveEditor,
}: BulkShopReviewStepProps): ReactElement {
  const [status, setStatus] = useState<ShopPublishVisibility>(
    config.publishImmediately ? 'published' : 'draft'
  );
  // Per-product edit session (#1830) - product id + the variant to focus.
  const [editing, setEditing] = useState<{ productId: string; focusVariantId?: string } | null>(
    null
  );
  // Required-to-sell preflight (#1842) - soft-block: operator must tick this
  // to publish while any included line is out of stock.
  const [acknowledgeOutOfStock, setAcknowledgeOutOfStock] = useState(false);

  // Capability-gated shop editor sub-sections - never a platformType literal.
  const canBrowseShopCategories =
    connection?.supportedCapabilities?.includes('ShopCategoryBrowser') ?? false;
  const canPickShopAttributes =
    connection?.supportedCapabilities?.includes('ShopAttributeReader') ?? false;
  // Guard: only mount the editor for a genuine shop destination (#1830).
  const isShopDestination = connection !== null && publishDestinationKind(connection) === 'shop';

  const editingRow = useMemo(
    () => (editing ? rows.find((r) => r.productId === editing.productId) ?? null : null),
    [editing, rows]
  );

  const includedVariantIds = useMemo(() => {
    const ids: string[] = [];
    for (const row of rows) {
      for (const variant of row.variants) {
        if (variant.included) ids.push(variant.variantId);
      }
    }
    return ids;
  }, [rows]);

  const availabilityQuery = useInventoryAvailabilityBatchQuery(includedVariantIds, {
    enabled: includedVariantIds.length > 0,
  });
  const masterStockByVariantId = useMemo(
    () =>
      new Map(
        (availabilityQuery.data?.items ?? []).map((i) => [i.productVariantId, i.totalAvailable])
      ),
    [availabilityQuery.data]
  );

  // Every variant renders a line (included or not) so an excluded row stays
  // visible with an unchecked checkbox and can be re-included from Review -
  // structural parity with the marketplace review step's variant rows.
  const lines = useMemo<ShopReviewLine[]>(() => {
    const out: ShopReviewLine[] = [];
    for (const row of rows) {
      for (const variant of row.variants) {
        // Resolve exactly as the payload does so what the operator reviews
        // equals what is submitted (review == publish).
        const masterStock = masterStockByVariantId.get(variant.variantId) ?? variant.masterStock;
        const stock = computeResolvedStock(config.stockPolicy, masterStock, variant.override);
        const price = computeResolvedPrice(
          config.pricingPolicy,
          variant.masterPrice,
          variant.override
        );
        out.push({
          productId: row.productId,
          productName: row.product?.name ?? row.productId,
          productImage: row.product?.images?.[0] ?? null,
          variantId: variant.variantId,
          variantLabel: variantDisplayLabel(variant),
          variantSku: variant.variant.sku ?? '',
          included: variant.included,
          stock: stock.value,
          price: price.value,
          // Same resolver the submit path uses, so review == publish - the
          // principle this block's comment above already states.
          description: effectiveShopContent(row, variant)?.description ?? null,
        });
      }
    }
    return out;
  }, [rows, config.stockPolicy, config.pricingPolicy, masterStockByVariantId]);

  const includedLines = useMemo(() => lines.filter((l) => l.included), [lines]);

  // Required-to-sell preflight (#1842): a listing that publishes with zero
  // stock is live but unbuyable. Soft-block - surfaced per row + a batch
  // banner, overridable via the acknowledgement checkbox below. Only applies
  // to included lines - an excluded row never blocks publish.
  const outOfStockVariantIds = useMemo(
    () =>
      new Set(
        includedLines
          .filter((line) => checkShopLineSellability(line.stock ?? 0).length > 0)
          .map((line) => line.variantId)
      ),
    [includedLines]
  );
  const needsSellabilityAck = outOfStockVariantIds.size > 0 && !acknowledgeOutOfStock;

  // Re-arm the confirmation whenever the out-of-stock set changes (fixed via
  // the editor, or a different variant went out of stock) so a stale tick
  // never silently covers a new issue.
  useEffect(() => {
    setAcknowledgeOutOfStock(false);
  }, [outOfStockVariantIds.size]);

  // Ready / needs-attention / excluded summary counts (#1838) - visual parity
  // with the marketplace review's ready/attn/off summary bar.
  const counts = useMemo(() => countShopBatch(lines), [lines]);

  // Flagged = out of stock OR already listed on the destination (#1838) -
  // drives the "only flagged" toggle, mirroring the marketplace review step.
  const flaggedVariantIds = useMemo(() => {
    const flagged = new Set<string>();
    for (const line of lines) {
      if (outOfStockVariantIds.has(line.variantId) || alreadyListedVariantIds.has(line.variantId)) {
        flagged.add(line.variantId);
      }
    }
    return flagged;
  }, [lines, outOfStockVariantIds, alreadyListedVariantIds]);

  // Product-grouped rows with expand/collapse + filter/"only flagged" (#1838
  // whole-epic review) - structural parity with the marketplace review step.
  const [filter, setFilter] = useState('');
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  function toggleExpand(productId: string): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  }

  const groups = useMemo(() => groupReviewLines(lines), [lines]);
  const filteredGroups = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return groups.filter((group) => {
      if (needle !== '') {
        const nameMatch = group.productName.toLowerCase().includes(needle);
        const skuMatch = group.lines.some((line) =>
          line.variantLabel.toLowerCase().includes(needle)
        );
        if (!nameMatch && !skuMatch) return false;
      }
      if (onlyFlagged) {
        return group.lines.some((line) => flaggedVariantIds.has(line.variantId));
      }
      return true;
    });
  }, [groups, filter, onlyFlagged, flaggedVariantIds]);

  const canPublish =
    includedLines.length > 0 && !needsSellabilityAck && !isSubmitting && !demoReadOnly;

  const handlePublish = (): void => {
    if (!canPublish) return;
    const items = buildBulkShopPublishItems(rows, config, masterStockByVariantId);
    if (items.length === 0) return;
    onPublish(items, status);
  };

  const publishLabel = isSubmitting
    ? 'Publishing…'
    : `Publish ${includedLines.length} ${includedLines.length === 1 ? 'listing' : 'listings'}`;

  return (
    <div className="bulk-shop-review" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {errorMessage ? <Alert tone="error">{errorMessage}</Alert> : null}

      <header className="bulk-review__header">
        <div className="bulk-review__intro">
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>Review shop listings</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 13 }}>
            Publishing {includedLines.length}{' '}
            {includedLines.length === 1 ? 'product listing' : 'product listings'} to{' '}
            <strong>{connection?.name ?? 'the selected shop'}</strong>. Stock and price come from
            each product's master values and the batch policy.
          </p>
        </div>
        {lines.length > 0 ? (
          <div className="bulk-review__toolbar">
            <Input
              type="search"
              placeholder="Filter products..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="bulk-review__filter"
              aria-label="Filter products by name or SKU"
            />
            <Button
              tone="primary"
              className="bulk-review__cta bulk-review__cta--top"
              disabled={!canPublish}
              onClick={handlePublish}
            >
              {publishLabel}
            </Button>
          </div>
        ) : null}
      </header>

      {lines.length > 0 ? (
        <div className="bulk-review__summary" role="status">
          <div className="ready">
            <span className="n">{counts.ready}</span> <span className="lbl">ready</span>
          </div>
          <div className="attn">
            <span className="n">{counts.needsAttention}</span>{' '}
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
                onChange={(e) => setOnlyFlagged(e.target.checked)}
              />
              Only flagged
            </label>
          </div>
        </div>
      ) : null}

      {lines.length > 0 ? (
        <div
          className={
            counts.needsAttention === 0 ? 'bulk-review__banner bulk-review__banner--ok' : 'bulk-review__banner'
          }
          role="status"
        >
          {counts.needsAttention === 0 ? (
            <>
              <b>All included listings are ready.</b> {counts.ready} listings will be published.
            </>
          ) : (
            <>
              <b>
                {counts.needsAttention}{' '}
                {counts.needsAttention === 1 ? 'listing needs' : 'listings need'} attention.
              </b>{' '}
              They will publish but can&apos;t be purchased until restocked - fix the stock via
              Edit, exclude the row, or confirm below to publish anyway.
            </>
          )}
        </div>
      ) : null}

      <div className="form-field">
        <span className="form-field__label">Visibility</span>
        <div className="segmented" role="group" aria-label="Visibility">
          <button
            type="button"
            className={
              status === 'draft' ? 'segmented__opt segmented__opt--active' : 'segmented__opt'
            }
            aria-pressed={status === 'draft'}
            onClick={() => setStatus('draft')}
          >
            <span className="segmented__dot segmented__dot--draft" aria-hidden="true" />
            Draft
          </button>
          <button
            type="button"
            className={
              status === 'published' ? 'segmented__opt segmented__opt--active' : 'segmented__opt'
            }
            aria-pressed={status === 'published'}
            onClick={() => setStatus('published')}
          >
            <span className="segmented__dot segmented__dot--pub" aria-hidden="true" />
            Published
          </button>
        </div>
      </div>

      {lines.length === 0 ? (
        <Alert tone="warning">
          No variants are included. Re-include at least one variant to publish.
        </Alert>
      ) : (
        <>
          {includedLines.length === 0 ? (
            <Alert tone="warning">
              No variants are included. Re-include at least one variant to publish.
            </Alert>
          ) : null}
          {outOfStockVariantIds.size > 0 ? (
            <Alert tone="warning">
              <b>
                {outOfStockVariantIds.size}{' '}
                {outOfStockVariantIds.size === 1 ? 'listing is' : 'listings are'} out of stock.
              </b>{' '}
              They will publish but can&apos;t be purchased until restocked. Fix the stock via Edit,
              exclude the row, or confirm to publish anyway.
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  marginTop: 8,
                  fontSize: 13,
                  fontWeight: 400,
                }}
              >
                <input
                  type="checkbox"
                  checked={acknowledgeOutOfStock}
                  onChange={(e) => setAcknowledgeOutOfStock(e.target.checked)}
                />
                Publish anyway - I understand these listings will be out of stock.
              </label>
            </Alert>
          ) : null}
          {filteredGroups.length === 0 ? (
            <Alert tone="info">No products match the current filter.</Alert>
          ) : (
            <div className="bulk-review__table">
              {/* Header is announced (not aria-hidden) so screen-reader users
                  get the column labels for the rows below - same reasoning as
                  the marketplace review's header (#1741 review #9). */}
              <div className="bulk-review__grid bulk-review__head">
                <span className="bulk-review__c-lead" />
                <span>Product</span>
                <span className="bulk-review__c-status">Status</span>
                <span className="bulk-review__c-stock">Stock</span>
                <span className="bulk-review__c-price">Price</span>
                <span className="bulk-review__c-action" />
              </div>

              {filteredGroups.map((group) => (
                <ShopProductRow
                  key={group.productId}
                  group={group}
                  currency={config.currency}
                  alreadyListedVariantIds={alreadyListedVariantIds}
                  destinationName={destinationName}
                  outOfStockVariantIds={outOfStockVariantIds}
                  open={expanded.has(group.productId)}
                  onToggleExpand={() => toggleExpand(group.productId)}
                  showEdit={isShopDestination}
                  onEdit={(focusVariantId) => setEditing({ productId: group.productId, focusVariantId })}
                  onSetVariantIncluded={onSetVariantIncluded}
                />
              ))}
            </div>
          )}
        </>
      )}

      <footer className="bulk-wizard__footer">
        <Button tone="ghost" onClick={onBack}>
          ← Back
        </Button>
        <div className="bulk-wizard__footer-spacer" />
        <ReadOnlyLock active={demoReadOnly} message={DEMO_READ_ONLY_ACTION_MESSAGE}>
          <Button tone="primary" disabled={!canPublish} onClick={handlePublish}>
            {publishLabel}
          </Button>
        </ReadOnlyLock>
      </footer>

      {editingRow && connection && isShopDestination ? (
        <BulkEditModal
          open={editing !== null}
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          row={editingRow}
          connection={connection}
          destinationKind="shop"
          canBrowseCategories={false}
          canBrowseShopCategories={canBrowseShopCategories}
          canPickShopAttributes={canPickShopAttributes}
          currency={config.currency}
          defaults={{ publishImmediately: config.publishImmediately }}
          pricingPolicy={config.pricingPolicy}
          stockPolicy={config.stockPolicy}
          focusVariantId={editing?.focusVariantId}
          demoReadOnly={demoReadOnly}
          onSave={onSaveEditor}
        />
      ) : null}
    </div>
  );
}

/** Aggregate readiness pill for a collapsed multi-variant group header -
 *  mirrors the marketplace review's `AggregateChips` ("N ready" / "N
 *  attention" / "N off"). */
function ShopAggregateChip({
  lines,
  outOfStockVariantIds,
}: {
  lines: ShopReviewLine[];
  outOfStockVariantIds: ReadonlySet<string>;
}): ReactElement {
  let ready = 0;
  let attn = 0;
  let off = 0;
  for (const line of lines) {
    if (!line.included) off += 1;
    else if (outOfStockVariantIds.has(line.variantId)) attn += 1;
    else ready += 1;
  }
  return (
    <>
      {ready > 0 ? (
        <span className="bulk-chip bulk-chip--success">
          <span className="bulk-chip__dot" aria-hidden="true" />
          {ready} ready
        </span>
      ) : null}
      {attn > 0 ? (
        <span className="bulk-chip bulk-chip--warning">
          <span className="bulk-chip__dot" aria-hidden="true" />
          {attn} attention
        </span>
      ) : null}
      {off > 0 ? (
        <span className="bulk-chip bulk-chip--neutral">
          <span className="bulk-chip__dot" aria-hidden="true" />
          {off} off
        </span>
      ) : null}
    </>
  );
}

interface ShopProductRowProps {
  group: ShopReviewGroup;
  currency: string;
  alreadyListedVariantIds: ReadonlySet<string>;
  destinationName: string;
  outOfStockVariantIds: ReadonlySet<string>;
  open: boolean;
  onToggleExpand: () => void;
  showEdit: boolean;
  onEdit: (focusVariantId?: string) => void;
  onSetVariantIncluded: (productId: string, variantId: string, included: boolean) => void;
}

/** One product row - structural + visual parity with the marketplace
 *  review's `ProductRow`: the SAME `.bulk-review__grid` column layout (lead /
 *  product / status / stock / price / action), a flat row with no caret for a
 *  single-variant product, or a group header (tri-state `CheckboxCell` +
 *  expand caret) with nested `.bulk-review__vrows` sub-rows for a
 *  multi-variant product (#1838). */
function ShopProductRow({
  group,
  currency,
  alreadyListedVariantIds,
  destinationName,
  outOfStockVariantIds,
  open,
  onToggleExpand,
  showEdit,
  onEdit,
  onSetVariantIncluded,
}: ShopProductRowProps): ReactElement {
  const { productId, productName, productImage, isMulti, lines } = group;
  const soleLine = !isMulti ? lines[0] : null;
  const includedCount = lines.filter((l) => l.included).length;
  const allExcluded = lines.length > 0 && includedCount === 0;
  const anyAlreadyListed = lines.some((l) => alreadyListedVariantIds.has(l.variantId));
  const displayedPrice = isMulti ? (lines[0]?.price ?? null) : (soleLine?.price ?? null);

  const mainClass = [
    'bulk-review__grid',
    'bulk-review__prow-main',
    !isMulti ? 'bulk-review__prow-main--flat' : '',
    allExcluded ? 'bulk-review__prow-main--excluded' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={open ? 'bulk-review__prow bulk-review__prow--open' : 'bulk-review__prow'}
      data-product-row={productId}
    >
      <div className={mainClass}>
        <span className="bulk-review__c-lead bulk-review__lead">
          {isMulti ? (
            <CheckboxCell
              state={includedCount === 0 ? 'none' : includedCount === lines.length ? 'all' : 'some'}
              ariaLabel={`Include all ${productName} variants`}
              onToggle={() => {
                const nextIncluded = includedCount !== lines.length;
                for (const line of lines) {
                  onSetVariantIncluded(line.productId, line.variantId, nextIncluded);
                }
              }}
            />
          ) : soleLine ? (
            <input
              type="checkbox"
              className="bulk-review__chk"
              checked={soleLine.included}
              onChange={(e) =>
                onSetVariantIncluded(soleLine.productId, soleLine.variantId, e.target.checked)
              }
              aria-label={`Include ${productName} - ${soleLine.variantLabel}`}
            />
          ) : null}
          {isMulti ? (
            <button
              type="button"
              className="bulk-review__toggle"
              aria-expanded={open}
              aria-label={`${open ? 'Collapse' : 'Expand'} ${productName} variants`}
              onClick={onToggleExpand}
            >
              <span className="bulk-review__caret" aria-hidden="true">
                &#9656;
              </span>
            </button>
          ) : null}
        </span>
        <div className="bulk-review__name">
          <ProductThumbnail
            src={productImage ?? undefined}
            name={productName}
            className="bulk-review__thumb"
          />
          <div className="t">
            <b>{productName}</b>
            <small>
              {isMulti
                ? `${lines.length} variants`
                : soleLine?.variantSku
                  ? `${soleLine.variantSku} · 1 variant`
                  : '1 variant'}
            </small>
            {/* A single-variant product publishes from THIS row - its variant row
                is never rendered - so without the disclosure here the #2200 gap
                stayed open for exactly the simplest, most common case. Mirrors
                how this row already carries the sole line's chips and price. */}
            {soleLine ? (
              <details className="bulk-review__desc">
                <summary>Description</summary>
                <RichTextView
                  html={soleLine.description}
                  emptyLabel={describeEmptyDescription(soleLine.description)}
                />
              </details>
            ) : null}
          </div>
        </div>
        <div className="bulk-review__c-status bulk-review__chips">
          {isMulti ? (
            <>
              <ShopAggregateChip lines={lines} outOfStockVariantIds={outOfStockVariantIds} />
              {anyAlreadyListed ? (
                <AlreadyListedChip
                  destinationName={destinationName}
                  title={`already on ${destinationName} - publishing updates it`}
                />
              ) : null}
            </>
          ) : soleLine ? (
            <>
              <ShopStatusPill
                included={soleLine.included}
                outOfStock={outOfStockVariantIds.has(soleLine.variantId)}
              />
              {alreadyListedVariantIds.has(soleLine.variantId) ? (
                <AlreadyListedChip
                  destinationName={destinationName}
                  title={`already on ${destinationName} - publishing updates it`}
                />
              ) : null}
            </>
          ) : null}
        </div>
        <div
          className={
            isMulti ? 'bulk-review__c-stock tabular bulk-review__c-stock--note' : 'bulk-review__c-stock tabular'
          }
        >
          {isMulti ? 'per variant' : (soleLine?.stock ?? 0)}
        </div>
        <div className="bulk-review__c-price tabular">
          {displayedPrice !== null ? `${displayedPrice} ${currency}` : 'from master'}
        </div>
        <div className="bulk-review__c-action">
          {showEdit ? (
            !isMulti ? (
              <Button
                tone="ghost"
                className="button--xs bulk-review__edit"
                aria-label={`Edit ${productName}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(soleLine?.variantId);
                }}
              >
                Edit
              </Button>
            ) : (
              <Button
                tone="ghost"
                className="button--xs bulk-review__edit"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(undefined);
                }}
              >
                Edit
              </Button>
            )
          ) : null}
        </div>
      </div>

      {isMulti && open ? (
        <div className="bulk-review__vrows bulk-shop-review__vrows">
          {lines.map((line) => (
            <ShopVariantRow
              key={line.variantId}
              line={line}
              currency={currency}
              alreadyListed={alreadyListedVariantIds.has(line.variantId)}
              destinationName={destinationName}
              outOfStock={outOfStockVariantIds.has(line.variantId)}
              showEdit={showEdit}
              onEdit={() => onEdit(line.variantId)}
              onSetIncluded={(included) =>
                onSetVariantIncluded(line.productId, line.variantId, included)
              }
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

interface ShopVariantRowProps {
  line: ShopReviewLine;
  currency: string;
  alreadyListed: boolean;
  destinationName: string;
  outOfStock: boolean;
  showEdit: boolean;
  onEdit: () => void;
  onSetIncluded: (included: boolean) => void;
}

/** One variant sub-row nested under an expanded multi-variant product row
 *  (#1838). Structural + visual parity with the marketplace review's
 *  `VariantRow`: a leading `.bulk-review__chk` include checkbox, then a
 *  status pill (ready / needs attention / excluded) sitting inline next to
 *  the "already on {destination}" chip in the STATUS column - reusing the
 *  marketplace's `.bulk-chip` classes verbatim. */
function ShopVariantRow({
  line,
  currency,
  alreadyListed,
  destinationName,
  outOfStock,
  showEdit,
  onEdit,
  onSetIncluded,
}: ShopVariantRowProps): ReactElement {
  return (
    <div
      className={
        line.included
          ? 'bulk-review__grid bulk-review__vrow'
          : 'bulk-review__grid bulk-review__vrow bulk-review__vrow--excluded'
      }
    >
      <span className="bulk-review__c-lead" />
      <div className="bulk-review__name">
        <input
          type="checkbox"
          className="bulk-review__chk"
          checked={line.included}
          onChange={(e) => onSetIncluded(e.target.checked)}
          aria-label={`Include ${line.productName} - ${line.variantLabel}`}
        />
        <div className="t">
          <b>{line.variantLabel}</b>
          {line.variantSku ? <small>{line.variantSku}</small> : null}
          {/* #2200: the Review step resolved which description each row would
              publish and then never showed it - an operator submitted copy to a
              live shop without ever seeing it rendered. (The MARKETPLACE Review
              step deliberately carries no description: an offer's copy is
              authored and reviewed in the row editor.) Collapsed by
              default so the dense grid keeps its shape, matching the
              listing-detail "Description preview" disclosure. */}
          <details className="bulk-review__desc">
            <summary>Description</summary>
            <RichTextView
              html={line.description}
              emptyLabel={describeEmptyDescription(line.description)}
            />
          </details>
        </div>
      </div>
      <div className="bulk-review__c-status bulk-review__chips">
        <ShopStatusPill included={line.included} outOfStock={outOfStock} />
        {alreadyListed ? (
          <AlreadyListedChip
            destinationName={destinationName}
            title={`already on ${destinationName} - publishing updates it`}
          />
        ) : null}
      </div>
      <div className="bulk-review__c-stock tabular">{line.stock ?? 0}</div>
      <div className="bulk-review__c-price tabular">
        {line.price !== null ? `${line.price} ${currency}` : 'from master'}
      </div>
      <div className="bulk-review__c-action">
        {showEdit ? (
          <Button tone="ghost" className="button--xs bulk-review__edit" onClick={onEdit}>
            Edit
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** Per-row readiness pill - green "ready" / amber "needs attention" (out of
 *  stock today; the same slot future required-to-sell rules, e.g. missing
 *  weight/dimensions, will plug into) / neutral "excluded" - the exact
 *  `.bulk-chip` classes + tones the marketplace review's `VariantChips` use. */
function ShopStatusPill({
  included,
  outOfStock,
}: {
  included: boolean;
  outOfStock: boolean;
}): ReactElement {
  if (!included) {
    return (
      <span className="bulk-chip bulk-chip--neutral">
        <span className="bulk-chip__dot" aria-hidden="true" />
        excluded
      </span>
    );
  }
  if (outOfStock) {
    return (
      <span
        className="bulk-chip bulk-chip--warning"
        title="Out of stock - will publish but cannot be purchased until restocked"
      >
        <span className="bulk-chip__dot" aria-hidden="true" />
        needs attention
      </span>
    );
  }
  return (
    <span className="bulk-chip bulk-chip--success">
      <span className="bulk-chip__dot" aria-hidden="true" />
      ready
    </span>
  );
}
