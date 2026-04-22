/**
 * CreateOfferWizard
 *
 * Four-step wizard that publishes an OpenLinker variant as a new offer
 * on a marketplace connection. Steps:
 *   1. Connection & Variant — pick the target connection, search and
 *      select a product variant
 *   2. Offer details — title override, Allegro category id, price, stock,
 *      description, publish-immediately toggle
 *   3. Policies — delivery (required), return / warranty / implied
 *      warranty (optional), populated from the seller-policies endpoint
 *   4. Review — summary of all chosen values
 *
 * Retry-safe: a stable `x-idempotency-key` is generated on open
 * (`crypto.randomUUID()`) and reused until success or explicit cancel,
 * so the server returns the same OfferCreationRecord on retry instead
 * of creating a duplicate.
 *
 * Rendered inside the shared `Dialog` primitive (Radix-backed) rather
 * than a bespoke side drawer — the shared `.drawer` classes referenced
 * by other components do not exist in `index.css`, and a centered
 * modal is a better fit for multi-step content anyway.
 *
 * @module apps/web/src/features/listings/components
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useForm, type Path } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../../shared/ui/dialog';
import { FormErrorSummary } from '../../../shared/ui/form-error-summary';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import { SetupStepper } from '../../../shared/ui/setup-stepper';
import { Textarea } from '../../../shared/ui/textarea';
import { useToast } from '../../../shared/ui/toast-provider';
import { useDebouncedValue } from '../../../shared/hooks/use-debounced-value';
import { useConnectionsQuery } from '../../connections/hooks/use-connections-query';
import { useProductQuery } from '../../products/hooks/use-product-query';
import { useProductsQuery } from '../../products/hooks/use-products-query';
import type { Product, ProductVariant } from '../../products/api/products.types';
import { useCreateOfferMutation } from '../hooks/use-create-offer-mutation';
import { useSellerPoliciesQuery } from '../hooks/use-seller-policies-query';
import type { CreateOfferRequest } from '../api/listings.types';
import {
  CREATE_OFFER_DEFAULT_VALUES,
  createOfferFieldsSchema,
  type CreateOfferFieldsSubmission,
  type CreateOfferFieldsValues,
} from './create-offer-fields.schema';

const STEP_LABELS = ['Connection & Variant', 'Offer details', 'Policies', 'Review'] as const;

const STEP_FIELDS: ReadonlyArray<ReadonlyArray<Path<CreateOfferFieldsValues>>> = [
  ['connectionId', 'internalVariantId'],
  ['title', 'categoryId', 'priceAmount', 'priceCurrency', 'stock'],
  ['deliveryPolicyId'],
  [],
];

const VARIANT_SEARCH_DEBOUNCE_MS = 300;
const VARIANT_PICKER_PAGE_SIZE = 10;

interface CreateOfferWizardProps {
  isOpen: boolean;
  onClose: () => void;
  /** Pre-fill hint from the listings list filter; the picker is always
   *  visible so the operator can change it. */
  defaultConnectionId?: string;
  onSubmitted: (offerCreationRecordId: string, connectionId: string) => void;
}

function variantLabel(product: Product, variant: ProductVariant): string {
  const attrs = variant.attributes ? Object.values(variant.attributes).join(' · ') : '';
  if (attrs) {
    return `${product.name} — ${attrs}`;
  }
  if (variant.sku) {
    return `${product.name} — ${variant.sku}`;
  }
  return product.name;
}

export function CreateOfferWizard({
  isOpen,
  onClose,
  defaultConnectionId,
  onSubmitted,
}: CreateOfferWizardProps): ReactElement {
  const mutation = useCreateOfferMutation();
  const { showToast } = useToast();
  const idempotencyKeyRef = useRef<string>('');

  const form = useForm<CreateOfferFieldsValues, undefined, CreateOfferFieldsSubmission>({
    defaultValues: { ...CREATE_OFFER_DEFAULT_VALUES, connectionId: defaultConnectionId ?? '' },
    resolver: zodResolver(createOfferFieldsSchema),
    mode: 'onBlur',
  });

  const [stepIndex, setStepIndex] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<ReadonlySet<number>>(new Set());
  const [productSearchInput, setProductSearchInput] = useState('');
  const [productOffset, setProductOffset] = useState(0);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const debouncedProductSearch = useDebouncedValue(productSearchInput, VARIANT_SEARCH_DEBOUNCE_MS);

  // Reset wizard state on open.
  const prevIsOpenRef = useRef(false);
  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      idempotencyKeyRef.current = crypto.randomUUID();
      form.reset({ ...CREATE_OFFER_DEFAULT_VALUES, connectionId: defaultConnectionId ?? '' });
      setStepIndex(0);
      setCompletedSteps(new Set());
      setProductSearchInput('');
      setProductOffset(0);
      setSelectedProductId(null);
      mutation.reset();
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen, defaultConnectionId, form, mutation]);

  // Abandon-prevention: warn if the operator closes the tab mid-flow.
  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent): void {
      if (!form.formState.isDirty) return;
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [form.formState.isDirty]);

  const connectionsQuery = useConnectionsQuery();
  const marketplaceConnections = useMemo(
    () =>
      (connectionsQuery.data ?? []).filter(
        (c) => c.platformType === 'allegro' || c.supportedCapabilities.includes('Marketplace'),
      ),
    [connectionsQuery.data],
  );

  // RHF `register` writes initial values via ref on mount, but the native
  // `<select>` only accepts a value that matches a rendered `<option>`. When
  // the connections list arrives after mount (the query resolves async) the
  // DOM value hasn't caught up with the form state, so we re-issue
  // `setValue` once the intended option is actually present.
  const currentConnectionId = form.watch('connectionId');
  const connectionsLoadedRef = useRef(false);
  useEffect(() => {
    if (connectionsLoadedRef.current || marketplaceConnections.length === 0) return;
    connectionsLoadedRef.current = true;
    if (defaultConnectionId && marketplaceConnections.some((c) => c.id === defaultConnectionId)) {
      form.setValue('connectionId', defaultConnectionId, { shouldDirty: false });
    }
  }, [marketplaceConnections, defaultConnectionId, form]);

  // Reset the "loaded" ref on wizard re-open so a fresh session re-syncs.
  useEffect(() => {
    if (!isOpen) connectionsLoadedRef.current = false;
  }, [isOpen]);

  const productsQuery = useProductsQuery(
    { search: debouncedProductSearch || undefined },
    { limit: VARIANT_PICKER_PAGE_SIZE, offset: productOffset },
  );
  const productDetailQuery = useProductQuery(selectedProductId ?? '');

  const sellerPoliciesQuery = useSellerPoliciesQuery(currentConnectionId);
  const policies = sellerPoliciesQuery.data;
  const hasAnyPolicies = Boolean(
    policies &&
      (policies.deliveryPolicies.length ||
        policies.returnPolicies.length ||
        policies.warranties.length ||
        policies.impliedWarranties.length),
  );

  const validationMessages = Object.values(form.formState.errors).flatMap((e) =>
    e?.message ? [String(e.message)] : [],
  );

  async function goNext(): Promise<void> {
    const fields = STEP_FIELDS[stepIndex];
    if (fields.length > 0) {
      const valid = await form.trigger([...fields]);
      if (!valid) return;
    }
    setCompletedSteps((prev) => new Set(prev).add(stepIndex));
    setStepIndex((i) => Math.min(i + 1, STEP_LABELS.length - 1));
  }

  function goBack(): void {
    setStepIndex((i) => Math.max(i - 1, 0));
  }

  function handleVariantPick(product: Product, variant: ProductVariant): void {
    form.setValue('internalVariantId', variant.id, { shouldDirty: true, shouldValidate: true });
    form.setValue('variantLabel', variantLabel(product, variant), { shouldDirty: true });
    // Prefill title with the variant label if the operator hasn't typed anything.
    if (!form.getValues('title')) {
      form.setValue('title', variantLabel(product, variant).slice(0, 75), { shouldDirty: true });
    }
    // Prefill price from the product's master price if available.
    if (!form.getValues('priceAmount') && product.price !== null) {
      form.setValue('priceAmount', String(product.price.toFixed(2)), { shouldDirty: true });
    }
  }

  const onSubmit = form.handleSubmit(async (values) => {
    const platformParams: Record<string, unknown> = { deliveryPolicyId: values.deliveryPolicyId };
    if (values.returnPolicyId) platformParams.returnPolicyId = values.returnPolicyId;
    if (values.warrantyId) platformParams.warrantyId = values.warrantyId;
    if (values.impliedWarrantyId) platformParams.impliedWarrantyId = values.impliedWarrantyId;

    const request: CreateOfferRequest = {
      internalVariantId: values.internalVariantId,
      stock: values.stock,
      publishImmediately: values.publishImmediately,
      price: { amount: Number(values.priceAmount), currency: values.priceCurrency },
      overrides: {
        title: values.title,
        categoryId: values.categoryId,
        description: values.description ? values.description : null,
        platformParams,
      },
    };

    try {
      const result = await mutation.mutateAsync({
        connectionId: values.connectionId,
        idempotencyKey: idempotencyKeyRef.current,
        request,
      });
      showToast({
        tone: 'success',
        title: 'Offer creation dispatched',
        description: 'Status will appear inline on the listings page.',
      });
      onSubmitted(result.offerCreationRecordId, values.connectionId);
      onClose();
    } catch {
      // Inline Alert renders from mutation.error; retry will reuse the
      // same idempotency key so the server de-duplicates to the same
      // OfferCreationRecord rather than creating a new one.
    }
  });

  const values = form.watch();
  const selectedVariantId = values.internalVariantId;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogTitle>Create offer</DialogTitle>
        <DialogDescription>
          Publish an OpenLinker variant as a new offer on a marketplace connection.
        </DialogDescription>

        <SetupStepper steps={STEP_LABELS} currentStep={stepIndex} completedSteps={completedSteps} />

        {form.formState.submitCount > 0 && validationMessages.length > 0 ? (
          <FormErrorSummary errors={validationMessages} />
        ) : null}
        {mutation.error ? (
          <Alert tone="error" title="Offer creation failed">
            {mutation.error.message}
          </Alert>
        ) : null}

        <form
          id="create-offer-form"
          onSubmit={(e) => void onSubmit(e)}
          noValidate
          className="create-offer-form"
        >
          {stepIndex === 0 ? (
            <>
              <FormField
                label="Connection"
                name="connectionId"
                error={form.formState.errors.connectionId?.message}
                description="Marketplace to publish this offer to."
              >
                <Select
                  {...form.register('connectionId')}
                  invalid={Boolean(form.formState.errors.connectionId)}
                >
                  <option value="">Choose a connection…</option>
                  {marketplaceConnections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.platformType})
                    </option>
                  ))}
                </Select>
              </FormField>

              <FormField
                label="Search products"
                name="productSearch"
                description="Search by product name, SKU, or EAN."
              >
                <Input
                  value={productSearchInput}
                  onChange={(e) => {
                    setProductSearchInput(e.target.value);
                    // Reset offset synchronously here (not via a useEffect on the
                    // debounced value) so the debounced query always fires with a
                    // fresh offset — narrowing a search can otherwise leave the
                    // picker on a now-empty page.
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
                        <li
                          key={product.id}
                          className="create-offer-variant-picker__product"
                        >
                          <button
                            type="button"
                            className="create-offer-variant-picker__product-row"
                            onClick={() =>
                              setSelectedProductId(isExpanded ? null : product.id)
                            }
                            aria-expanded={isExpanded}
                          >
                            <span>{product.name}</span>
                            <span className="mono-text muted-text">
                              {product.sku ?? '—'}
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
                                  const picked = selectedVariantId === variant.id;
                                  return (
                                    <li key={variant.id}>
                                      <label
                                        className={`create-offer-variant-picker__variant${picked ? ' create-offer-variant-picker__variant--picked' : ''}`}
                                      >
                                        <input
                                          type="radio"
                                          name="internalVariantId"
                                          value={variant.id}
                                          checked={picked}
                                          onChange={() =>
                                            handleVariantPick(
                                              productDetailQuery.data ?? product,
                                              variant,
                                            )
                                          }
                                        />
                                        <span className="create-offer-variant-picker__variant-name">
                                          {variantLabel(productDetailQuery.data ?? product, variant)}
                                        </span>
                                        <span className="mono-text muted-text">
                                          SKU {variant.sku ?? '—'} · EAN {variant.ean ?? '—'}
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
                {form.formState.errors.internalVariantId ? (
                  <p className="form-field__error" role="alert">
                    {form.formState.errors.internalVariantId.message}
                  </p>
                ) : null}
                {(() => {
                  const total = productsQuery.data?.total ?? 0;
                  if (total <= VARIANT_PICKER_PAGE_SIZE) return null;
                  const pageEnd = Math.min(productOffset + VARIANT_PICKER_PAGE_SIZE, total);
                  return (
                    <div className="create-offer-variant-picker__pagination">
                      <span className="muted-text">
                        {productOffset + 1}–{pageEnd} of {total}
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
            </>
          ) : null}

          {stepIndex === 1 ? (
            <>
              <FormField
                label="Title"
                name="title"
                description="Shown as the offer title on the marketplace (max 75 characters)."
                error={form.formState.errors.title?.message}
              >
                <Input
                  {...form.register('title')}
                  maxLength={75}
                  invalid={Boolean(form.formState.errors.title)}
                />
              </FormField>

              <FormField
                label="Allegro category ID"
                name="categoryId"
                description="Required for Allegro. Paste the numeric category id from the Allegro category tree."
                error={form.formState.errors.categoryId?.message}
              >
                <Input
                  {...form.register('categoryId')}
                  placeholder="e.g. 12345"
                  invalid={Boolean(form.formState.errors.categoryId)}
                />
              </FormField>

              <div className="form-grid form-grid--2col">
                <FormField
                  label="Price"
                  name="priceAmount"
                  error={form.formState.errors.priceAmount?.message}
                >
                  <Input
                    {...form.register('priceAmount')}
                    type="text"
                    inputMode="decimal"
                    placeholder="e.g. 99.99"
                    invalid={Boolean(form.formState.errors.priceAmount)}
                  />
                </FormField>
                <FormField label="Currency" name="priceCurrency">
                  <Input {...form.register('priceCurrency')} readOnly className="input--readonly" />
                </FormField>
              </div>

              <FormField
                label="Stock"
                name="stock"
                description="Quantity available on the marketplace."
                error={form.formState.errors.stock?.message}
              >
                <Input
                  {...form.register('stock', { valueAsNumber: true })}
                  type="number"
                  min={0}
                  step={1}
                  invalid={Boolean(form.formState.errors.stock)}
                />
              </FormField>

              <FormField
                label="Description (optional)"
                name="description"
                error={form.formState.errors.description?.message}
              >
                <Textarea {...form.register('description')} rows={4} />
              </FormField>

              <label className="create-offer-checkbox">
                <input type="checkbox" {...form.register('publishImmediately')} />
                <span>Publish immediately (uncheck to create as a draft)</span>
              </label>
            </>
          ) : null}

          {stepIndex === 2 ? (
            <>
              {sellerPoliciesQuery.isLoading ? (
                <p className="muted-text">Loading seller policies…</p>
              ) : sellerPoliciesQuery.error ? (
                <Alert tone="error" title="Unable to load seller policies">
                  {sellerPoliciesQuery.error.message}
                </Alert>
              ) : !hasAnyPolicies ? (
                <Alert tone="info" title="No seller policies configured">
                  This connection has no delivery, return, or warranty policies configured in
                  the marketplace. Offer creation may fail validation — configure policies on
                  Allegro first for best results.
                </Alert>
              ) : null}

              <FormField
                label="Delivery policy"
                name="deliveryPolicyId"
                description="Required. The delivery / shipping policy to apply."
                error={form.formState.errors.deliveryPolicyId?.message}
              >
                <Select
                  {...form.register('deliveryPolicyId')}
                  invalid={Boolean(form.formState.errors.deliveryPolicyId)}
                >
                  <option value="">Choose a delivery policy…</option>
                  {(policies?.deliveryPolicies ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </FormField>

              <FormField label="Return policy (optional)" name="returnPolicyId">
                <Select {...form.register('returnPolicyId')}>
                  <option value="">No override</option>
                  {(policies?.returnPolicies ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </FormField>

              <FormField label="Warranty (optional)" name="warrantyId">
                <Select {...form.register('warrantyId')}>
                  <option value="">No override</option>
                  {(policies?.warranties ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </FormField>

              <FormField label="Implied warranty (optional)" name="impliedWarrantyId">
                <Select {...form.register('impliedWarrantyId')}>
                  <option value="">No override</option>
                  {(policies?.impliedWarranties ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </FormField>
            </>
          ) : null}

          {stepIndex === 3 ? (
            <dl className="wizard-review-list">
              <dt>Connection</dt>
              <dd>
                {marketplaceConnections.find((c) => c.id === values.connectionId)?.name ?? '—'}
              </dd>
              <dt>Variant</dt>
              <dd>{values.variantLabel || values.internalVariantId}</dd>
              <dt>Title</dt>
              <dd>{values.title || '—'}</dd>
              <dt>Allegro category</dt>
              <dd className="mono-text">{values.categoryId || '—'}</dd>
              <dt>Price</dt>
              <dd>{values.priceAmount ? `${values.priceAmount} ${values.priceCurrency}` : '—'}</dd>
              <dt>Stock</dt>
              <dd>{values.stock}</dd>
              <dt>Publish immediately</dt>
              <dd>{values.publishImmediately ? 'Yes' : 'No (create as draft)'}</dd>
              <dt>Delivery policy</dt>
              <dd>
                {policies?.deliveryPolicies.find((p) => p.id === values.deliveryPolicyId)?.name ??
                  values.deliveryPolicyId ??
                  '—'}
              </dd>
              {values.returnPolicyId ? (
                <>
                  <dt>Return policy</dt>
                  <dd>
                    {policies?.returnPolicies.find((p) => p.id === values.returnPolicyId)?.name ??
                      values.returnPolicyId}
                  </dd>
                </>
              ) : null}
              {values.warrantyId ? (
                <>
                  <dt>Warranty</dt>
                  <dd>
                    {policies?.warranties.find((p) => p.id === values.warrantyId)?.name ??
                      values.warrantyId}
                  </dd>
                </>
              ) : null}
              {values.impliedWarrantyId ? (
                <>
                  <dt>Implied warranty</dt>
                  <dd>
                    {policies?.impliedWarranties.find((p) => p.id === values.impliedWarrantyId)
                      ?.name ?? values.impliedWarrantyId}
                  </dd>
                </>
              ) : null}
              {values.description ? (
                <>
                  <dt>Description</dt>
                  <dd>{values.description}</dd>
                </>
              ) : null}
            </dl>
          ) : null}
        </form>

        <div className="wizard-actions">
          <div className="wizard-actions__group">
            {stepIndex > 0 ? (
              <Button tone="secondary" type="button" onClick={goBack}>
                Back
              </Button>
            ) : (
              <Button tone="ghost" type="button" onClick={onClose}>
                Cancel
              </Button>
            )}
          </div>
          <div className="wizard-actions__group">
            {stepIndex < STEP_LABELS.length - 1 ? (
              <Button type="button" onClick={() => void goNext()}>
                Next
              </Button>
            ) : (
              <Button type="submit" form="create-offer-form" disabled={mutation.isPending}>
                {mutation.isPending ? 'Submitting…' : 'Create offer'}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
