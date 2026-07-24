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
 * Visual parity with the marketplace `BulkReviewStep` (#1838 whole-epic
 * review): same section-heading/description block, filter + top CTA header
 * toolbar, ready/needs-attention/excluded summary bar and readiness banner,
 * per-row checkbox (`.bulk-review__chk`) and status pill (`.bulk-chip`) reused
 * verbatim from the marketplace review step - only the underlying readiness
 * rule differs (shop: stock only, via `checkShopLineSellability`; marketplace:
 * category/EAN/param blockers). Rows still group by product with
 * expand/collapse for a multi-variant product, plus a filter box and an "only
 * flagged" toggle (flagged = out of stock OR already-listed).
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';

import { Alert, Button, CheckboxCell, Input } from '../../../../shared/ui';
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
  variantId: string;
  variantLabel: string;
  included: boolean;
  /** Policy-resolved published quantity; null when unresolved (shown as 0). */
  stock: number | null;
  /** Policy-resolved price; null when it falls back to master server-side. */
  price: number | null;
}

/** Product-grouped lines (#1838) - a product with 2+ lines to review renders
 *  as an expand/collapse group; a single-variant product renders flat with no
 *  caret, mirroring the marketplace `BulkReviewStep` isSimple/isMulti split. */
interface ShopReviewGroup {
  productId: string;
  productName: string;
  isMulti: boolean;
  lines: ShopReviewLine[];
}

function groupReviewLines(lines: ShopReviewLine[]): ShopReviewGroup[] {
  const groups = new Map<string, ShopReviewGroup>();
  for (const line of lines) {
    let group = groups.get(line.productId);
    if (!group) {
      group = { productId: line.productId, productName: line.productName, isMulti: false, lines: [] };
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
          variantId: variant.variantId,
          variantLabel: variantDisplayLabel(variant),
          included: variant.included,
          stock: stock.value,
          price: price.value,
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
            <ul className="bulk-shop-review__list">
              {filteredGroups.map((group) =>
                !group.isMulti ? (
                  group.lines.map((line) => (
                    <ShopReviewLineRow
                      key={line.variantId}
                      line={line}
                      currency={config.currency}
                      alreadyListed={alreadyListedVariantIds.has(line.variantId)}
                      destinationName={destinationName}
                      outOfStock={outOfStockVariantIds.has(line.variantId)}
                      showEdit={isShopDestination}
                      onEdit={() =>
                        setEditing({ productId: line.productId, focusVariantId: line.variantId })
                      }
                      onSetIncluded={(included) =>
                        onSetVariantIncluded(line.productId, line.variantId, included)
                      }
                    />
                  ))
                ) : (
                  <li key={group.productId} className="bulk-shop-review__group">
                    <div className="bulk-shop-review__row bulk-shop-review__group-head">
                      <span className="bulk-review__lead">
                        <CheckboxCell
                          state={
                            group.lines.every((l) => l.included)
                              ? 'all'
                              : group.lines.some((l) => l.included)
                                ? 'some'
                                : 'none'
                          }
                          ariaLabel={`Include all ${group.productName} variants`}
                          onToggle={() => {
                            const nextIncluded = !group.lines.every((l) => l.included);
                            for (const line of group.lines) {
                              onSetVariantIncluded(line.productId, line.variantId, nextIncluded);
                            }
                          }}
                        />
                        <button
                          type="button"
                          className="bulk-review__toggle"
                          aria-expanded={expanded.has(group.productId)}
                          aria-label={`${expanded.has(group.productId) ? 'Collapse' : 'Expand'} ${
                            group.productName
                          } variants`}
                          onClick={() => toggleExpand(group.productId)}
                        >
                          <span className="bulk-review__caret" aria-hidden="true">
                            &#9656;
                          </span>
                        </button>
                      </span>
                      <div className="bulk-shop-review__row-main">
                        <b>{group.productName}</b>
                        <small className="mono-text muted-text">
                          {group.lines.length} variants
                        </small>
                        <ShopAggregateChip lines={group.lines} outOfStockVariantIds={outOfStockVariantIds} />
                        {group.lines.some((l) => alreadyListedVariantIds.has(l.variantId)) ? (
                          <AlreadyListedChip
                            destinationName={destinationName}
                            title={`already on ${destinationName} - publishing updates it`}
                          />
                        ) : null}
                      </div>
                    </div>
                    {expanded.has(group.productId) ? (
                      <ul className="bulk-shop-review__vrows">
                        {group.lines.map((line) => (
                          <ShopReviewLineRow
                            key={line.variantId}
                            line={line}
                            currency={config.currency}
                            alreadyListed={alreadyListedVariantIds.has(line.variantId)}
                            destinationName={destinationName}
                            outOfStock={outOfStockVariantIds.has(line.variantId)}
                            showEdit={isShopDestination}
                            onEdit={() =>
                              setEditing({
                                productId: line.productId,
                                focusVariantId: line.variantId,
                              })
                            }
                            onSetIncluded={(included) =>
                              onSetVariantIncluded(line.productId, line.variantId, included)
                            }
                          />
                        ))}
                      </ul>
                    ) : null}
                  </li>
                )
              )}
            </ul>
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

interface ShopReviewLineRowProps {
  line: ShopReviewLine;
  currency: string;
  alreadyListed: boolean;
  destinationName: string;
  outOfStock: boolean;
  showEdit: boolean;
  onEdit: () => void;
  onSetIncluded: (included: boolean) => void;
}

/** One variant line - flat under a single-variant product, or nested inside
 *  an expanded multi-variant group (#1838). Structural + visual parity with
 *  the marketplace review's `VariantRow`: a leading `.bulk-review__chk`
 *  include checkbox, then a status pill (ready / needs attention / excluded)
 *  reusing the marketplace's `.bulk-chip` classes. */
function ShopReviewLineRow({
  line,
  currency,
  alreadyListed,
  destinationName,
  outOfStock,
  showEdit,
  onEdit,
  onSetIncluded,
}: ShopReviewLineRowProps): ReactElement {
  return (
    <li
      className={
        line.included
          ? 'bulk-shop-review__row'
          : 'bulk-shop-review__row bulk-review__vrow--excluded'
      }
    >
      <input
        type="checkbox"
        className="bulk-review__chk"
        checked={line.included}
        onChange={(e) => onSetIncluded(e.target.checked)}
        aria-label={`Include ${line.productName} - ${line.variantLabel}`}
      />
      <div className="bulk-shop-review__row-main">
        <b>{line.productName}</b>
        <small className="mono-text muted-text">{line.variantLabel}</small>
        <ShopStatusPill included={line.included} outOfStock={outOfStock} />
        {alreadyListed ? (
          <AlreadyListedChip
            destinationName={destinationName}
            title={`already on ${destinationName} - publishing updates it`}
          />
        ) : null}
      </div>
      <span className="bulk-shop-review__cell mono-text tabular" aria-label="Stock">
        <span className="bulk-shop-review__cell-label">stock</span>
        {line.stock ?? 0}
      </span>
      <span className="bulk-shop-review__cell mono-text tabular" aria-label="Price">
        <span className="bulk-shop-review__cell-label">price</span>
        {line.price !== null ? `${line.price} ${currency}` : 'from master'}
      </span>
      {showEdit ? (
        <Button
          tone="ghost"
          className="button--xs bulk-shop-review__edit"
          aria-label={`Edit ${line.productName}`}
          onClick={onEdit}
        >
          Edit
        </Button>
      ) : null}
    </li>
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
