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
 * Per-item stock/price *editing* is intentionally out of scope here - the
 * current `bulk-shop-publish` endpoint takes computed values, and #1831
 * enriches the per-item payload + editing surface.
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import { useMemo, useState, type ReactElement } from 'react';

import { Alert, Button } from '../../../../shared/ui';
import { ReadOnlyLock } from '../../../../shared/ui/read-only-lock';
import { DEMO_READ_ONLY_ACTION_MESSAGE } from '../../../../shared/config/demo-mode';
import { useInventoryAvailabilityBatchQuery } from '../../../inventory';
import type { Connection } from '../../../connections';
import type { BulkShopPublishItemRequest } from '../../api/listings.types';
import { computeResolvedPrice, computeResolvedStock } from './bulk-policy';
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
 * Build one `bulk-shop-publish` item per included variant. Stock resolves from
 * master availability + the batch stock policy; price from the variant master
 * price + the batch pricing policy. A null resolved price is omitted (the shop
 * builder falls back to master at publish time); a null resolved stock sends 0.
 */
export function buildBulkShopPublishItems(
  rows: BulkWizardRow[],
  config: BulkWizardConfig,
  masterStockByVariantId: ReadonlyMap<string, number>,
): BulkShopPublishItemRequest[] {
  const items: BulkShopPublishItemRequest[] = [];
  for (const row of rows) {
    for (const variant of row.variants) {
      if (!variant.included) continue;
      const masterStock = masterStockByVariantId.get(variant.variantId) ?? variant.masterStock;
      const stock = computeResolvedStock(config.stockPolicy, masterStock, variant.override);
      const price = computeResolvedPrice(config.pricingPolicy, variant.masterPrice, variant.override);
      items.push({
        internalVariantId: variant.variantId,
        stock: stock.value ?? 0,
        ...(price.value !== null
          ? { price: { amount: price.value, currency: config.currency } }
          : {}),
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
}: BulkShopReviewStepProps): ReactElement {
  const [status, setStatus] = useState<ShopPublishVisibility>(
    config.publishImmediately ? 'published' : 'draft',
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
        (availabilityQuery.data?.items ?? []).map((i) => [i.productVariantId, i.totalAvailable]),
      ),
    [availabilityQuery.data],
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
        const price = computeResolvedPrice(config.pricingPolicy, variant.masterPrice, variant.override);
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

  const handlePublish = (): void => {
    const items = buildBulkShopPublishItems(rows, config, masterStockByVariantId);
    if (items.length === 0) return;
    onPublish(items, status);
  };

  return (
    <div className="bulk-shop-review">
      {errorMessage ? <Alert tone="error">{errorMessage}</Alert> : null}

      <header>
        <h2
          style={{ margin: 0, fontSize: 17, fontWeight: 600, letterSpacing: 'var(--tracking-tight)' }}
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
              </div>
              <span className="bulk-shop-review__cell mono-text tabular" aria-label="Stock">
                <span className="bulk-shop-review__cell-label">stock</span>
                {line.stock ?? 0}
              </span>
              <span className="bulk-shop-review__cell mono-text tabular" aria-label="Price">
                <span className="bulk-shop-review__cell-label">price</span>
                {line.price !== null ? `${line.price} ${config.currency}` : 'from master'}
              </span>
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
      )}

      <footer className="bulk-wizard__footer">
        <Button tone="ghost" onClick={onBack}>
          ← Back
        </Button>
        <div className="bulk-wizard__footer-spacer" />
        <ReadOnlyLock active={demoReadOnly} message={DEMO_READ_ONLY_ACTION_MESSAGE}>
          <Button
            tone="primary"
            disabled={isSubmitting || demoReadOnly || lines.length === 0}
            onClick={handlePublish}
          >
            {isSubmitting
              ? 'Publishing…'
              : `Publish ${lines.length} ${lines.length === 1 ? 'listing' : 'listings'}`}
          </Button>
        </ReadOnlyLock>
      </footer>
    </div>
  );
}
