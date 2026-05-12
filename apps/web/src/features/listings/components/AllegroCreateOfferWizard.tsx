/**
 * AllegroCreateOfferWizard
 *
 * Five-step wizard that publishes an OpenLinker variant as a new Allegro
 * offer on a given marketplace connection. **Content-only**: the
 * surrounding `<Dialog>` chrome and connection selection live in
 * `OfferCreationLauncher` (#608); this component receives the resolved
 * `Connection` as a prop and renders wizard body + nav buttons directly.
 *
 * Steps:
 *   1. Variant — search and select a product variant
 *   2. Offer details — title override, Allegro category id, price, stock,
 *      description, publish-immediately toggle
 *   3. Category parameters (#410) — required-first / optional-collapsed
 *      Allegro per-category attributes; renders a friendly empty message
 *      when the category has no parameters.
 *   4. Policies — delivery (required), return / warranty / implied
 *      warranty (optional), populated from the seller-policies endpoint
 *   5. Review — summary of all chosen values
 *
 * Retry-safe: a stable `x-idempotency-key` is generated once per mount
 * (`crypto.randomUUID()`) and reused until success or explicit cancel,
 * so the server returns the same OfferCreationRecord on retry instead of
 * creating a duplicate. The launcher unmounts + remounts the wizard on
 * close/re-open, which mints a fresh key naturally.
 *
 * @module apps/web/src/features/listings/components
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  Controller,
  FormProvider,
  useForm,
  type FieldPath,
  type Path,
} from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { FormErrorSummary } from '../../../shared/ui/form-error-summary';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import { SetupStepper } from '../../../shared/ui/setup-stepper';
import { Textarea } from '../../../shared/ui/textarea';
import { useToast } from '../../../shared/ui/toast-provider';
import { useDebouncedValue } from '../../../shared/hooks/use-debounced-value';
import type { Connection } from '../../connections/api/connections.types';
import { SuggestionDialog } from '../../content/components/suggestion-dialog';
import { resolveSuggestChannel } from '../../content/api/content.utils';
import { useProductQuery } from '../../products/hooks/use-product-query';
import { useProductsQuery } from '../../products/hooks/use-products-query';
import type { Product, ProductVariant } from '../../products/api/products.types';
import { useCreateOfferMutation } from '../hooks/use-create-offer-mutation';
import { useSellerPoliciesQuery } from '../hooks/use-seller-policies-query';
import { useCategoryParametersQuery } from '../hooks/use-category-parameters-query';
import { useCatalogProductMatchQuery } from '../hooks/use-catalog-product-match-query';
import { useCatalogProductQuery } from '../hooks/use-catalog-product-query';
import { CategoryPicker } from './CategoryPicker';
import { CategoryParametersStep } from './category-parameters-step';
import { autoPrefillParameters, prefillFromCatalogProduct } from './auto-prefill-parameters';
import { CatalogProductMatchPanel } from './catalog-product-match-panel';
import type { CatalogProduct } from '../api/listings.types';
import { buildParametersZodSchema } from './build-parameters-zod-schema';
import {
  MissingCategoryParameterSectionError,
  serializeAllegroParameters,
} from './serialize-allegro-parameters';
import type { CategoryParameterFormValues } from './category-parameter-form.types';
import type { CategoryParameter, CreateOfferRequest } from '../api/listings.types';
import {
  CREATE_OFFER_DEFAULT_VALUES,
  createOfferFieldsSchema,
  type CreateOfferFieldsSubmission,
  type CreateOfferFieldsValues,
} from './create-offer-fields.schema';
import { createOfferRequestToFormValues } from './create-offer-request-to-form-values';

const ALLEGRO_STEP_LABELS = [
  'Variant',
  'Offer details',
  'Category parameters',
  'Policies',
  'Review',
] as const;

const STEP_FIELDS: ReadonlyArray<ReadonlyArray<Path<CreateOfferFieldsValues>>> = [
  // Step 0 (Variant) — the connection is fixed by the launcher and pre-filled
  // into the form state; only the variant needs user input here.
  ['internalVariantId'],
  ['title', 'categoryId', 'priceAmount', 'priceCurrency', 'stock'],
  // Step 3 (parameters) is validated dynamically via buildParametersZodSchema —
  // its field shape is runtime-driven so we cannot list keys statically.
  [],
  ['deliveryPolicyId'],
  [],
];

const VARIANT_SEARCH_DEBOUNCE_MS = 300;
const VARIANT_PICKER_PAGE_SIZE = 10;

interface AllegroCreateOfferWizardProps {
  /** The marketplace connection the launcher resolved before mounting
   *  this wizard. The connection's id is pre-filled into the form
   *  state — never user-editable from inside the wizard. */
  connection: Connection;
  defaultVariantId?: string;
  /** Snapshot of a prior request, used by the retry path to pre-fill the
   *  wizard. Read once at mount (re-mount to consume a new snapshot). */
  initialValues?: CreateOfferRequest;
  /** Fired by the Cancel button on Step 0. The launcher uses this to
   *  close its surrounding Dialog. */
  onCancel: () => void;
  onSubmitted: (offerCreationRecordId: string, connectionId: string) => void;
}

/**
 * RHF cannot infer the dynamic `parameters.{paramId}` path from
 * `CreateOfferFieldsValues` (the `parameters` slice is `z.record(z.unknown())`
 * by design, since per-field shapes come from the runtime `CategoryParameter`
 * list). Centralise the cast so the unsafe widening lives in exactly one
 * place — every call site goes through this helper.
 */
function parametersFieldPath(paramId: string): FieldPath<CreateOfferFieldsValues> {
  return `parameters.${paramId}` as FieldPath<CreateOfferFieldsValues>;
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

interface ReviewParameterRow {
  id: string;
  label: string;
  value: string;
}

/**
 * Project the wizard's parameter form-state into a flat label/value list for
 * the Review step. Keeps the rendering data-flow inside the wizard rather
 * than leaking display logic into the field renderer.
 */
function renderReviewParameters(
  values: CategoryParameterFormValues,
  parameters: CategoryParameter[],
): ReviewParameterRow[] {
  const rows: ReviewParameterRow[] = [];
  for (const param of parameters) {
    const raw = values[param.id];
    if (raw === undefined || raw === '') continue;

    let display = '';
    if (Array.isArray(raw)) {
      if (raw.length === 0) continue;
      display = raw
        .map((id) => param.dictionary?.find((e) => e.id === id)?.value ?? id)
        .join(', ');
    } else if (typeof raw === 'string') {
      const matched = param.dictionary?.find((e) => e.id === raw);
      display = matched ? matched.value : raw;
    } else if (typeof raw === 'object' && raw !== null) {
      const r = raw as { from?: string; to?: string };
      const from = r.from?.trim() ?? '';
      const to = r.to?.trim() ?? '';
      if (from === '' && to === '') continue;
      display = `${from || '—'} – ${to || '—'}${param.unit ? ` ${param.unit}` : ''}`;
    } else {
      continue;
    }

    rows.push({ id: param.id, label: param.name, value: display });
  }
  return rows;
}

function renderReviewParametersBlock(
  values: CategoryParameterFormValues,
  parameters: CategoryParameter[],
): ReactElement | null {
  const rows = renderReviewParameters(values, parameters);
  if (rows.length === 0) return null;
  return (
    <>
      <dt>Category parameters</dt>
      <dd>
        <ul className="wizard-review-list__nested">
          {rows.map((row) => (
            <li key={row.id}>
              <span className="muted-text">{row.label}: </span>
              <span>{row.value}</span>
            </li>
          ))}
        </ul>
      </dd>
    </>
  );
}

export function AllegroCreateOfferWizard({
  connection,
  defaultVariantId,
  initialValues,
  onCancel,
  onSubmitted,
}: AllegroCreateOfferWizardProps): ReactElement {
  const mutation = useCreateOfferMutation();
  const { showToast } = useToast();
  // Fresh idempotency key per mount. Re-mount = launcher close+reopen =
  // a new key naturally (#307 acceptance preserved).
  const idempotencyKeyRef = useRef<string>(crypto.randomUUID());

  const form = useForm<CreateOfferFieldsValues, undefined, CreateOfferFieldsSubmission>({
    // Connection id is fixed by the launcher's pick. Variant defaults to
    // the launcher's hint (rarely supplied; retained for parity with the
    // contract) or empty for the picker to fill in.
    defaultValues: initialValues
      ? createOfferRequestToFormValues(initialValues, connection.id)
      : {
          ...CREATE_OFFER_DEFAULT_VALUES,
          connectionId: connection.id,
          internalVariantId: defaultVariantId ?? '',
        },
    resolver: zodResolver(createOfferFieldsSchema),
    mode: 'onBlur',
  });

  // Retry path: land directly on Step 2 with Steps 0/1 marked complete
  // when initialValues are supplied. Otherwise start at Step 0.
  const [stepIndex, setStepIndex] = useState(() => (initialValues ? 1 : 0));
  const [completedSteps, setCompletedSteps] = useState<ReadonlySet<number>>(() =>
    initialValues ? new Set([0, 1]) : new Set(),
  );
  const [productSearchInput, setProductSearchInput] = useState('');
  const [productOffset, setProductOffset] = useState(0);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  // True when the current session was opened via Retry with a snapshot.
  // Lets Step 0 render a hint explaining why the picker looks empty
  // despite the form carrying a variant id from the prior attempt.
  const wasPrefilled = initialValues !== undefined;
  // EAN of the variant the operator picked in Step 0 — fed to the Step 3
  // parameter auto-prefill so EAN/GTIN-class fields populate from the
  // variant's barcode without needing the variant detail re-fetched.
  const [pickedVariantEan, setPickedVariantEan] = useState<string | null>(null);
  // Product id of the variant the operator picked in Step 1. Captured here
  // (not derived from `selectedProductId`, which tracks the *expanded* card
  // and goes null on collapse-after-pick and on retry-with-initialValues)
  // so the Step-2 AI-suggest button has a stable productId to pass into
  // `SuggestionDialog`. Mirrors the `pickedVariantEan` pattern (#637).
  const [pickedProductId, setPickedProductId] = useState<string | null>(null);
  // Set of parameter ids that were auto-prefilled by `autoPrefillParameters`
  // for the current (connectionId, categoryId) pair. Surfaced to the step as
  // a `prefilledIds` hint; the step itself narrows the set per-render to
  // exclude any field the operator has dirtied (so the hint disappears once
  // they edit the value).
  const [prefilledIds, setPrefilledIds] = useState<ReadonlySet<string>>(new Set());
  // #423 — surfaces MissingCategoryParameterSectionError thrown by the
  // serializer when a stale TanStack Query cache returns a CategoryParameter
  // without `section`. Stores the offending parameter's name for the alert
  // copy. `null` means "no stale-data error active".
  const [staleSchemaError, setStaleSchemaError] = useState<string | null>(null);
  const debouncedProductSearch = useDebouncedValue(productSearchInput, VARIANT_SEARCH_DEBOUNCE_MS);

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

  // Connection id is fixed for the wizard's lifetime — driven by the
  // `connection` prop, mirrored into the form state for the API payload.
  const currentConnectionId = connection.id;

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

  // Step 2 AI-suggest (#637). The button can fire only when both inputs the
  // suggest endpoint needs are stable: the picked variant's product id (see
  // `pickedProductId`) and a channel resolvable from the connection's
  // platformType. Hint precedence mirrors EditOfferDrawer.tsx:80-85. The
  // connection is the launcher-resolved prop, stable for the wizard's
  // lifetime — no lookup needed.
  const suggestChannel = resolveSuggestChannel(connection.platformType);
  const canSuggest = pickedProductId !== null && suggestChannel !== null;
  const suggestDisabledHint =
    pickedProductId === null
      ? 'AI suggestions require a picked variant — go back to Step 1 and choose one.'
      : suggestChannel === null
        ? `AI suggestions are not available for ${connection.platformType} yet.`
        : null;

  // Destructured `setValue` is stable across renders — depending on the
  // wrapping `form` object would churn this callback identity each render
  // (same pattern as the drawer's `handleApplySuggestion`).
  const { setValue: setFormValue } = form;
  const handleApplySuggestion = useCallback(
    (suggestion: string) => {
      setFormValue('description', suggestion, { shouldDirty: true, shouldValidate: true });
    },
    [setFormValue],
  );

  // Step 3 (#410) — fetch the per-category parameter schema.
  const currentCategoryId = form.watch('categoryId');
  const categoryParametersQuery = useCategoryParametersQuery(
    currentConnectionId || undefined,
    currentCategoryId || undefined,
  );
  const categoryParameters = useMemo(
    () => categoryParametersQuery.data ?? [],
    [categoryParametersQuery.data],
  );

  // Auto-prefill EAN/Stan when the parameter schema first arrives for the
  // current (connectionId, categoryId) pair. Re-runs only when the pair
  // changes — values the operator has already typed are preserved.
  const prefilledKeyRef = useRef<string>('');
  useEffect(() => {
    if (categoryParametersQuery.data === undefined) return;
    const key = `${currentConnectionId}::${currentCategoryId}`;
    if (prefilledKeyRef.current === key) return;
    prefilledKeyRef.current = key;
    if (categoryParametersQuery.data.length === 0) {
      setPrefilledIds(new Set());
      return;
    }
    const filled = autoPrefillParameters(categoryParametersQuery.data, {
      ean: pickedVariantEan,
    });
    if (Object.keys(filled).length === 0) {
      setPrefilledIds(new Set());
      return;
    }
    const current =
      (form.getValues('parameters') as CategoryParameterFormValues | undefined) ?? {};
    // Operator-set values win over auto-fill — only fill keys the form
    // does not have a value for yet.
    const merged: CategoryParameterFormValues = { ...current };
    const filledIds = new Set<string>();
    for (const [paramId, value] of Object.entries(filled)) {
      if (current[paramId] === undefined || current[paramId] === '') {
        merged[paramId] = value;
        filledIds.add(paramId);
      }
    }
    if (filledIds.size > 0) {
      form.setValue('parameters', merged, { shouldDirty: false, shouldValidate: false });
    }
    setPrefilledIds(filledIds);
  }, [
    categoryParametersQuery.data,
    currentConnectionId,
    currentCategoryId,
    pickedVariantEan,
    form,
  ]);

  // Clear the parameters slice whenever the chosen category changes — the
  // shape is category-specific so prior values would never be valid under a
  // new schema.
  const lastCategoryIdRef = useRef<string>(currentCategoryId);
  useEffect(() => {
    if (lastCategoryIdRef.current && lastCategoryIdRef.current !== currentCategoryId) {
      form.setValue('parameters', {}, { shouldDirty: false, shouldValidate: false });
      form.clearErrors('parameters');
      setPrefilledIds(new Set());
      prefilledKeyRef.current = '';
      // Catalog-match state is tied to (variant, category) — reset on
      // category change so the lookup re-runs against the new category.
      setUnlinkedFromCatalog(false);
      setPickedAmbiguousProductId(null);
      setCatalogPrefilledIds(new Set());
      catalogPrefilledKeyRef.current = '';
      preCatalogSnapshotRef.current = null;
    }
    lastCategoryIdRef.current = currentCategoryId;
  }, [currentCategoryId, form]);

  // -----------------------------------------------------------------
  // Catalog product match (#635) — layered on top of the EAN/Stan prefill.
  // -----------------------------------------------------------------

  // Operator-controlled escape hatch: when true, the match query is disabled
  // and the panel renders the "Relink" affordance.
  const [unlinkedFromCatalog, setUnlinkedFromCatalog] = useState(false);
  // When the match is ambiguous, the operator picks one — its detail is
  // then fetched and applied as if the match had been unique.
  const [pickedAmbiguousProductId, setPickedAmbiguousProductId] = useState<string | null>(null);
  // Catalog-prefilled parameter ids — shown in the panel as "{N} fields
  // auto-filled" and used to bound the Unlink revert.
  const [catalogPrefilledIds, setCatalogPrefilledIds] = useState<ReadonlySet<string>>(new Set());
  // Snapshot of the form's parameters slice taken *before* catalog prefill
  // ran. Unlink restores this; clears when (variant, category) changes.
  const preCatalogSnapshotRef = useRef<CategoryParameterFormValues | null>(null);
  // Ensures the catalog prefill effect runs at most once per
  // (connection, category, picked-product) tuple.
  const catalogPrefilledKeyRef = useRef<string>('');

  // Reset catalog-match state when the variant (and therefore the EAN) changes
  // — a fresh variant means a different lookup. The match query's key already
  // depends on `pickedVariantEan`, so it will re-issue automatically; this
  // effect only resets the operator-controlled flags.
  const lastEanRef = useRef<string | null>(pickedVariantEan);
  useEffect(() => {
    if (lastEanRef.current !== pickedVariantEan) {
      setUnlinkedFromCatalog(false);
      setPickedAmbiguousProductId(null);
      setCatalogPrefilledIds(new Set());
      catalogPrefilledKeyRef.current = '';
      preCatalogSnapshotRef.current = null;
    }
    lastEanRef.current = pickedVariantEan;
  }, [pickedVariantEan]);

  // The query stays keyed on (connection, ean, category) regardless of the
  // unlink flag — the panel needs the catalog match result to render the
  // "Relink" affordance after Unlink, and TanStack Query keys the cache by
  // its inputs (zeroing them out would clear the cached match and the panel
  // would silently disappear). The unlink flag only gates the prefill
  // effect below.
  const catalogMatchQuery = useCatalogProductMatchQuery(
    currentConnectionId || undefined,
    pickedVariantEan || undefined,
    currentCategoryId || undefined,
  );

  const catalogProductQuery = useCatalogProductQuery(
    pickedAmbiguousProductId ? currentConnectionId || undefined : undefined,
    pickedAmbiguousProductId || undefined,
  );

  // Apply catalog prefill on top of the existing form values whenever the
  // match resolves to `unique` or the operator picks an ambiguous option.
  useEffect(() => {
    if (unlinkedFromCatalog) return;
    if (categoryParametersQuery.data === undefined) return;

    let product: CatalogProduct | undefined;
    if (catalogMatchQuery.data?.kind === 'unique') {
      product = catalogMatchQuery.data.product;
    } else if (pickedAmbiguousProductId && catalogProductQuery.data) {
      product = catalogProductQuery.data;
    }
    if (!product) return;

    const key = `${currentConnectionId}::${currentCategoryId}::${product.id}`;
    if (catalogPrefilledKeyRef.current === key) return;
    catalogPrefilledKeyRef.current = key;

    const currentForm =
      (form.getValues('parameters') as CategoryParameterFormValues | undefined) ?? {};
    // Snapshot the EAN/Stan-baseline form state — Unlink restores this.
    preCatalogSnapshotRef.current = { ...currentForm };

    const dirtyParams =
      ((form.formState.dirtyFields as { parameters?: Record<string, boolean> }).parameters ?? {});
    const { values: catalogValues, prefilledIds: catalogIds } = prefillFromCatalogProduct(
      categoryParametersQuery.data,
      product,
      dirtyParams,
    );

    if (catalogIds.size === 0) {
      setCatalogPrefilledIds(new Set());
      return;
    }
    const merged: CategoryParameterFormValues = { ...currentForm, ...catalogValues };
    form.setValue('parameters', merged, { shouldDirty: false, shouldValidate: false });
    setCatalogPrefilledIds(catalogIds);
  }, [
    catalogMatchQuery.data,
    catalogProductQuery.data,
    categoryParametersQuery.data,
    pickedAmbiguousProductId,
    unlinkedFromCatalog,
    currentConnectionId,
    currentCategoryId,
    form,
  ]);

  const handleUnlinkCatalog = useCallback(() => {
    if (preCatalogSnapshotRef.current) {
      form.setValue('parameters', preCatalogSnapshotRef.current, {
        shouldDirty: false,
        shouldValidate: false,
      });
    }
    setCatalogPrefilledIds(new Set());
    setUnlinkedFromCatalog(true);
    setPickedAmbiguousProductId(null);
    catalogPrefilledKeyRef.current = '';
  }, [form]);

  const handleRelinkCatalog = useCallback(() => {
    setUnlinkedFromCatalog(false);
    catalogPrefilledKeyRef.current = '';
  }, []);

  const handlePickAmbiguousCatalog = useCallback((productId: string) => {
    setPickedAmbiguousProductId(productId);
    catalogPrefilledKeyRef.current = '';
  }, []);

  const handleSkipAmbiguousCatalog = useCallback(() => {
    setPickedAmbiguousProductId(null);
    setUnlinkedFromCatalog(true);
  }, []);

  const validationMessages = Object.values(form.formState.errors).flatMap((e) =>
    e?.message ? [String(e.message)] : [],
  );

  async function goNext(): Promise<void> {
    const fields = STEP_FIELDS[stepIndex];
    if (fields.length > 0) {
      const valid = await form.trigger([...fields]);
      if (!valid) return;
    }

    // Step 3 (#410) — dynamic per-category Zod validation. Skipped when the
    // category has no parameters or when the schema is still loading (the
    // serialiser drops empty/missing values, so an under-filled draft just
    // produces a smaller payload — submission still surfaces server-side
    // validation errors at the Review step).
    if (stepIndex === 2 && categoryParameters.length > 0) {
      const values =
        (form.getValues('parameters') as CategoryParameterFormValues | undefined) ?? {};
      const result = buildParametersZodSchema(categoryParameters).safeParse(values);
      if (!result.success) {
        // Surface per-field issues onto the form — the renderer reads them
        // via `formState.errors['parameters.{paramId}']`.
        form.clearErrors('parameters');
        for (const issue of result.error.issues) {
          const paramId = String(issue.path[0] ?? '');
          if (paramId === '') continue;
          form.setError(parametersFieldPath(paramId), {
            type: 'manual',
            message: issue.message,
          });
        }
        return;
      }
      form.clearErrors('parameters');
    }

    setCompletedSteps((prev) => new Set(prev).add(stepIndex));
    setStepIndex((i) => Math.min(i + 1, ALLEGRO_STEP_LABELS.length - 1));
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
    // Capture the variant's EAN for Step 3 auto-prefill (EAN/GTIN parameters
    // populate from the variant's barcode).
    setPickedVariantEan(variant.ean ?? null);
    // Capture the product id for the Step-2 AI suggest button (#637).
    setPickedProductId(product.id);
  }

  const onSubmit = form.handleSubmit(async (values) => {
    setStaleSchemaError(null); // clear from any prior submit

    const platformParams: Record<string, unknown> = { deliveryPolicyId: values.deliveryPolicyId };
    if (values.returnPolicyId) platformParams.returnPolicyId = values.returnPolicyId;
    if (values.warrantyId) platformParams.warrantyId = values.warrantyId;
    if (values.impliedWarrantyId) platformParams.impliedWarrantyId = values.impliedWarrantyId;

    // Serialise Step-3 parameter values into Allegro's wire shape. The
    // serialiser drops empty / hidden values so an underfilled draft just
    // produces a smaller payload — server-side validation surfaces any
    // remaining required-field gaps via `mutation.error`. The output is
    // split into offer-section and product-section arrays per #415; each
    // travels under a different key on the create-offer body.
    //
    // #423 — `serializeAllegroParameters` throws `MissingCategoryParameterSectionError`
    // when a CategoryParameter arrives without a `section` value (a stale
    // cache predating #417). Catch the typed error and surface it through
    // `staleSchemaError` so the operator gets an actionable "reload the
    // wizard" message — anything else rethrows as a real bug.
    let offerParameters: ReturnType<typeof serializeAllegroParameters>['offerParameters'];
    let productParameters: ReturnType<typeof serializeAllegroParameters>['productParameters'];
    try {
      ({ offerParameters, productParameters } = serializeAllegroParameters(
        (values.parameters as CategoryParameterFormValues | undefined) ?? {},
        categoryParameters,
      ));
    } catch (error) {
      if (error instanceof MissingCategoryParameterSectionError) {
        setStaleSchemaError(error.parameterName);
        return;
      }
      throw error;
    }

    if (offerParameters.length > 0) {
      platformParams.parameters = offerParameters;
    }
    if (productParameters.length > 0) {
      platformParams.productParameters = productParameters;
    }

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
      onCancel();
    } catch {
      // Inline Alert renders from mutation.error; retry will reuse the
      // same idempotency key so the server de-duplicates to the same
      // OfferCreationRecord rather than creating a new one.
    }
  });

  const values = form.watch();
  const selectedVariantId = values.internalVariantId;

  return (
    <div className="allegro-create-offer-wizard">
      <header className="allegro-create-offer-wizard__header">
        <h2 className="allegro-create-offer-wizard__title">Create Allegro offer</h2>
        <p className="allegro-create-offer-wizard__subtitle">
          Publishing to <strong>{connection.name}</strong>{' '}
          <span className="mono-text muted-text">({connection.platformType})</span>
        </p>
      </header>

      <SetupStepper steps={ALLEGRO_STEP_LABELS} currentStep={stepIndex} completedSteps={completedSteps} />

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
              Category parameter <strong>{staleSchemaError}</strong> is missing data that was
              added in a recent update. Please reload this page to refetch the latest category
              schema.
            </p>
            <p>
              <strong>Reloading will discard your in-progress wizard values</strong> — copy
              the offer title, price, and any filled fields before refreshing if you want to
              preserve them.
            </p>
            <div className="alert__actions">
              <Button
                type="button"
                tone="primary"
                onClick={() => window.location.reload()}
              >
                Reload now
              </Button>
              <Button
                type="button"
                tone="ghost"
                onClick={() => setStaleSchemaError(null)}
              >
                Dismiss
              </Button>
            </div>
          </Alert>
        ) : null}

        <FormProvider {...form}>
        <form
          id="create-offer-form"
          onSubmit={(e) => void onSubmit(e)}
          noValidate
          className="create-offer-form"
        >
          {stepIndex === 0 ? (
            <>
              {wasPrefilled ? (
                <Alert tone="info" title="Prior attempt re-loaded">
                  Variant was copied from the failed attempt. Search to change the variant if
                  the original selection was wrong.
                </Alert>
              ) : null}

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

              {/* Manual form-field layout — Controller + custom control means we
                  can't use the shared FormField (which clones a single forwardRef
                  child to inject ARIA wiring). We keep the same class structure
                  so visual alignment with other fields is preserved. */}
              <div className="form-field">
                <span id="categoryId-label" className="form-field__label">
                  Allegro category
                </span>
                <Controller
                  control={form.control}
                  name="categoryId"
                  render={({ field, fieldState }) => (
                    <CategoryPicker
                      connectionId={currentConnectionId}
                      value={field.value || null}
                      onChange={field.onChange}
                      invalid={Boolean(fieldState.error)}
                      aria-labelledby="categoryId-label"
                      aria-describedby="categoryId-description categoryId-error"
                    />
                  )}
                />
                <p id="categoryId-description" className="form-field__description">
                  Browse the Allegro tree and pick a leaf category.
                </p>
                {form.formState.errors.categoryId?.message ? (
                  <p id="categoryId-error" className="form-field__error" role="alert">
                    {form.formState.errors.categoryId.message}
                  </p>
                ) : null}
              </div>

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

              <div className="create-offer-description">
                {canSuggest || suggestDisabledHint ? (
                  <div className="create-offer-description__actions">
                    {canSuggest && pickedProductId !== null ? (
                      <SuggestionDialog
                        productId={pickedProductId}
                        channel={suggestChannel}
                        disabled={mutation.isPending}
                        onApply={handleApplySuggestion}
                      />
                    ) : (
                      <span
                        className="create-offer-description__hint"
                        aria-live="polite"
                      >
                        {suggestDisabledHint}
                      </span>
                    )}
                  </div>
                ) : null}

                <FormField
                  label="Description (optional)"
                  name="description"
                  error={form.formState.errors.description?.message}
                >
                  <Textarea {...form.register('description')} rows={4} />
                </FormField>
              </div>

              <label className="create-offer-checkbox">
                <input type="checkbox" {...form.register('publishImmediately')} />
                <span>Publish immediately (uncheck to create as a draft)</span>
              </label>
            </>
          ) : null}

          {stepIndex === 2 ? (
            <>
              {categoryParametersQuery.isLoading ? (
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
                <p className="muted-text">
                  No additional parameters required for this category.
                </p>
              ) : (
                <>
                  {pickedVariantEan ? (
                    <CatalogProductMatchPanel
                      result={catalogMatchQuery.data}
                      unlinked={unlinkedFromCatalog}
                      prefilledCount={catalogPrefilledIds.size}
                      isLoading={catalogMatchQuery.isLoading}
                      barcode={pickedVariantEan}
                      onUnlink={handleUnlinkCatalog}
                      onRelink={handleRelinkCatalog}
                      onPickAmbiguous={handlePickAmbiguousCatalog}
                      onSkipAmbiguous={handleSkipAmbiguousCatalog}
                    />
                  ) : null}
                  <CategoryParametersStep
                    parameters={categoryParameters}
                    formNamespace="parameters"
                    prefilledIds={prefilledIds}
                  />
                </>
              )}
            </>
          ) : null}

          {stepIndex === 3 ? (
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

              <FormField
                label="Implied warranty (optional)"
                name="impliedWarrantyId"
                description="Allegro requires a Warranty selection alongside Implied warranty; otherwise the value is dropped from the request."
              >
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

          {stepIndex === 4 ? (
            <dl className="wizard-review-list">
              <dt>Connection</dt>
              <dd>{connection.name}</dd>
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
              {renderReviewParametersBlock(
                (values.parameters as CategoryParameterFormValues | undefined) ?? {},
                categoryParameters,
              )}
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
        </FormProvider>

      <div className="wizard-actions">
        <div className="wizard-actions__group">
          {stepIndex > 0 ? (
            <Button tone="secondary" type="button" onClick={goBack}>
              Back
            </Button>
          ) : (
            <Button tone="ghost" type="button" onClick={onCancel}>
              Cancel
            </Button>
          )}
        </div>
        <div className="wizard-actions__group">
          {stepIndex < ALLEGRO_STEP_LABELS.length - 1 ? (
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
    </div>
  );
}
