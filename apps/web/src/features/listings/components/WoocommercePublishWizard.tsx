/**
 * WoocommercePublishWizard
 *
 * Content-only shop-publish wizard for WooCommerce (#1044). The surrounding
 * `<Dialog>` chrome and connection selection live in `ShopPublishLauncher`;
 * this component receives the resolved `Connection` as a prop and renders
 * wizard body + footer actions directly.
 *
 * Two modes, driven by props:
 *   - **single** — `defaultVariantId` set: one product. Optional Review step
 *     before submit. Submits via `useShopPublishMutation`, reports
 *     `{ recordId }`.
 *   - **bulk** — `defaultVariantIds` (>1): one product per variant. Submits
 *     via `useBulkShopPublishMutation`, reports `{ batchId }`.
 *
 * Category placement, attributes, and images are resolved server-side from
 * the master product at publish time (the #1042 builder), so the wizard is
 * deliberately light — only visibility, stock, and an optional price
 * override are operator-editable.
 *
 * Retry-safe: a stable `x-idempotency-key` is generated once per mount
 * (`crypto.randomUUID()`) for the single path so the server returns the same
 * record on retry. The launcher unmounts + remounts on close/re-open, which
 * mints a fresh key naturally.
 *
 * @module apps/web/src/features/listings/components
 */
import { useMemo, useRef, useState, type ReactElement } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { FormErrorSummary } from '../../../shared/ui/form-error-summary';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { useToast } from '../../../shared/ui/toast-provider';
import { useDebouncedValue } from '../../../shared/hooks/use-debounced-value';
import type { Connection } from '../../connections';
import { useProductQuery, useProductsQuery } from '../../products';
import type { Product, ProductVariant } from '../../products';
import { useShopPublishMutation } from '../hooks/use-shop-publish-mutation';
import { useBulkShopPublishMutation } from '../hooks/use-bulk-shop-publish-mutation';
import type {
  BulkShopPublishRequest,
  ShopPublishContent,
  ShopPublishPrice,
  ShopPublishRequest,
} from '../api/listings.types';
import {
  WOOCOMMERCE_PUBLISH_BULK_DEFAULTS,
  WOOCOMMERCE_PUBLISH_SINGLE_DEFAULTS,
  woocommercePublishWizardSchema,
  type WoocommercePublishWizardSubmission,
  type WoocommercePublishWizardValues,
} from './woocommerce-publish-wizard.schema';

interface WoocommercePublishWizardProps {
  connection: Connection;
  defaultVariantId?: string;
  defaultVariantIds?: string[];
  onCancel: () => void;
  onSubmitted: (result: { recordId?: string; batchId?: string }, connectionId: string) => void;
}

const VARIANT_SEARCH_DEBOUNCE_MS = 300;
const VARIANT_PICKER_PAGE_SIZE = 10;

function variantLabel(product: Product, variant: ProductVariant): string {
  const attrs = variant.attributes ? Object.values(variant.attributes).join(' · ') : '';
  if (attrs) {
    return `${product.name} - ${attrs}`;
  }
  if (variant.sku) {
    return `${product.name} - ${variant.sku}`;
  }
  return product.name;
}

/** Whole-flow mode derived from the props the launcher passes. Bulk wins
 *  when more than one id is supplied; otherwise single. */
function resolveVariantIds(
  defaultVariantId?: string,
  defaultVariantIds?: string[],
): { ids: string[]; mode: 'single' | 'bulk' } {
  const bulkIds = (defaultVariantIds ?? []).filter(Boolean);
  if (bulkIds.length > 1) {
    return { ids: bulkIds, mode: 'bulk' };
  }
  if (bulkIds.length === 1) {
    return { ids: bulkIds, mode: 'single' };
  }
  return { ids: defaultVariantId ? [defaultVariantId] : [], mode: 'single' };
}

function buildPrice(values: WoocommercePublishWizardSubmission): ShopPublishPrice | undefined {
  if (values.priceAmount === '') return undefined;
  return { amount: Number(values.priceAmount), currency: values.priceCurrency };
}

function buildContent(): ShopPublishContent | undefined {
  // The #1042 builder resolves title / description / images from the master
  // product server-side; the wizard contributes none today.
  return undefined;
}

export function WoocommercePublishWizard({
  connection,
  defaultVariantId,
  defaultVariantIds,
  onCancel,
  onSubmitted,
}: WoocommercePublishWizardProps): ReactElement {
  const { ids, mode } = useMemo(
    () => resolveVariantIds(defaultVariantId, defaultVariantIds),
    [defaultVariantId, defaultVariantIds],
  );
  // The top-level "Publish to shop" CTA opens this wizard with no variant
  // context at all (no row/product to publish from). In that case the
  // operator has to search and pick one here instead of the field silently
  // rendering blank.
  const needsVariantPicker = mode === 'single' && ids.length === 0;

  const [pickedVariantId, setPickedVariantId] = useState<string | null>(null);
  const [pickedVariantLabel, setPickedVariantLabel] = useState<string | null>(null);
  const [productSearchInput, setProductSearchInput] = useState('');
  const [productOffset, setProductOffset] = useState(0);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const debouncedProductSearch = useDebouncedValue(productSearchInput, VARIANT_SEARCH_DEBOUNCE_MS);

  const productsQuery = useProductsQuery(
    { search: debouncedProductSearch || undefined },
    { limit: VARIANT_PICKER_PAGE_SIZE, offset: productOffset },
  );
  const productDetailQuery = useProductQuery(selectedProductId ?? '');

  const effectiveIds = ids.length > 0 ? ids : pickedVariantId ? [pickedVariantId] : [];

  function handleVariantPick(product: Product, variant: ProductVariant): void {
    setPickedVariantId(variant.id);
    setPickedVariantLabel(variantLabel(product, variant));
  }

  const singleMutation = useShopPublishMutation();
  const bulkMutation = useBulkShopPublishMutation();
  const { showToast } = useToast();
  const idempotencyKeyRef = useRef<string>(crypto.randomUUID());

  const [reviewing, setReviewing] = useState(false);

  const form = useForm<
    WoocommercePublishWizardValues,
    undefined,
    WoocommercePublishWizardSubmission
  >({
    defaultValues:
      mode === 'bulk' ? WOOCOMMERCE_PUBLISH_BULK_DEFAULTS : WOOCOMMERCE_PUBLISH_SINGLE_DEFAULTS,
    resolver: zodResolver(woocommercePublishWizardSchema),
    mode: 'onBlur',
  });

  const status = form.watch('status');
  const mutationError = mode === 'bulk' ? bulkMutation.error : singleMutation.error;
  const isPending = singleMutation.isPending || bulkMutation.isPending;

  const validationMessages = Object.values(form.formState.errors)
    .map((e) => e?.message)
    .filter((m): m is string => typeof m === 'string');

  const submit = form.handleSubmit(async (values) => {
    const stockValue = values.stock === '' ? 0 : Number(values.stock);
    const price = buildPrice(values);
    const content = buildContent();

    try {
      if (mode === 'bulk') {
        const request: BulkShopPublishRequest = {
          connectionId: connection.id,
          internalVariantIds: effectiveIds,
          status: values.status,
          stock: stockValue,
          ...(price ? { price } : {}),
          ...(content ? { content } : {}),
        };
        const result = await bulkMutation.mutateAsync({ request });
        showToast({
          tone: 'success',
          title: 'Bulk publish started',
          description: `Publishing ${effectiveIds.length} products to ${connection.name}.`,
        });
        onSubmitted({ batchId: result.batchId }, connection.id);
      } else {
        const request: ShopPublishRequest = {
          internalVariantId: effectiveIds[0],
          status: values.status,
          stock: stockValue,
          ...(price ? { price } : {}),
          ...(content ? { content } : {}),
        };
        const result = await singleMutation.mutateAsync({
          connectionId: connection.id,
          idempotencyKey: idempotencyKeyRef.current,
          request,
        });
        showToast({
          tone: 'success',
          title: 'Publish started',
          description: `Publishing to ${connection.name}.`,
        });
        onSubmitted({ recordId: result.listingCreationRecordId }, connection.id);
      }
    } catch {
      // API error surfaced via the Alert below.
    }
  });

  const visibilitySegmented = (
    <div className="segmented" role="group" aria-label="Visibility">
      <button
        type="button"
        className={status === 'draft' ? 'segmented__opt segmented__opt--active' : 'segmented__opt'}
        aria-pressed={status === 'draft'}
        onClick={() => form.setValue('status', 'draft', { shouldDirty: true })}
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
        onClick={() => form.setValue('status', 'published', { shouldDirty: true })}
      >
        <span className="segmented__dot segmented__dot--pub" aria-hidden="true" />
        Published
      </button>
    </div>
  );

  // ── Single-mode Review step ───────────────────────────────────────────
  if (mode === 'single' && reviewing) {
    const values = form.getValues();
    const priceLabel =
      values.priceAmount === '' ? 'from master' : `${values.priceAmount} ${values.priceCurrency}`;
    return (
      <form onSubmit={(e) => void submit(e)} noValidate className="wizard-card">
        <Button
          type="button"
          tone="ghost"
          className="button--sm wizard-card__back"
          onClick={() => setReviewing(false)}
        >
          ← Back
        </Button>
        {mutationError ? <Alert tone="error">{mutationError.message}</Alert> : null}
        <dl className="shop-publish-kv">
          <div className="shop-publish-kv__row">
            <dt>Shop</dt>
            <dd>{connection.name}</dd>
          </div>
          <div className="shop-publish-kv__row">
            <dt>Variant</dt>
            <dd>
              {pickedVariantLabel ? <div>{pickedVariantLabel}</div> : null}
              <span className="mono-text muted-text">{effectiveIds[0]}</span>
            </dd>
          </div>
          <div className="shop-publish-kv__row">
            <dt>Visibility</dt>
            <dd>
              <StatusBadge tone={values.status === 'published' ? 'success' : 'neutral'} withDot>
                {values.status === 'published' ? 'Published' : 'Draft'}
              </StatusBadge>
            </dd>
          </div>
          <div className="shop-publish-kv__row">
            <dt>Stock</dt>
            <dd className="mono-text">{values.stock === '' ? '0' : values.stock}</dd>
          </div>
          <div className="shop-publish-kv__row">
            <dt>Price</dt>
            <dd className="mono-text">{priceLabel}</dd>
          </div>
        </dl>
        <div className="wizard-actions">
          <div className="wizard-actions__group">
            <Button type="button" tone="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </div>
          <div className="wizard-actions__group">
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Publishing…' : 'Confirm & publish'}
            </Button>
          </div>
        </div>
      </form>
    );
  }

  // ── Form step (single + bulk share the field layout) ──────────────────
  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="wizard-card">
      {mutationError ? <Alert tone="error">{mutationError.message}</Alert> : null}
      {form.formState.submitCount > 0 && validationMessages.length > 0 ? (
        <FormErrorSummary errors={validationMessages} />
      ) : null}

      {mode === 'bulk' ? (
        <div className="form-field">
          <span className="form-field__label">
            Variants <span className="shop-publish-hint">{effectiveIds.length} selected</span>
          </span>
          <div className="shop-publish-chips">
            {effectiveIds.map((id) => (
              <span key={id} className="shop-publish-chip mono-text" title={id}>
                {id}
              </span>
            ))}
          </div>
        </div>
      ) : needsVariantPicker && pickedVariantId === null ? (
        <div className="form-field">
          <FormField
            label="Search products"
            name="productSearch"
            description="Search by product name, SKU, or EAN."
          >
            <Input
              value={productSearchInput}
              onChange={(e) => {
                setProductSearchInput(e.target.value);
                setProductOffset(0);
              }}
              placeholder="e.g. T-shirt, SKU-123, 5901234567890"
            />
          </FormField>

          <div className="create-offer-variant-picker">
            {productsQuery.isLoading ? (
              <p className="muted-text">Loading products…</p>
            ) : (productsQuery.data?.items.length ?? 0) === 0 ? (
              <p className="muted-text">No products match.</p>
            ) : (
              <ul className="create-offer-variant-picker__list">
                {(productsQuery.data?.items ?? []).map((product) => {
                  const isExpanded = selectedProductId === product.id;
                  return (
                    <li key={product.id} className="create-offer-variant-picker__product">
                      <button
                        type="button"
                        className="create-offer-variant-picker__product-row"
                        onClick={() => setSelectedProductId(isExpanded ? null : product.id)}
                        aria-expanded={isExpanded}
                      >
                        <span>{product.name}</span>
                        <span className="mono-text muted-text">{product.sku ?? '-'}</span>
                      </button>

                      {isExpanded ? (
                        <ul className="create-offer-variant-picker__variants">
                          {productDetailQuery.isLoading ? (
                            <li className="muted-text">Loading variants…</li>
                          ) : (productDetailQuery.data?.variants ?? []).length === 0 ? (
                            <li className="muted-text">No variants on this product.</li>
                          ) : (
                            (productDetailQuery.data?.variants ?? []).map((variant) => (
                              <li key={variant.id}>
                                <label className="create-offer-variant-picker__variant">
                                  <input
                                    type="radio"
                                    name="wooPublishVariantId"
                                    value={variant.id}
                                    checked={false}
                                    onChange={() =>
                                      handleVariantPick(productDetailQuery.data ?? product, variant)
                                    }
                                  />
                                  <span className="create-offer-variant-picker__variant-name">
                                    {variantLabel(productDetailQuery.data ?? product, variant)}
                                  </span>
                                  <span className="mono-text muted-text">
                                    SKU {variant.sku ?? '-'} · EAN {variant.ean ?? '-'}
                                  </span>
                                </label>
                              </li>
                            ))
                          )}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
            {(() => {
              const total = productsQuery.data?.total ?? 0;
              if (total <= VARIANT_PICKER_PAGE_SIZE) return null;
              const pageEnd = Math.min(productOffset + VARIANT_PICKER_PAGE_SIZE, total);
              return (
                <div className="create-offer-variant-picker__pagination">
                  <span className="muted-text">
                    {productOffset + 1}-{pageEnd} of {total}
                  </span>
                  <div className="create-offer-variant-picker__pagination-actions">
                    <Button
                      tone="secondary"
                      type="button"
                      aria-label="Previous page of products"
                      disabled={productOffset === 0}
                      onClick={() =>
                        setProductOffset((o) => Math.max(0, o - VARIANT_PICKER_PAGE_SIZE))
                      }
                    >
                      Previous
                    </Button>
                    <Button
                      tone="secondary"
                      type="button"
                      aria-label="Next page of products"
                      disabled={productOffset + VARIANT_PICKER_PAGE_SIZE >= total}
                      onClick={() => setProductOffset((o) => o + VARIANT_PICKER_PAGE_SIZE)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      ) : (
        <div className="form-field">
          <span className="form-field__label">Variant</span>
          <div className="shop-publish-variant-line">
            {pickedVariantLabel ? <span>{pickedVariantLabel}</span> : null}
            <span className="mono-text muted-text" title={effectiveIds[0]}>
              {effectiveIds[0]}
            </span>
            {needsVariantPicker ? (
              <Button
                type="button"
                tone="ghost"
                className="button--sm"
                onClick={() => {
                  setPickedVariantId(null);
                  setPickedVariantLabel(null);
                }}
              >
                Change
              </Button>
            ) : null}
          </div>
        </div>
      )}

      <div className="form-field">
        <span className="form-field__label">
          Visibility{' '}
          {mode === 'bulk' ? <span className="shop-publish-hint">applies to all</span> : null}
        </span>
        {visibilitySegmented}
        {mode === 'single' ? (
          <p className="form-field__description">
            Draft creates the product hidden; Published lists it live on the storefront.
          </p>
        ) : null}
      </div>

      <div className="shop-publish-field-row">
        <FormField
          label={
            <>
              Stock{' '}
              {mode === 'bulk' ? (
                <span className="shop-publish-hint">per master if blank</span>
              ) : null}
            </>
          }
          name="stock"
          error={form.formState.errors.stock?.message}
        >
          <Input
            inputMode="numeric"
            className="input--mono"
            placeholder={mode === 'bulk' ? 'from master' : '0'}
            {...form.register('stock')}
          />
        </FormField>
        <FormField
          label={
            <>
              Price override <span className="shop-publish-hint">optional</span>
            </>
          }
          name="priceAmount"
          error={form.formState.errors.priceAmount?.message}
        >
          <div className="shop-publish-affix">
            <span className="shop-publish-affix__pre mono-text">{form.watch('priceCurrency')}</span>
            <Input
              inputMode="decimal"
              className="input--mono shop-publish-affix__input"
              placeholder="from master"
              {...form.register('priceAmount')}
            />
          </div>
        </FormField>
      </div>

      {mode === 'bulk' ? (
        <Alert tone="info">
          Each variant publishes as its own simple WooCommerce product. Out-of-stock variants list
          with their master stock (0 is honored).
        </Alert>
      ) : (
        <div className="shop-publish-callout">
          Category placement, attributes &amp; images are resolved from the master product at
          publish time — nothing to pick here. Provisioned to the mirrored WooCommerce category
          tree.
        </div>
      )}

      <div className="wizard-actions">
        <div className="wizard-actions__group">
          <Button type="button" tone="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
        <div className="wizard-actions__group">
          {mode === 'single' ? (
            <Button
              type="button"
              tone="secondary"
              disabled={isPending || effectiveIds.length === 0}
              onClick={() => {
                void form.trigger().then((ok) => {
                  if (ok) setReviewing(true);
                });
              }}
            >
              Review
            </Button>
          ) : null}
          <Button type="submit" disabled={isPending || effectiveIds.length === 0}>
            {isPending
              ? 'Publishing…'
              : mode === 'bulk'
                ? `Publish ${effectiveIds.length} products`
                : 'Publish'}
          </Button>
        </div>
      </div>
    </form>
  );
}
