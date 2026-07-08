/**
 * WoocommercePublishWizard
 *
 * Content-only shop-publish wizard for WooCommerce (#1044). The surrounding
 * `<Dialog>` chrome and connection selection live in `ShopPublishLauncher`;
 * this component receives the resolved `Connection` as a prop and renders
 * wizard body + footer actions directly.
 *
 * Two modes, resolved from props OR from the in-dialog picker when the
 * top-level "Publish to shop" CTA opens with no variant context at all:
 *   - **single** — one product. Optional Review step before submit. Submits
 *     via `useShopPublishMutation`, reports `{ recordId }`.
 *   - **bulk** — 2+ products, one per variant. Each product gets its own
 *     Stock + Price override row in Configure (#1414 — these are independent
 *     publish decisions, not one shared value for the batch). Submits via
 *     `useBulkShopPublishMutation`, reports `{ batchId }`.
 *
 * When entered with no `defaultVariantId(s)` (the top-level CTA), the wizard
 * runs a **selection step** first: search + checkbox multi-select collecting
 * into a persistent tray, then "Continue" locks in single vs. bulk mode based
 * on how many variants were checked. Entering with props already set
 * (row-level "Publish"/bulk actions) skips straight to Configure, unchanged.
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
import { useFieldArray, useForm } from 'react-hook-form';
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
  BulkShopPublishItemRequest,
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

type PublishMode = 'single' | 'bulk';

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

/** Ids supplied directly by props (row-level "Publish"/bulk actions). Empty
 *  when the top-level CTA opened with no variant context — the operator picks
 *  via the in-dialog selection step instead. */
function resolvePropsIds(defaultVariantId?: string, defaultVariantIds?: string[]): string[] {
  const bulkIds = (defaultVariantIds ?? []).filter(Boolean);
  if (bulkIds.length > 0) return bulkIds;
  return defaultVariantId ? [defaultVariantId] : [];
}

function modeForIds(ids: string[]): PublishMode {
  return ids.length > 1 ? 'bulk' : 'single';
}

function buildPrice(
  priceAmount: string,
  priceCurrency: string,
): ShopPublishPrice | undefined {
  if (priceAmount === '') return undefined;
  return { amount: Number(priceAmount), currency: priceCurrency };
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
  const propsIds = useMemo(
    () => resolvePropsIds(defaultVariantId, defaultVariantIds),
    [defaultVariantId, defaultVariantIds],
  );
  // The top-level "Publish to shop" CTA opens this wizard with no variant
  // context at all (no row/product to publish from). In that case the
  // operator runs the selection step below instead of the field silently
  // rendering blank.
  const needsVariantPicker = propsIds.length === 0;

  // Multi-select tray state — only used during the selection step. Map
  // preserves insertion order, matching the tray's expected chip order.
  const [selectedVariants, setSelectedVariants] = useState<Map<string, string>>(new Map());
  // null while the operator is still picking (selection step showing);
  // locked in once "Continue" is pressed, or immediately when props already
  // supplied ids.
  const [finalMode, setFinalMode] = useState<PublishMode | null>(
    needsVariantPicker ? null : modeForIds(propsIds),
  );
  const [singleVariantId, setSingleVariantId] = useState<string | null>(
    !needsVariantPicker && propsIds.length === 1 ? propsIds[0] : null,
  );
  const [singleVariantLabel, setSingleVariantLabel] = useState<string | null>(null);

  const [productSearchInput, setProductSearchInput] = useState('');
  const [productOffset, setProductOffset] = useState(0);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const debouncedProductSearch = useDebouncedValue(productSearchInput, VARIANT_SEARCH_DEBOUNCE_MS);

  const productsQuery = useProductsQuery(
    { search: debouncedProductSearch || undefined },
    { limit: VARIANT_PICKER_PAGE_SIZE, offset: productOffset },
  );
  const productDetailQuery = useProductQuery(selectedProductId ?? '');

  function toggleVariant(variantId: string, label: string, checked: boolean): void {
    setSelectedVariants((prev) => {
      const next = new Map(prev);
      if (checked) {
        next.set(variantId, label);
      } else {
        next.delete(variantId);
      }
      return next;
    });
  }

  function removeFromTray(variantId: string): void {
    setSelectedVariants((prev) => {
      const next = new Map(prev);
      next.delete(variantId);
      return next;
    });
  }

  const singleMutation = useShopPublishMutation();
  const bulkMutation = useBulkShopPublishMutation();
  const { showToast } = useToast();
  const idempotencyKeyRef = useRef<string>(crypto.randomUUID());

  const [reviewing, setReviewing] = useState(false);

  // Initial defaultValues cover both non-picker entry points synchronously
  // (props ids are stable and known at mount); the picker path starts from
  // the single-mode shape as a placeholder and is fully reset once the
  // operator hits "Continue" (see handleContinue below).
  const initialDefaults: WoocommercePublishWizardValues =
    !needsVariantPicker && propsIds.length > 1
      ? {
          ...WOOCOMMERCE_PUBLISH_BULK_DEFAULTS,
          items: propsIds.map((variantId) => ({
            variantId,
            label: variantId,
            stock: '',
            priceAmount: '',
          })),
        }
      : WOOCOMMERCE_PUBLISH_SINGLE_DEFAULTS;

  const form = useForm<
    WoocommercePublishWizardValues,
    undefined,
    WoocommercePublishWizardSubmission
  >({
    defaultValues: initialDefaults,
    resolver: zodResolver(woocommercePublishWizardSchema),
    mode: 'onBlur',
  });

  const itemsFieldArray = useFieldArray({ control: form.control, name: 'items' });

  function handleContinue(): void {
    const chosen = Array.from(selectedVariants.entries());
    if (chosen.length === 0) return;
    if (chosen.length > 1) {
      form.reset({
        ...WOOCOMMERCE_PUBLISH_BULK_DEFAULTS,
        items: chosen.map(([variantId, label]) => ({
          variantId,
          label,
          stock: '',
          priceAmount: '',
        })),
      });
      setFinalMode('bulk');
    } else {
      const [[variantId, label]] = chosen;
      setSingleVariantId(variantId);
      setSingleVariantLabel(label);
      form.reset(WOOCOMMERCE_PUBLISH_SINGLE_DEFAULTS);
      setFinalMode('single');
    }
  }

  function handleVariantPick(product: Product, variant: ProductVariant, checked: boolean): void {
    toggleVariant(variant.id, variantLabel(product, variant), checked);
  }

  const mode = finalMode;
  const status = form.watch('status');
  const mutationError = mode === 'bulk' ? bulkMutation.error : singleMutation.error;
  const isPending = singleMutation.isPending || bulkMutation.isPending;

  const validationMessages = Object.values(form.formState.errors)
    .map((e) => (Array.isArray(e) ? undefined : e?.message))
    .filter((m): m is string => typeof m === 'string');

  const singleId = !needsVariantPicker ? propsIds[0] : singleVariantId;

  function resetColumn(field: 'stock' | 'priceAmount'): void {
    itemsFieldArray.fields.forEach((_, index) => {
      form.setValue(`items.${index}.${field}`, '', { shouldDirty: true });
    });
  }

  const submit = form.handleSubmit(async (values) => {
    const content = buildContent();

    try {
      if (mode === 'bulk') {
        const items: BulkShopPublishItemRequest[] = values.items.map((item) => {
          const price = buildPrice(item.priceAmount, values.priceCurrency);
          return {
            internalVariantId: item.variantId,
            stock: item.stock === '' ? 0 : Number(item.stock),
            ...(price ? { price } : {}),
          };
        });
        const request: BulkShopPublishRequest = {
          connectionId: connection.id,
          items,
          status: values.status,
          ...(content ? { content } : {}),
        };
        const result = await bulkMutation.mutateAsync({ request });
        showToast({
          tone: 'success',
          title: 'Bulk publish started',
          description: `Publishing ${items.length} products to ${connection.name}.`,
        });
        onSubmitted({ batchId: result.batchId }, connection.id);
      } else {
        const stockValue = values.stock === '' ? 0 : Number(values.stock);
        const price = buildPrice(values.priceAmount, values.priceCurrency);
        const request: ShopPublishRequest = {
          internalVariantId: singleId ?? '',
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

  // ── Selection step (top-level CTA, no props ids yet) ──────────────────
  if (needsVariantPicker && mode === null) {
    const selectedList = Array.from(selectedVariants.entries());
    return (
      <div className="wizard-card">
        <FormField
          label="Search products"
          name="productSearch"
          description="Search by product name, SKU, or EAN. Check one or more variants — they all publish together."
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

        <div className="shop-publish-picker">
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
                      <span className="shop-publish-picker__product-name" title={product.name}>
                        {product.name}
                      </span>
                      <span className="mono-text muted-text shop-publish-picker__code">
                        {product.sku ?? '-'}
                      </span>
                    </button>

                    {isExpanded ? (
                      <ul className="create-offer-variant-picker__variants">
                        {productDetailQuery.isLoading ? (
                          <li className="muted-text">Loading variants…</li>
                        ) : (productDetailQuery.data?.variants ?? []).length === 0 ? (
                          <li className="muted-text">No variants on this product.</li>
                        ) : (
                          (productDetailQuery.data?.variants ?? []).map((variant) => {
                            const label = variantLabel(productDetailQuery.data ?? product, variant);
                            const checked = selectedVariants.has(variant.id);
                            return (
                              <li key={variant.id}>
                                <label className="create-offer-variant-picker__variant">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(e) =>
                                      handleVariantPick(
                                        productDetailQuery.data ?? product,
                                        variant,
                                        e.target.checked,
                                      )
                                    }
                                  />
                                  <span
                                    className="create-offer-variant-picker__variant-name shop-publish-picker__variant-name"
                                    title={label}
                                  >
                                    {label}
                                  </span>
                                  <span className="mono-text muted-text shop-publish-picker__code">
                                    SKU {variant.sku ?? '-'} · EAN {variant.ean ?? '-'}
                                  </span>
                                </label>
                              </li>
                            );
                          })
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

        <div className="shop-publish-tray">
          <div className="shop-publish-tray__head">
            <span className="shop-publish-tray__count">
              Selected for this batch: <span className="mono-text">{selectedList.length}</span>
            </span>
            {selectedList.length > 0 ? (
              <Button
                tone="ghost"
                type="button"
                className="button--sm"
                onClick={() => setSelectedVariants(new Map())}
              >
                Clear all
              </Button>
            ) : null}
          </div>
          {selectedList.length > 0 ? (
            <div className="shop-publish-tray__chips">
              {selectedList.map(([variantId, label]) => (
                <span key={variantId} className="shop-publish-chip shop-publish-chip--removable">
                  <span title={label}>{label}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${label} from batch`}
                    onClick={() => removeFromTray(variantId)}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <p className="shop-publish-tray__empty-hint muted-text">
              Check one or more variants above to add them here.
            </p>
          )}
        </div>

        <div className="wizard-actions">
          <div className="wizard-actions__group">
            <Button type="button" tone="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </div>
          <div className="wizard-actions__group">
            <Button type="button" disabled={selectedList.length === 0} onClick={handleContinue}>
              Continue with {selectedList.length} product{selectedList.length === 1 ? '' : 's'}
            </Button>
          </div>
        </div>
      </div>
    );
  }

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
              {singleVariantLabel ? <div>{singleVariantLabel}</div> : null}
              <span className="mono-text muted-text">{singleId}</span>
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

  // ── Configure step (single + bulk share the field layout) ─────────────
  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="wizard-card">
      {mutationError ? <Alert tone="error">{mutationError.message}</Alert> : null}
      {form.formState.submitCount > 0 && validationMessages.length > 0 ? (
        <FormErrorSummary errors={validationMessages} />
      ) : null}

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

      {mode === 'bulk' ? (
        <div className="form-field">
          <span className="form-field__label">
            Products{' '}
            <span className="shop-publish-hint">{itemsFieldArray.fields.length} selected</span>{' '}
            <span className="shop-publish-hint">— stock &amp; price set per product</span>
          </span>
          <div className="shop-publish-config-table">
            <div className="shop-publish-config-table__body">
              {itemsFieldArray.fields.map((field, index) => (
                <div key={field.id} className="shop-publish-config-row">
                  <div className="shop-publish-config-row__top">
                    <span className="shop-publish-config-row__name" title={field.label}>
                      {field.label}
                    </span>
                    <button
                      type="button"
                      className="shop-publish-config-row__remove"
                      aria-label={`Remove ${field.label} from batch`}
                      onClick={() => itemsFieldArray.remove(index)}
                    >
                      ×
                    </button>
                  </div>
                  <div className="shop-publish-config-row__fields">
                    <FormField
                      label="Stock"
                      name={`items.${index}.stock`}
                      error={form.formState.errors.items?.[index]?.stock?.message}
                    >
                      <Input
                        inputMode="numeric"
                        className="input--mono"
                        placeholder="master"
                        {...form.register(`items.${index}.stock`)}
                      />
                    </FormField>
                    <FormField
                      label="Price override"
                      name={`items.${index}.priceAmount`}
                      error={form.formState.errors.items?.[index]?.priceAmount?.message}
                    >
                      <div className="shop-publish-affix">
                        <span className="shop-publish-affix__pre mono-text">
                          {form.watch('priceCurrency')}
                        </span>
                        <Input
                          inputMode="decimal"
                          className="input--mono shop-publish-affix__input"
                          placeholder="master"
                          {...form.register(`items.${index}.priceAmount`)}
                        />
                      </div>
                    </FormField>
                  </div>
                </div>
              ))}
            </div>
            <div className="shop-publish-config-table__foot">
              <span className="form-field__description">
                Blank stock/price falls back to the master product's value at publish time.
              </span>
              <div className="shop-publish-config-table__foot-actions">
                <Button
                  tone="ghost"
                  type="button"
                  className="button--sm"
                  onClick={() => resetColumn('stock')}
                >
                  Use master stock for all
                </Button>
                <Button
                  tone="ghost"
                  type="button"
                  className="button--sm"
                  onClick={() => resetColumn('priceAmount')}
                >
                  Use master price for all
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="form-field">
            <span className="form-field__label">Variant</span>
            <div className="shop-publish-variant-line">
              {singleVariantLabel ? <span>{singleVariantLabel}</span> : null}
              <span className="mono-text muted-text" title={singleId ?? ''}>
                {singleId}
              </span>
              {needsVariantPicker ? (
                <Button
                  type="button"
                  tone="ghost"
                  className="button--sm"
                  onClick={() => {
                    setSingleVariantId(null);
                    setSingleVariantLabel(null);
                    setSelectedVariants(new Map());
                    setFinalMode(null);
                  }}
                >
                  Change
                </Button>
              ) : null}
            </div>
          </div>

          <div className="shop-publish-field-row">
            <FormField label="Stock" name="stock" error={form.formState.errors.stock?.message}>
              <Input
                inputMode="numeric"
                className="input--mono"
                placeholder="0"
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
                <span className="shop-publish-affix__pre mono-text">
                  {form.watch('priceCurrency')}
                </span>
                <Input
                  inputMode="decimal"
                  className="input--mono shop-publish-affix__input"
                  placeholder="from master"
                  {...form.register('priceAmount')}
                />
              </div>
            </FormField>
          </div>
        </>
      )}

      {mode === 'bulk' ? (
        <Alert tone="info">
          Each product publishes independently — one can list at a different price or stock level
          than the rest of the batch. Out-of-stock variants list with their master stock (0 is
          honored).
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
              disabled={isPending || !singleId}
              onClick={() => {
                void form.trigger().then((ok) => {
                  if (ok) setReviewing(true);
                });
              }}
            >
              Review
            </Button>
          ) : null}
          <Button
            type="submit"
            disabled={
              isPending || (mode === 'bulk' ? itemsFieldArray.fields.length === 0 : !singleId)
            }
          >
            {isPending
              ? 'Publishing…'
              : mode === 'bulk'
                ? `Publish ${itemsFieldArray.fields.length} products`
                : 'Publish'}
          </Button>
        </div>
      </div>
    </form>
  );
}
