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
import { Controller, FormProvider, useForm, type FieldPath } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'react-router-dom';

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
import { useProductQuery, useProductsQuery, useVariantQuery } from '../../../products';
import type { Product, ProductVariant } from '../../../products';
import { useCreateOfferMutation } from '../../hooks/use-create-offer-mutation';
import { useResolveCategoryQuery } from '../../hooks/use-resolve-category-query';
import { useCategoryParametersQuery } from '../../hooks/use-category-parameters-query';
import { CategoryPicker } from '../CategoryPicker';
import { CategoryParametersStep } from '../category-parameters-step';
import { buildParametersZodSchema } from '../build-parameters-zod-schema';
import {
  MissingCategoryParameterSectionError,
  categoryParametersToOfferParameters,
} from '../category-parameters-to-offer-parameters';
import type { CategoryParameterFormValues } from '../category-parameter-form.types';
import type { CreateOfferRequest, OfferParameter } from '../../api/listings.types';
import {
  erliCreateOfferSchema,
  type ErliCreateOfferSubmission,
  type ErliCreateOfferValues,
} from './erli-create-offer.schema';
import { ErliDispatchTimeField } from './erli-dispatch-time-field';
import { ErliProducerField } from './erli-producer-field';
import {
  formatDispatch,
  parseErliConnectionDispatchDefault,
  type ErliDispatchTimeParam,
} from './erli-offer-fields.schema';
import { readErliOfferRequestPrefill } from './create-erli-offer-request-to-form-values';

/**
 * Step labels — capability-conditional (#1384). Erli borrows Allegro's
 * category/attribute taxonomy (ADR-023, ADR-031); when the connection has
 * Allegro app credentials configured (`config.allegroCategoryAccessEnabled`,
 * a per-connection-instance-visible flag — NOT `supportedCapabilities`,
 * which is static per-adapterKey and cannot reflect this, see ADR-031
 * "Correction"), the wizard grows a dedicated Category step (CategoryPicker)
 * and a Category-parameters step, mirroring `AllegroCreateOfferWizard`.
 * Otherwise it keeps today's 3-step shape with the plain-text category field
 * folded into "Offer details".
 */
const ERLI_STEP_LABELS_BASIC = ['Variant', 'Offer details', 'Review'] as const;
const ERLI_STEP_LABELS_WITH_CATEGORY = [
  'Variant',
  'Offer details',
  'Category',
  'Category parameters',
  'Review',
] as const;
const VARIANT_SEARCH_DEBOUNCE_MS = 300;
const VARIANT_PICKER_PAGE_SIZE = 20;

/**
 * RHF cannot infer the dynamic `parameters.{paramId}` path from
 * `ErliCreateOfferValues` (the `parameters` slice is `z.record(z.unknown())`
 * by design — per-field shapes come from the runtime `CategoryParameter`
 * list). Mirrors `AllegroCreateOfferWizard`'s `parametersFieldPath` helper.
 */
function parametersFieldPath(paramId: string): FieldPath<ErliCreateOfferValues> {
  return `parameters.${paramId}` as FieldPath<ErliCreateOfferValues>;
}

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
  initialValues,
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

  // Retry path (#1099): a persisted `request` snapshot pre-fills every field and
  // opens at the Offer-details step. `null` when no snapshot (fresh create) or
  // when the snapshot's schema version is unreadable (→ blank wizard). The
  // variant CONTEXT (picked product for images, EAN for category) is
  // reconstructed below from the variant id, which is all the snapshot carries.
  const prefill = useMemo<ErliCreateOfferValues | null>(
    () => readErliOfferRequestPrefill(initialValues, dispatchDefault),
    [initialValues, dispatchDefault],
  );

  // Shared, declared-once Erli validator (image gate). Resolved via usePlatform.
  const erliValidation = usePlatform(connection.platformType)?.offerValidation;

  // #1384 — per-connection-instance signal (NOT `connection.supportedCapabilities`,
  // which is static per-adapterKey — see ADR-031 "Correction"). Read directly off
  // the connection's already-returned `config`, no new query needed.
  const allegroCategoryAccessEnabled = connection.config.allegroCategoryAccessEnabled === true;
  const stepLabels = allegroCategoryAccessEnabled
    ? ERLI_STEP_LABELS_WITH_CATEGORY
    : ERLI_STEP_LABELS_BASIC;
  const categoryStepIndex = allegroCategoryAccessEnabled ? 2 : null;
  const categoryParametersStepIndex = allegroCategoryAccessEnabled ? 3 : null;
  const reviewStepIndex = stepLabels.length - 1;

  const form = useForm<ErliCreateOfferValues, undefined, ErliCreateOfferSubmission>({
    defaultValues: prefill ?? {
      internalVariantId: defaultVariantId ?? '',
      variantLabel: '',
      title: '',
      categoryId: '',
      priceAmount: '',
      stock: 0,
      description: '',
      producer: '',
      publishImmediately: false,
      dispatchPeriod: dispatchDefault.period,
      dispatchUnit: dispatchDefault.unit,
      parameters: {},
    },
    resolver: zodResolver(erliCreateOfferSchema),
    mode: 'onBlur',
  });

  const [stepIndex, setStepIndex] = useState(prefill ? 1 : 0);
  const [completedSteps, setCompletedSteps] = useState<ReadonlySet<number>>(
    prefill ? new Set([0, 1]) : new Set(),
  );
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

  // Retry path (#1099): rebuild the variant context the snapshot doesn't carry.
  // Resolve the variant summary (productId + EAN), then load that product so its
  // master images feed the SAME state an interactive variant-pick would set —
  // otherwise the Erli image gate would block a retry submit. Each setter is a
  // no-op once the operator has interactively picked (guarded with `?? cur`).
  const prefillVariantQuery = useVariantQuery(prefill?.internalVariantId);
  useEffect(() => {
    const summary = prefillVariantQuery.data;
    if (!summary) return;
    setSelectedProductId((cur) => cur ?? summary.productId);
    setPickedVariantEan((cur) => cur ?? summary.ean ?? null);
    if (summary.name && !form.getValues('variantLabel')) {
      form.setValue('variantLabel', summary.name);
    }
  }, [prefillVariantQuery.data, form]);
  useEffect(() => {
    if (!prefill) return;
    const product = productDetailQuery.data;
    if (product) setPickedProduct((cur) => cur ?? product);
  }, [prefill, productDetailQuery.data]);

  // Category resolution by barcode (#985 — Erli reuses the resolved Allegro id).
  const categoryQuery = useResolveCategoryQuery(connection.id, pickedVariantEan);
  useEffect(() => {
    const resolved = categoryQuery.data?.allegroCategoryId;
    if (resolved && !form.getValues('categoryId')) {
      form.setValue('categoryId', resolved, { shouldDirty: true });
    }
  }, [categoryQuery.data, form]);

  // #1384 — category-parameter schema, only fetched once a category is
  // selected AND the connection has Allegro category access configured.
  // Same hook Allegro's wizard uses (`useCategoryParametersQuery`) — no new
  // hook needed, per the plan.
  const currentCategoryId = form.watch('categoryId');
  const categoryParametersQuery = useCategoryParametersQuery(
    allegroCategoryAccessEnabled ? connection.id : undefined,
    allegroCategoryAccessEnabled ? currentCategoryId || undefined : undefined,
  );
  const categoryParameters = useMemo(
    () => categoryParametersQuery.data ?? [],
    [categoryParametersQuery.data],
  );
  // Clear the parameters slice whenever the chosen category changes — the
  // shape is category-specific so prior values would never be valid under a
  // new schema (mirrors `AllegroCreateOfferWizard`).
  const lastCategoryIdRef = useRef<string>(currentCategoryId);
  useEffect(() => {
    if (lastCategoryIdRef.current && lastCategoryIdRef.current !== currentCategoryId) {
      form.setValue('parameters', {}, { shouldDirty: false, shouldValidate: false });
      form.clearErrors('parameters');
    }
    lastCategoryIdRef.current = currentCategoryId;
  }, [currentCategoryId, form]);
  // #423 — surfaces `MissingCategoryParameterSectionError` (stale cache
  // predating #417) with an actionable "reload" message, mirroring Allegro's
  // wizard.
  const [staleSchemaError, setStaleSchemaError] = useState<string | null>(null);

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
        needsProductParameters: allegroCategoryAccessEnabled,
        willLinkProductCard: false,
      }) ?? [],
    [erliValidation, imageUrls.length, allegroCategoryAccessEnabled],
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

  const STEP_FIELDS: ReadonlyArray<ReadonlyArray<keyof ErliCreateOfferValues>> = allegroCategoryAccessEnabled
    ? [
        ['internalVariantId'],
        ['title', 'priceAmount', 'stock', 'dispatchPeriod', 'dispatchUnit'],
        [], // Category — CategoryPicker, no static-field trigger
        [], // Category parameters — validated dynamically below
        [],
      ]
    : [['internalVariantId'], ['title', 'priceAmount', 'stock', 'dispatchPeriod', 'dispatchUnit'], []];

  async function goNext(): Promise<void> {
    const fields = STEP_FIELDS[stepIndex] ?? [];
    const valid = fields.length === 0 ? true : await form.trigger(fields);
    if (!valid) return;
    if (stepIndex === 1 && hasImageBlocker) return; // can't advance with a missing image

    // #1401 review — Category is a static `[]` STEP_FIELDS entry (CategoryPicker
    // has no static-field trigger), so `categoryId` must be enforced manually here,
    // mirroring `AllegroCreateOfferWizard`'s required `categoryId` field. Without
    // this an operator can click through the Category step without picking one.
    if (allegroCategoryAccessEnabled && stepIndex === categoryStepIndex) {
      if (!form.getValues('categoryId')) {
        form.setError('categoryId', { type: 'manual', message: 'Select a category to continue.' });
        return;
      }
      form.clearErrors('categoryId');
    }

    // #1384 — dynamic per-category Zod validation, mirrors
    // `AllegroCreateOfferWizard`'s Step-3 gate. Skipped when the category has
    // no parameters or the schema is still loading.
    if (
      allegroCategoryAccessEnabled &&
      stepIndex === categoryParametersStepIndex &&
      categoryParameters.length > 0
    ) {
      const paramValues =
        (form.getValues('parameters') as CategoryParameterFormValues | undefined) ?? {};
      const result = buildParametersZodSchema(categoryParameters).safeParse(paramValues);
      if (!result.success) {
        form.clearErrors('parameters');
        for (const issue of result.error.issues) {
          const paramId = String(issue.path[0] ?? '');
          if (paramId === '') continue;
          form.setError(parametersFieldPath(paramId), { type: 'manual', message: issue.message });
        }
        return;
      }
      form.clearErrors('parameters');
    }

    setCompletedSteps((prev) => new Set(prev).add(stepIndex));
    setStepIndex((i) => Math.min(i + 1, stepLabels.length - 1));
  }

  function goBack(): void {
    setStepIndex((i) => Math.max(i - 1, 0));
  }

  const dispatch: ErliDispatchTimeParam = { period: values.dispatchPeriod, unit: values.dispatchUnit };

  const onSubmit = form.handleSubmit(async (submitted) => {
    // Single source for the "Erli requires ≥1 image" rule: the shared
    // `offerValidation` validator (#1096), reused here rather than re-inlining
    // `imageUrls.length === 0`. `imageBlockers` is computed from `imageUrls`
    // (not gated on `pickedProduct`), so the doomed-submit guard still fires on
    // the `defaultVariantId` path where no product was interactively picked.
    if (imageBlockers.length > 0) return;

    setStaleSchemaError(null); // clear from any prior submit

    // #1384 — serialize the Step-4 category-parameter values into the
    // neutral `OfferParameter[]` shape, exactly like Allegro's wizard.
    // `OfferBuilderService.buildOfferParameters` merges `overrides.parameters`
    // server-side unchanged — no BE change needed (confirmed in ADR-031's plan).
    let parameters: OfferParameter[] = [];
    if (allegroCategoryAccessEnabled) {
      try {
        parameters = categoryParametersToOfferParameters(
          (submitted.parameters as CategoryParameterFormValues | undefined) ?? {},
          categoryParameters,
        );
      } catch (error) {
        if (error instanceof MissingCategoryParameterSectionError) {
          setStaleSchemaError(error.parameterName);
          return;
        }
        throw error;
      }
    }

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
        ...(parameters.length > 0 ? { parameters } : {}),
        platformParams: {
          dispatchTime: { period: submitted.dispatchPeriod, unit: submitted.dispatchUnit },
          ...(submitted.producer ? { producer: submitted.producer } : {}),
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
    <div className="create-offer-wizard">
      <header className="create-offer-wizard__header">
        <h2 className="create-offer-wizard__title">
          {t('listings.erli.offer.title', 'Create Erli offer')}
        </h2>
        <p className="create-offer-wizard__subtitle">
          {t('listings.erli.offer.publishingTo', 'Publishing to')}{' '}
          <strong>{connection.name}</strong>{' '}
          <span className="mono-text muted-text">({connection.platformType})</span>
        </p>
      </header>

      <SetupStepper
        steps={stepLabels}
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
      {staleSchemaError !== null ? (
        <Alert tone="error" title="Wizard data is out of date">
          <p>
            Category parameter <strong>{staleSchemaError}</strong> is missing data that was added
            in a recent update. Please reload this page to refetch the latest category schema.
          </p>
          <div className="alert__actions">
            <Button type="button" tone="primary" onClick={() => window.location.reload()}>
              Reload now
            </Button>
            <Button type="button" tone="ghost" onClick={() => setStaleSchemaError(null)}>
              Dismiss
            </Button>
          </div>
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

              {!allegroCategoryAccessEnabled ? (
                <>
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
                  <p className="erli-config__note">
                    Add Allegro category browsing to this connection to pick from a list instead
                    of typing a raw category id. <Link to={`/connections/${connection.id}/edit`}>Configure category browsing</Link>.
                  </p>
                </>
              ) : null}

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
              <ErliProducerField
                connectionId={connection.id}
                value={form.watch('producer') ?? ''}
                onChange={(next) => form.setValue('producer', next, { shouldDirty: true })}
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

          {allegroCategoryAccessEnabled && stepIndex === categoryStepIndex ? (
            <div className="form-field">
              <span id="erli-categoryId-label" className="form-field__label">
                Category
              </span>
              <Controller
                control={form.control}
                name="categoryId"
                render={({ field, fieldState }) => (
                  <CategoryPicker
                    connectionId={connection.id}
                    value={field.value || null}
                    onChange={field.onChange}
                    invalid={Boolean(fieldState.error)}
                    aria-labelledby="erli-categoryId-label"
                    aria-describedby="erli-categoryId-description erli-categoryId-error"
                  />
                )}
              />
              <p id="erli-categoryId-description" className="form-field__description">
                Browse the Allegro-borrowed category tree (ADR-023/ADR-031) and pick a leaf
                category.
              </p>
              {form.formState.errors.categoryId?.message ? (
                <p id="erli-categoryId-error" className="form-field__error" role="alert">
                  {form.formState.errors.categoryId.message}
                </p>
              ) : null}
            </div>
          ) : null}

          {allegroCategoryAccessEnabled && stepIndex === categoryParametersStepIndex ? (
            categoryParametersQuery.isLoading ? (
              <p className="muted-text" role="status" aria-live="polite">
                Loading category parameters…
              </p>
            ) : categoryParametersQuery.error ? (
              <Alert tone="error" title="Unable to load category parameters">
                <span>{categoryParametersQuery.error.message}</span>
                <Button
                  tone="secondary"
                  type="button"
                  onClick={() => void categoryParametersQuery.refetch()}
                >
                  Retry
                </Button>
              </Alert>
            ) : categoryParameters.length === 0 ? (
              <p className="muted-text">No additional parameters required for this category.</p>
            ) : (
              <CategoryParametersStep parameters={categoryParameters} formNamespace="parameters" />
            )
          ) : null}

          {stepIndex === reviewStepIndex ? (
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
              {stepIndex < stepLabels.length - 1 ? (
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
