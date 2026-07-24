/**
 * Bulk wizard Shop Review step (#1829)
 *
 * The `ProductPublisher` (online shop) branch of the bulk wizard. Shops have no
 * marketplace category/EAN resolution, so the wizard skips the Resolve step and
 * lands here straight from Config. This step reviews the included variants of
 * the seeded rows, computes each one's stock (from master availability + the
 * batch stock policy) and price (from the variant master price + the batch
 * pricing policy), lets the operator flip visibility (draft / published) and
 * exclude variants, then submits one `bulk-shop-publish` item per included
 * variant.
 *
 * Per-product content / category / attribute editing lands via the shared
 * two-pane editor (#1830, shop mode) opened from each row's Edit button; the
 * overrides it saves round-trip through each item's `content` /
 * `destinationCategoryIds` / `parameters` (backed by the #1831 transport).
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';

import { Alert, Button } from '../../../../shared/ui';
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

/** A flattened included variant paired with its owning product for display.
 *  The displayed `stock` / `price` are the SAME policy-resolved values the
 *  submit sends (see `buildBulkShopPublishItems`), so review == publish. */
interface ShopReviewLine {
  productId: string;
  productName: string;
  variantId: string;
  variantLabel: string;
  /** Policy-resolved published quantity; null when unresolved (shown as 0). */
  stock: number | null;
  /** Policy-resolved price; null when it falls back to master server-side. */
  price: number | null;
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

  const lines = useMemo<ShopReviewLine[]>(() => {
    const out: ShopReviewLine[] = [];
    for (const row of rows) {
      for (const variant of row.variants) {
        if (!variant.included) continue;
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
          stock: stock.value,
          price: price.value,
        });
      }
    }
    return out;
  }, [rows, config.stockPolicy, config.pricingPolicy, masterStockByVariantId]);

  // Required-to-sell preflight (#1842): a listing that publishes with zero
  // stock is live but unbuyable. Soft-block - surfaced per row + a batch
  // banner, overridable via the acknowledgement checkbox below.
  const outOfStockVariantIds = useMemo(
    () =>
      new Set(
        lines
          .filter((line) => checkShopLineSellability(line.stock ?? 0).length > 0)
          .map((line) => line.variantId)
      ),
    [lines]
  );
  const needsSellabilityAck = outOfStockVariantIds.size > 0 && !acknowledgeOutOfStock;

  // Re-arm the confirmation whenever the out-of-stock set changes (fixed via
  // the editor, or a different variant went out of stock) so a stale tick
  // never silently covers a new issue.
  useEffect(() => {
    setAcknowledgeOutOfStock(false);
  }, [outOfStockVariantIds.size]);

  const handlePublish = (): void => {
    if (needsSellabilityAck) return;
    const items = buildBulkShopPublishItems(rows, config, masterStockByVariantId);
    if (items.length === 0) return;
    onPublish(items, status);
  };

  return (
    <div className="bulk-shop-review">
      {errorMessage ? <Alert tone="error">{errorMessage}</Alert> : null}

      <header>
        <h2
          style={{
            margin: 0,
            fontSize: 17,
            fontWeight: 600,
            letterSpacing: 'var(--tracking-tight)',
          }}
        >
          Review shop listings
        </h2>
        <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 13 }}>
          Publishing {lines.length} {lines.length === 1 ? 'product listing' : 'product listings'} to{' '}
          <strong>{connection?.name ?? 'the selected shop'}</strong>. Stock and price come from each
          product's master values and the batch policy.
        </p>
      </header>

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
          <ul className="bulk-shop-review__list">
            {lines.map((line) => (
              <li key={line.variantId} className="bulk-shop-review__row">
                <div className="bulk-shop-review__row-main">
                  <b>{line.productName}</b>
                  <small className="mono-text muted-text">{line.variantLabel}</small>
                  {alreadyListedVariantIds.has(line.variantId) ? (
                    <span
                      className="bulk-chip bulk-chip--neutral"
                      title={`already on ${destinationName} - publishing updates it`}
                    >
                      <span className="bulk-chip__dot" />
                      already on {destinationName}
                    </span>
                  ) : null}
                  {outOfStockVariantIds.has(line.variantId) ? (
                    <span
                      className="bulk-chip bulk-chip--warning"
                      title="Out of stock - will publish but cannot be purchased until restocked"
                    >
                      <span className="bulk-chip__dot" />
                      out of stock
                    </span>
                  ) : null}
                </div>
                <span className="bulk-shop-review__cell mono-text tabular" aria-label="Stock">
                  <span className="bulk-shop-review__cell-label">stock</span>
                  {line.stock ?? 0}
                </span>
                <span className="bulk-shop-review__cell mono-text tabular" aria-label="Price">
                  <span className="bulk-shop-review__cell-label">price</span>
                  {line.price !== null ? `${line.price} ${config.currency}` : 'from master'}
                </span>
                {isShopDestination ? (
                  <Button
                    tone="ghost"
                    className="button--xs bulk-shop-review__edit"
                    aria-label={`Edit ${line.productName}`}
                    onClick={() =>
                      setEditing({ productId: line.productId, focusVariantId: line.variantId })
                    }
                  >
                    Edit
                  </Button>
                ) : null}
                <button
                  type="button"
                  className="bulk-shop-review__remove"
                  aria-label={`Remove ${line.productName} - ${line.variantLabel}`}
                  onClick={() => onSetVariantIncluded(line.productId, line.variantId, false)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <footer className="bulk-wizard__footer">
        <Button tone="ghost" onClick={onBack}>
          ← Back
        </Button>
        <div className="bulk-wizard__footer-spacer" />
        <ReadOnlyLock active={demoReadOnly} message={DEMO_READ_ONLY_ACTION_MESSAGE}>
          <Button
            tone="primary"
            disabled={isSubmitting || demoReadOnly || lines.length === 0 || needsSellabilityAck}
            onClick={handlePublish}
          >
            {isSubmitting
              ? 'Publishing…'
              : `Publish ${lines.length} ${lines.length === 1 ? 'listing' : 'listings'}`}
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
