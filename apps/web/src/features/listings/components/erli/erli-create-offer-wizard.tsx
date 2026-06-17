/**
 * ErliCreateOfferWizard
 *
 * Three-step wizard that publishes an OpenLinker variant as a new Erli offer
 * on a given marketplace connection. **Content-only**: the surrounding
 * `<Dialog>` chrome + connection selection live in `OfferCreationLauncher`
 * (#608); this component receives the resolved `Connection` and renders the
 * wizard body + nav buttons directly. Registered via the Erli plugin's
 * `build.offerCreationWizard` slot.
 *
 * Steps:
 *   1. Variant — search and select a product variant.
 *   2. Offer details — title, category (Allegro-id reuse #985, resolved by
 *      barcode), price (PLN), stock, dispatch time, description. Images come
 *      from the master product (Erli requires ≥1 — gated via the plugin's
 *      shared `offerValidation`, NOT a re-inlined check).
 *   3. Review — summary of all chosen values.
 *
 * Erli has no seller/delivery policies and no Allegro-style category
 * parameters, so the wizard is materially simpler than `AllegroCreateOfferWizard`.
 *
 * **Lazy-loaded**: the Erli plugin registers a `React.lazy`-wrapped variant
 * (component-lazy, NOT route-lazy — `route-lazy.test.ts`'s count is
 * unaffected). The launcher's wizard render site provides the `<Suspense>`
 * boundary.
 *
 * Retry-safe: a stable `x-idempotency-key` is generated once per mount and
 * reused until success or cancel, so the server de-duplicates retries to the
 * same OfferCreationRecord.
 *
 * @module features/listings/components/erli
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { Alert } from '../../../../shared/ui/alert';
import { Button } from '../../../../shared/ui/button';
import { FormErrorSummary } from '../../../../shared/ui/form-error-summary';
import { FormField } from '../../../../shared/ui/form-field';
import { Input } from '../../../../shared/ui/input';
import { SetupStepper } from '../../../../shared/ui/setup-stepper';
import { Textarea } from '../../../../shared/ui/textarea';
import { useToast } from '../../../../shared/ui/toast-provider';
import { useTranslation } from '../../../../shared/i18n';
import { usePlatform, type OfferCreationWizardProps } from '../../../../shared/plugins';
import { useDebouncedValue } from '../../../../shared/hooks/use-debounced-value';
import { useProductQuery, useProductsQuery } from '../../../products';
import type { Product, ProductVariant } from '../../../products';
import { useCreateOfferMutation } from '../../hooks/use-create-offer-mutation';
import { useResolveCategoryQuery } from '../../hooks/use-resolve-category-query';
import type { CreateOfferRequest } from '../../api/listings.types';
import { erliCreateOfferSchema, type ErliCreateOfferValues } from './erli-create-offer.schema';
import { ErliDispatchTimeField } from './erli-dispatch-time-field';
import {
  formatDispatch,
  parseErliConnectionDispatchDefault,
  type ErliDispatchTimeParam,
} from './erli-offer-fields.schema';

const ERLI_STEP_LABELS = ['Variant', 'Offer details', 'Review'] as const;
const VARIANT_SEARCH_DEBOUNCE_MS = 300;
const VARIANT_PICKER_PAGE_SIZE = 20;

function variantLabel(product: Product, variant: ProductVariant): string {
  const attrs = variant.attributes ? Object.values(variant.attributes).join(' · ') : '';
  if (attrs) return `${product.name} — ${attrs}`;
  if (variant.sku) return `${product.name} — ${variant.sku}`;
  return product.name;
}

/** Master image URLs for the picked variant's product (forwarded to the BE). */
function masterImageUrls(product: Product | undefined): string[] {
  return product?.images?.filter((u) => typeof u === 'string' && u.trim() !== '') ?? [];
}

export function ErliCreateOfferWizard({
  connection,
  defaultVariantId,
  onCancel,
  onSubmitted,
}: OfferCreationWizardProps): ReactElement {
  const { t } = useTranslation();
  const mutation = useCreateOfferMutation();
  const { showToast } = useToast();
  const idempotencyKeyRef = useRef<string>(crypto.randomUUID());

  // Erli dispatch default parsed defensively from the (untyped) connection config.
  const dispatchDefault = useMemo<ErliDispatchTimeParam>(
    () => parseErliConnectionDispatchDefault(connection.config),
    [connection.config],
  );

  // Shared, declared-once Erli validator (image gate). Resolved via usePlatform.
  const erliValidation = usePlatform(connection.platformType)?.offerValidation;

  const form = useForm<ErliCreateOfferValues>({
    defaultValues: {
      internalVariantId: defaultVariantId ?? '',
      variantLabel: '',
      title: '',
      categoryId: '',
      priceAmount: '',
      stock: 0,
      description: '',
      publishImmediately: false,
      dispatchPeriod: dispatchDefault.period,
      dispatchUnit: dispatchDefault.unit,
    },
    resolver: zodResolver(erliCreateOfferSchema),
    mode: 'onBlur',
  });

  const [stepIndex, setStepIndex] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<ReadonlySet<number>>(new Set());
  const [productSearchInput, setProductSearchInput] = useState('');
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [pickedProduct, setPickedProduct] = useState<Product | null>(null);
  const [pickedVariantEan, setPickedVariantEan] = useState<string | null>(null);

  const debouncedSearch = useDebouncedValue(productSearchInput, VARIANT_SEARCH_DEBOUNCE_MS);

  const productsQuery = useProductsQuery(
    { search: debouncedSearch || undefined },
    { limit: VARIANT_PICKER_PAGE_SIZE, offset: 0 },
  );
  const productDetailQuery = useProductQuery(selectedProductId ?? '');

  // Category resolution by barcode (#985 — Erli reuses the resolved Allegro id).
  const categoryQuery = useResolveCategoryQuery(connection.id, pickedVariantEan);
  useEffect(() => {
    const resolved = categoryQuery.data?.allegroCategoryId;
    if (resolved && !form.getValues('categoryId')) {
      form.setValue('categoryId', resolved, { shouldDirty: true });
    }
  }, [categoryQuery.data, form]);

  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent): void {
      if (!form.formState.isDirty) return;
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [form.formState.isDirty]);

  const values = form.watch();
  const imageUrls = useMemo(() => masterImageUrls(pickedProduct ?? undefined), [pickedProduct]);
  // Image gate via the plugin's shared validator (declared once, #1096).
  const imageBlockers = useMemo(
    () =>
      erliValidation?.validateRow({
        imageCount: imageUrls.length,
        needsProductParameters: false,
        willLinkProductCard: false,
      }) ?? [],
    [erliValidation, imageUrls.length],
  );
  const hasImageBlocker = pickedProduct !== null && imageBlockers.length > 0;

  function handleVariantPick(product: Product, variant: ProductVariant): void {
    form.setValue('internalVariantId', variant.id, { shouldDirty: true, shouldValidate: true });
    form.setValue('variantLabel', variantLabel(product, variant), { shouldDirty: true });
    if (!form.getValues('title')) {
      form.setValue('title', variantLabel(product, variant).slice(0, 120), { shouldDirty: true });
    }
    if (!form.getValues('priceAmount') && variant.price !== null) {
      form.setValue('priceAmount', variant.price.toFixed(2), { shouldDirty: true });
    }
    setPickedProduct(product);
    setPickedVariantEan(variant.ean ?? variant.gtin ?? null);
  }

  const STEP_FIELDS: ReadonlyArray<ReadonlyArray<keyof ErliCreateOfferValues>> = [
    ['internalVariantId'],
    ['title', 'priceAmount', 'stock', 'dispatchPeriod', 'dispatchUnit'],
    [],
  ];

  async function goNext(): Promise<void> {
    const fields = STEP_FIELDS[stepIndex] ?? [];
    const valid = fields.length === 0 ? true : await form.trigger(fields);
    if (!valid) return;
    if (stepIndex === 1 && hasImageBlocker) return; // can't advance with a missing image
    setCompletedSteps((prev) => new Set(prev).add(stepIndex));
    setStepIndex((i) => Math.min(i + 1, ERLI_STEP_LABELS.length - 1));
  }

  function goBack(): void {
    setStepIndex((i) => Math.max(i - 1, 0));
  }

  const dispatch: ErliDispatchTimeParam = { period: values.dispatchPeriod, unit: values.dispatchUnit };

  const onSubmit = form.handleSubmit(async (submitted) => {
    if (imageUrls.length === 0) return; // belt-and-suspenders; Erli requires ≥1 image

    const request: CreateOfferRequest = {
      internalVariantId: submitted.internalVariantId,
      stock: submitted.stock,
      publishImmediately: submitted.publishImmediately,
      price: { amount: Number(submitted.priceAmount), currency: 'PLN' },
      overrides: {
        title: submitted.title,
        ...(submitted.categoryId ? { categoryId: submitted.categoryId } : {}),
        description: submitted.description ? submitted.description : null,
        imageUrls,
        platformParams: {
          dispatchTime: { period: submitted.dispatchPeriod, unit: submitted.dispatchUnit },
        },
      },
    };

    try {
      const result = await mutation.mutateAsync({
        connectionId: connection.id,
        idempotencyKey: idempotencyKeyRef.current,
        request,
      });
      showToast({
        tone: 'success',
        title: t('listings.erli.offer.dispatchedTitle', 'Offer creation dispatched'),
        description: t(
          'listings.erli.offer.dispatchedBody',
          'Status will appear inline on the listings page.',
        ),
      });
      onSubmitted(result.offerCreationRecordId, connection.id);
      onCancel();
    } catch {
      // Inline Alert renders from mutation.error; retry reuses the idempotency key.
    }
  });

  const validationMessages = Object.values(form.formState.errors)
    .map((e) => e?.message)
    .filter((m): m is string => typeof m === 'string');

  return (
    <div className="allegro-create-offer-wizard">
      <header className="allegro-create-offer-wizard__header">
        <h2 className="allegro-create-offer-wizard__title">
          {t('listings.erli.offer.title', 'Create Erli offer')}
        </h2>
        <p className="allegro-create-offer-wizard__subtitle">
          {t('listings.erli.offer.publishingTo', 'Publishing to')}{' '}
          <strong>{connection.name}</strong>{' '}
          <span className="mono-text muted-text">({connection.platformType})</span>
        </p>
      </header>

      <SetupStepper
        steps={ERLI_STEP_LABELS}
        currentStep={stepIndex}
        completedSteps={completedSteps}
      />

      {form.formState.submitCount > 0 && validationMessages.length > 0 ? (
        <FormErrorSummary errors={validationMessages} />
      ) : null}
      {mutation.error ? (
        <Alert tone="error" title="Offer creation failed">
          {mutation.error.message}
        </Alert>
      ) : null}

      <FormProvider {...form}>
        <form
          id="erli-create-offer-form"
          onSubmit={(e) => void onSubmit(e)}
          noValidate
          className="create-offer-form"
        >
          {stepIndex === 0 ? (
            <>
              <FormField
                label="Search products"
                name="erli-product-search"
                description="Search by product name, SKU, or EAN."
              >
                <Input
                  value={productSearchInput}
                  onChange={(e) => setProductSearchInput(e.target.value)}
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
                            <span className="mono-text muted-text">{product.sku ?? '—'}</span>
                          </button>

                          {isExpanded ? (
                            <ul className="create-offer-variant-picker__variants">
                              {productDetailQuery.isLoading ? (
                                <li className="muted-text">Loading variants…</li>
                              ) : (productDetailQuery.data?.variants ?? []).length === 0 ? (
                                <li className="muted-text">No variants on this product.</li>
                              ) : (
                                (productDetailQuery.data?.variants ?? []).map((variant) => {
                                  const picked = values.internalVariantId === variant.id;
                                  const detailProduct = productDetailQuery.data ?? product;
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
                                          onChange={() => handleVariantPick(detailProduct, variant)}
                                        />
                                        <span className="create-offer-variant-picker__variant-name">
                                          {variantLabel(detailProduct, variant)}
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
              </div>
            </>
          ) : null}

          {stepIndex === 1 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              {hasImageBlocker ? (
                <Alert tone="error" title="This product has no images">
                  Erli requires at least one product image. Add an image to the master product
                  before creating this offer.
                </Alert>
              ) : null}

              <FormField
                label="Title"
                name="title"
                error={form.formState.errors.title?.message}
              >
                <Input {...form.register('title')} maxLength={120} />
              </FormField>

              <FormField
                label="Category (resolved by EAN)"
                name="categoryId"
                description="Resolved from the variant barcode against the marketplace catalog. Leave blank to let the backend resolve at create time."
              >
                <Input
                  {...form.register('categoryId')}
                  placeholder={categoryQuery.isLoading ? 'Resolving…' : 'e.g. 12345'}
                />
              </FormField>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                <FormField
                  label="Price (PLN)"
                  name="priceAmount"
                  error={form.formState.errors.priceAmount?.message}
                >
                  <Input {...form.register('priceAmount')} placeholder="79.00" inputMode="decimal" />
                </FormField>
                <FormField
                  label="Stock"
                  name="stock"
                  error={form.formState.errors.stock?.message}
                >
                  <Input type="number" min={0} {...form.register('stock', { valueAsNumber: true })} />
                </FormField>
              </div>

              <ErliDispatchTimeField
                value={dispatch}
                connectionDefault={dispatchDefault}
                onChange={(next) => {
                  form.setValue('dispatchPeriod', next.period, { shouldDirty: true });
                  form.setValue('dispatchUnit', next.unit, { shouldDirty: true });
                }}
                error={form.formState.errors.dispatchPeriod?.message}
              />
              <p className="erli-config__note">
                Erli has no seller/delivery policies — dispatch time stands in for Allegro's policy
                step. Images are pulled from the master product (Erli requires at least one).
              </p>

              <FormField label="Description (optional)" name="description">
                <Textarea {...form.register('description')} rows={4} />
              </FormField>

              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)' }}>
                <input type="checkbox" {...form.register('publishImmediately')} />
                <span>
                  <strong>Publish immediately</strong>
                  <small style={{ display: 'block', color: 'var(--text-muted)' }}>
                    Uncheck to create the offer as a draft.
                  </small>
                </span>
              </label>
            </div>
          ) : null}

          {stepIndex === 2 ? (
            <dl className="create-offer-review">
              <dt>Variant</dt>
              <dd>{values.variantLabel || values.internalVariantId}</dd>
              <dt>Title</dt>
              <dd>{values.title || '—'}</dd>
              <dt>Category</dt>
              <dd>{values.categoryId || 'Resolved at create time'}</dd>
              <dt>Price</dt>
              <dd>{values.priceAmount ? `${values.priceAmount} PLN` : '—'}</dd>
              <dt>Stock</dt>
              <dd>{values.stock}</dd>
              <dt>Dispatch</dt>
              <dd>{formatDispatch(dispatch)}</dd>
              <dt>Images</dt>
              <dd>{imageUrls.length} from master product</dd>
              <dt>Publish</dt>
              <dd>{values.publishImmediately ? 'Immediately' : 'As draft'}</dd>
            </dl>
          ) : null}

          <div className="wizard-actions">
            <div className="wizard-actions__group">
              <Button tone="ghost" type="button" onClick={onCancel}>
                Cancel
              </Button>
            </div>
            <div className="wizard-actions__group">
              {stepIndex > 0 ? (
                <Button tone="secondary" type="button" onClick={goBack}>
                  ← Back
                </Button>
              ) : null}
              {stepIndex < ERLI_STEP_LABELS.length - 1 ? (
                <Button
                  type="button"
                  onClick={() => void goNext()}
                  disabled={stepIndex === 0 && !values.internalVariantId}
                >
                  Next →
                </Button>
              ) : (
                <Button type="submit" tone="primary" disabled={mutation.isPending}>
                  {mutation.isPending ? 'Creating…' : 'Create offer'}
                </Button>
              )}
            </div>
          </div>
        </form>
      </FormProvider>
    </div>
  );
}
