/**
 * Bulk Edit Modal - per-variant two-pane editor (#1741)
 *
 * Edits one product's SHARED BASE override plus per-VARIANT overrides with
 * inherit/override semantics. Multi-variant products render a two-pane editor
 * (left rail = keyboarded scope selector, right = the active scope's form; a
 * mobile accordion below 640px). Simple / single-variant products render a flat
 * form with no rail and no inheritance layer.
 *
 * Override-presence is tracked EXPLICITLY in a per-variant edit model (not RHF
 * `dirty`) - an inherited field pre-filled with the base value is not "dirty"
 * yet must render inherited (plan §7 B1). The base scope is the only RHF form;
 * it hosts the reused single-offer subcomponents (`CategoryParametersStep`,
 * `SuggestionDialog`) via `useFormContext()`. Category selection for a browsable
 * destination moves to the external `BulkCategoryChooseModal` (opened from the
 * chip); the borrowed-taxonomy path keeps its inline id text input. Per-variant
 * fields are plain controlled inputs bound to the edit model.
 *
 * `onSave` hands the wizard the base override, the per-variant override map, the
 * inclusion map, and an FE-only form-values stash (so reopening restores entered
 * values); the wizard maps base -> `perProductOverrides`, per-variant ->
 * `perVariantOverrides`, and `!included` -> `excludedVariantIds` at submit.
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import {
  Fragment,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  FormProvider,
  useForm,
  useFormContext,
  type UseFormReturn,
} from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { usePlatform, type BulkOfferRowSectionProps } from '../../../../shared/plugins';
import type { Connection } from '../../../connections';
import { Alert, Button, ConfirmDialog, FormField, Input, Textarea } from '../../../../shared/ui';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../shared/ui/tooltip';
import { ReadOnlyLock } from '../../../../shared/ui/read-only-lock';
import { DEMO_READ_ONLY_ACTION_MESSAGE } from '../../../../shared/config/demo-mode';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../../../shared/ui/dialog';
import { Combobox, type ComboboxValue } from '../../../../shared/ui/combobox';
import { SuggestionDialog } from '../../../content';
import {
  CategoryParametersStep,
  fromComboboxValue,
  toComboboxOption,
  toComboboxValue,
} from '../category-parameters-step';
import { BulkCategoryChooseModal } from './bulk-category-choose-modal';
import { BulkImageLightbox } from './bulk-image-lightbox';
import { ErliDeliveryPriceListOverrideField } from '../erli/erli-delivery-price-list-override-field';
import { useCategoryParametersQuery } from '../../hooks/use-category-parameters-query';
import { useCategoryPathQuery } from '../../../mappings';
import {
  MissingCategoryParameterSectionError,
  categoryParametersToOfferParameters,
} from '../category-parameters-to-offer-parameters';
import { isParameterVisible } from '../category-parameter-visibility';
import { injectEanParameter, isEanParameterName } from '../auto-prefill-parameters';
import type { CategoryParameter, OfferParameter } from '../../api/listings.types';
import type { CategoryParameterFormValues, FormParameterValue } from '../category-parameter-form.types';
import {
  makeBulkEditModalSchema,
  type BulkEditModalSubmission,
  type BulkEditModalValues,
} from './bulk-edit-modal.schema';
import type {
  BulkVariantRow,
  BulkWizardRow,
  PricingPolicy,
  PricingPolicyMode,
  StockPolicy,
  StockPolicyMode,
} from './bulk-wizard.types';
import {
  computeResolvedPrice,
  distinguishingLabel,
  duplicateEanVariantIds,
  isValidGtin,
  pricingPolicyEquals,
  stockPolicyEquals,
} from './bulk-policy';
import type { BulkOfferOverrides, BulkPerProductOverride } from '../../api/bulk-listings.types';

// Grouping-determining category parameters - shared across siblings, edited on
// the base scope only (a per-variant Brand/Condition would split the Allegro
// catalog-product family). Matched by parameter name (open-world per category).
const BASE_ONLY_PARAM_NAMES = ['marka', 'brand', 'stan', 'condition'];

// Mirrors `CategoryParametersStep`'s NATIVE_SELECT_THRESHOLD: a single-select
// dictionary with fewer entries (and no custom values) renders as a native
// <select>; larger / multi / custom-value dictionaries use the Combobox.
const DICTIONARY_NATIVE_SELECT_THRESHOLD = 50;

// ── Per-product policy helpers (#1741) ───────────────────────────────────────
// Build a new policy when the operator changes the select mode / parameter,
// preserving the current parameter across a same-mode round-trip and defaulting
// (mirroring the Config step's seeds) when switching into a parametered mode.

function nextPricingPolicy(mode: PricingPolicyMode, current: PricingPolicy): PricingPolicy {
  if (mode === 'markup') {
    return { mode: 'markup', percent: current.mode === 'markup' ? current.percent : 10 };
  }
  if (mode === 'flat') {
    return { mode: 'flat', amount: current.mode === 'flat' ? current.amount : 0 };
  }
  return { mode: 'use-master' };
}

function pricingParamValue(policy: PricingPolicy): string {
  if (policy.mode === 'markup') return String(policy.percent);
  if (policy.mode === 'flat') return String(policy.amount);
  return '';
}

function withPricingParam(policy: PricingPolicy, raw: string): PricingPolicy {
  const n = Number(raw.replace(',', '.'));
  const value = Number.isFinite(n) ? n : 0;
  if (policy.mode === 'markup') return { mode: 'markup', percent: value };
  if (policy.mode === 'flat') return { mode: 'flat', amount: value };
  return policy;
}

function nextStockPolicy(mode: StockPolicyMode, current: StockPolicy): StockPolicy {
  if (mode === 'cap') {
    return { mode: 'cap', value: current.mode === 'cap' ? current.value : 5 };
  }
  if (mode === 'flat') {
    return { mode: 'flat', value: current.mode === 'flat' ? current.value : 1 };
  }
  return { mode: 'use-master' };
}

function stockParamValue(policy: StockPolicy): string {
  return policy.mode === 'cap' || policy.mode === 'flat' ? String(policy.value) : '';
}

function withStockParam(policy: StockPolicy, raw: string): StockPolicy {
  const n = Number(raw);
  const value = Number.isFinite(n) ? n : 0;
  if (policy.mode === 'cap') return { mode: 'cap', value };
  if (policy.mode === 'flat') return { mode: 'flat', value };
  return policy;
}

/**
 * Concrete base price a variant inherits when its own price is left un-overridden
 * (#1741). Prefers an explicit operator base price, else the shared-base pricing
 * policy resolved against this variant's master price (the same resolution the
 * Review row uses). Returns '' when nothing is resolvable, so the inherited Price
 * field pre-fills the real base value (or shows empty), never a placeholder hint.
 */
function resolveBasePrice(
  baseValues: BulkEditModalValues,
  pricingPolicy: PricingPolicy,
  masterPrice: number | null,
): string {
  if (baseValues.priceAmount.trim() !== '') return baseValues.priceAmount.trim();
  const resolved = computeResolvedPrice(pricingPolicy, masterPrice, {});
  return resolved.value !== null ? resolved.value.toFixed(2) : '';
}

interface BulkEditModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: BulkWizardRow;
  /**
   * The batch's marketplace connection. Drives the `CategoryPicker` (by id), the
   * per-row platform section resolved via `platformType`, and the platform
   * display name used in title-limit / AI-channel copy.
   */
  connection: Connection;
  /**
   * Whether the destination exposes a browsable category tree (`CategoryBrowser`,
   * #1096). True -> the tree picker + category-parameter step. False -> a manual
   * marketplace-category-id input and no parameter step (Erli borrows the Allegro
   * id, ADR-025 §3).
   */
  canBrowseCategories: boolean;
  /** Batch-wide listing currency (read-only in the editor; set on the Config step). */
  currency: string;
  /** Defaults for fields the operator hasn't overridden yet. */
  defaults: { publishImmediately: boolean };
  /**
   * Batch pricing/stock policy (from the Config step). Seeds the multi-variant
   * shared-base policy selects so they start inheriting; a per-product divergence
   * is emitted on the base override and wins in resolution (#1741). Defaults to
   * `use-master` when omitted.
   */
  pricingPolicy?: PricingPolicy;
  stockPolicy?: StockPolicy;
  /**
   * Batch-wide delivery price list picked on the Config step (#1530). Seeds the
   * per-row override field so it starts inheriting. Erli-only.
   */
  batchDeliveryPriceList?: string;
  /**
   * Save handler. Receives the product id, the shared BASE override, the
   * per-variant override map (keyed by actual variant id), the inclusion map
   * (variant id -> included), and an FE-only form-values stash the wizard keeps
   * on the row so reopening restores entered values.
   */
  onSave: (
    productId: string,
    baseOverride: BulkPerProductOverride,
    perVariantOverrides: Record<string, BulkPerProductOverride>,
    includedByVariantId: Record<string, boolean>,
    editFormValues: Record<string, unknown>,
  ) => void;
  /** Variant id to open focused on (from a Review-step blocker chip). */
  focusVariantId?: string;
  /**
   * Demo read-only viewer (#1704). Disables every field edit + image add/remove
   * and locks "Save all" behind a read-only tooltip, matching the Config +
   * Confirm gating - nothing persists to wizard state.
   */
  demoReadOnly?: boolean;
}

export function BulkEditModal({
  open,
  onOpenChange,
  row,
  connection,
  canBrowseCategories,
  currency,
  defaults,
  pricingPolicy = { mode: 'use-master' },
  stockPolicy = { mode: 'use-master' },
  batchDeliveryPriceList,
  onSave,
  focusVariantId,
  demoReadOnly = false,
}: BulkEditModalProps): ReactElement | null {
  const [dirty, setDirty] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);

  if (row.variants.length === 0) return null;

  const requestClose = (): void => {
    if (dirty) {
      setDiscardOpen(true);
    } else {
      onOpenChange(false);
    }
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (next) {
            onOpenChange(true);
          } else {
            requestClose();
          }
        }}
      >
        <DialogContent
          className="bulk-editor__content"
          onEscapeKeyDown={(event) => {
            if (dirty) {
              event.preventDefault();
              setDiscardOpen(true);
            }
          }}
          onInteractOutside={(event) => {
            if (dirty) {
              event.preventDefault();
              setDiscardOpen(true);
            }
          }}
        >
          <BulkEditModalForm
            row={row}
            connection={connection}
            canBrowseCategories={canBrowseCategories}
            currency={currency}
            defaults={defaults}
            batchPricingPolicy={pricingPolicy}
            batchStockPolicy={stockPolicy}
            batchDeliveryPriceList={batchDeliveryPriceList ?? ''}
            focusVariantId={focusVariantId}
            demoReadOnly={demoReadOnly}
            onDirtyChange={setDirty}
            onRequestClose={requestClose}
            onSave={onSave}
            onClose={() => {
              onOpenChange(false);
            }}
          />
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        className="dialog__content--elevated"
        overlayClassName="dialog__overlay--elevated"
        title="Discard changes?"
        description="You have unsaved edits in this editor. Closing without saving will discard them."
        cancelLabel="Keep editing"
        confirmLabel="Discard changes"
        tone="danger"
        onConfirm={() => {
          setDiscardOpen(false);
          onOpenChange(false);
        }}
      />
    </>
  );
}

// ── Per-variant edit model ───────────────────────────────────────────────────

/**
 * Explicit per-variant override model. A key present ⇒ the operator overrode
 * that field (renders `--overridden` + a reset affordance); absent ⇒ inherited
 * from base (renders `--inherited` with the base default as placeholder). `ean`
 * always holds the current effective value; whether it is an override is derived
 * against the master barcode.
 */
interface VariantEdit {
  ean: string;
  price?: string;
  publishImmediately?: boolean;
  title?: string;
  description?: string;
  imageUrls?: string[];
  productCardId?: string;
  categoryId?: string;
  // Per-variant category-parameter overrides. Values mirror the base form's
  // `FormParameterValue` (dictionary single = entry id; multi = ids[]; string /
  // numeric = raw text), so a dictionary override can use the same select /
  // combobox control the base scope uses (#1741). Absent key = inherited.
  params: Record<string, FormParameterValue>;
}

function masterBarcodeOf(variant: BulkVariantRow): string {
  return (variant.variant.ean ?? variant.variant.gtin ?? '').trim();
}

function initVariantEdit(variant: BulkVariantRow): VariantEdit {
  const o = variant.override.overrides ?? {};
  return {
    ean: (o.ean ?? masterBarcodeOf(variant)).trim(),
    price: variant.override.price !== undefined ? String(variant.override.price.amount) : undefined,
    publishImmediately: variant.override.publishImmediately,
    title: typeof o.title === 'string' ? o.title : undefined,
    description: typeof o.description === 'string' ? o.description : undefined,
    imageUrls: Array.isArray(o.imageUrls) ? o.imageUrls : undefined,
    productCardId: o.productCardId,
    categoryId: o.categoryId,
    params: {},
  };
}

type ScopeStatusKind = 'base' | 'ok' | 'attn' | 'off';

interface BulkEditModalFormProps {
  row: BulkWizardRow;
  connection: Connection;
  canBrowseCategories: boolean;
  currency: string;
  defaults: { publishImmediately: boolean };
  batchPricingPolicy: PricingPolicy;
  batchStockPolicy: StockPolicy;
  batchDeliveryPriceList: string;
  focusVariantId?: string;
  demoReadOnly: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onRequestClose: () => void;
  onSave: BulkEditModalProps['onSave'];
  onClose: () => void;
}

function BulkEditModalForm({
  row,
  connection,
  canBrowseCategories,
  currency,
  defaults,
  batchPricingPolicy,
  batchStockPolicy,
  batchDeliveryPriceList,
  focusVariantId,
  demoReadOnly,
  onDirtyChange,
  onRequestClose,
  onSave,
  onClose,
}: BulkEditModalFormProps): ReactElement {
  const connectionId = connection.id;
  const platform = usePlatform(connection.platformType);
  const platformName = platform?.displayName ?? connection.platformType;
  const platformSection = platform?.bulkOfferRowSection;
  const isMultiVariant = row.variants.length > 1;
  const masterImages = useMemo(
    () => (row.product?.images ?? []).filter((u): u is string => typeof u === 'string' && u.trim() !== ''),
    [row.product?.images],
  );

  const [scope, setScope] = useState<string>(
    () => (isMultiVariant && focusVariantId ? focusVariantId : isMultiVariant ? 'base' : 'simple'),
  );

  // Per-variant edit model + inclusion (source of truth for override presence).
  const [variantEdits, setVariantEdits] = useState<Record<string, VariantEdit>>(() => {
    const map: Record<string, VariantEdit> = {};
    for (const v of row.variants) map[v.variantId] = initVariantEdit(v);
    return map;
  });
  const [included, setIncluded] = useState<Record<string, boolean>>(() => {
    const map: Record<string, boolean> = {};
    for (const v of row.variants) map[v.variantId] = v.included;
    return map;
  });

  // Product-level platform overrides (#1096) - shared base scope.
  const [platformParams, setPlatformParams] = useState<Record<string, unknown>>(
    () => ({ ...(row.override.overrides?.platformParams ?? {}) }),
  );

  // Base image override (#1741). `undefined` ⇒ inherit the master image set (no
  // override emitted); an array ⇒ operator edited the set (add/remove).
  const [baseImageUrls, setBaseImageUrls] = useState<string[] | undefined>(() => {
    const o = row.override.overrides?.imageUrls;
    return Array.isArray(o) ? o : undefined;
  });

  // Per-product pricing/stock policy for the multi-variant shared-base scope
  // (#1741). Seeded from the batch policy (or a persisted per-product override),
  // so the selects read as "inherits the batch default" until the operator
  // diverges. Simple products keep their explicit Price/Stock inputs instead.
  const [pricingPolicy, setPricingPolicy] = useState<PricingPolicy>(
    () => row.override.pricingPolicy ?? batchPricingPolicy,
  );
  const [stockPolicy, setStockPolicy] = useState<StockPolicy>(
    () => row.override.stockPolicy ?? batchStockPolicy,
  );

  // External Choose-category modal (browsable destinations only) + the captured
  // breadcrumb path names for the chip. `null` ⇒ fall back to the raw id.
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [categoryPathNames, setCategoryPathNames] = useState<string[] | null>(null);

  // Image zoom lightbox (shared with the Review step). Zooming is always allowed,
  // even for a demo read-only viewer - only edit actions (add/remove) are gated.
  const [zoomSrc, setZoomSrc] = useState<string | null>(null);

  // Lifted base RHF values (reactive consumers: the params query + inherit
  // placeholders) + an imperative handle for save-time validation. The initial
  // shape is captured once at mount (a background availability refetch can
  // mutate `row` while the modal is open; binding to this snapshot avoids
  // clobbering in-progress edits, #792).
  const initialBase = useMemo<BulkEditModalValues>(() => {
    const o = row.override.overrides ?? {};
    return {
      title: o.title ?? row.product?.name ?? '',
      categoryId: o.categoryId ?? row.resolvedCategoryId ?? '',
      productCardId: o.productCardId ?? row.resolvedProductCardId ?? '',
      // Simple products expose an offer-level barcode field; prefill it from the
      // lone variant's master barcode. Multi-variant products leave it blank
      // (each sibling carries its own EAN in the per-variant scope).
      ean: o.ean ?? (row.variants.length === 1 ? masterBarcodeOf(row.variants[0]) : ''),
      description: typeof o.description === 'string' ? o.description : row.product?.description ?? '',
      priceAmount: row.override.price !== undefined ? String(row.override.price.amount) : '',
      stock: row.override.stock ?? row.masterStock ?? 0,
      publishImmediately: row.override.publishImmediately ?? defaults.publishImmediately,
      parameters: (row.editFormValues?.parameters as Record<string, unknown> | undefined) ?? {},
    };
  }, []);
  const [baseValues, setBaseValues] = useState<BulkEditModalValues>(initialBase);
  const baseFormRef = useRef<UseFormReturn<BulkEditModalValues, undefined, BulkEditModalSubmission> | null>(null);

  const categoryParametersQuery = useCategoryParametersQuery(
    connectionId,
    canBrowseCategories && typeof baseValues.categoryId === 'string' && baseValues.categoryId.length > 0
      ? baseValues.categoryId
      : '',
  );
  const categoryParameters: CategoryParameter[] = categoryParametersQuery.data ?? [];
  // The EAN/GTIN category parameter is hidden from the rendered UI - its value is
  // owned by the dedicated offer-EAN field and re-injected at submit (#1741). The
  // full `categoryParameters` set is kept for serialization; only the display set
  // is filtered (a bulk-local copy, so the shared CategoryParametersStep is
  // untouched for its other consumers).
  const renderableCategoryParameters = useMemo(
    () => categoryParameters.filter((p) => !isEanParameterName(p.name)),
    [categoryParameters],
  );

  // ── Dirty tracking (vs the on-open snapshot) ──
  const snapshotRef = useRef<string | null>(null);
  const liveState = JSON.stringify({
    variantEdits,
    included,
    platformParams,
    baseValues,
    baseImageUrls,
    pricingPolicy,
    stockPolicy,
  });
  if (snapshotRef.current === null) snapshotRef.current = liveState;
  useEffect(() => {
    onDirtyChange(liveState !== snapshotRef.current);
  }, [liveState, onDirtyChange]);

  const dupEanIds = useMemo(() => duplicateEanVariantIds([applyEditsToRow(row, variantEdits, included)]), [
    row,
    variantEdits,
    included,
  ]);

  // ── Per-variant edit helpers ──
  const patchVariant = useCallback((variantId: string, patch: Partial<VariantEdit>): void => {
    setVariantEdits((prev) => ({ ...prev, [variantId]: { ...prev[variantId], ...patch } }));
  }, []);
  const setVariantParam = useCallback((variantId: string, paramId: string, value: FormParameterValue): void => {
    setVariantEdits((prev) => {
      const current = prev[variantId];
      const params = { ...current.params };
      // undefined / empty string / empty array all revert to inherited.
      if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) {
        delete params[paramId];
      } else {
        params[paramId] = value;
      }
      return { ...prev, [variantId]: { ...current, params } };
    });
  }, []);

  // ── Save ──
  const handleSaveAll = async (): Promise<void> => {
    const baseForm = baseFormRef.current;
    if (!baseForm) return;
    const valid = await baseForm.trigger();
    if (!valid) {
      setScope(isMultiVariant ? 'base' : 'simple');
      return;
    }
    const values = baseForm.getValues();

    let baseParameters: OfferParameter[] = [];
    if (categoryParameters.length > 0 && values.parameters) {
      try {
        baseParameters = categoryParametersToOfferParameters(
          values.parameters as CategoryParameterFormValues,
          categoryParameters,
        );
      } catch (error) {
        if (error instanceof MissingCategoryParameterSectionError) {
          baseForm.setError('categoryId', {
            type: 'manual',
            message: 'Category parameter schema is stale. Close the wizard, reopen it, and try again.',
          });
          setScope(isMultiVariant ? 'base' : 'simple');
          return;
        }
        throw error;
      }
    }
    // Fill the (hidden) EAN/GTIN category slot from the dedicated offer-EAN field
    // so it can never diverge; empty EAN omits it (#1741). Simple products source
    // it from `values.ean`; multi-variant base carries no offer-EAN (each sibling
    // fills its own below), so this drops the base GTIN slot.
    baseParameters = injectEanParameter(baseParameters, categoryParameters, values.ean.trim());

    const baseAmount = values.priceAmount.trim();
    // Offer barcode (simple products): emit only when the operator diverged from
    // the lone variant's master barcode - a blank or unchanged value inherits.
    const baseEan = values.ean.trim();
    const primaryMasterBarcode = masterBarcodeOf(row.variants[0]);
    // Per-product policy is emitted only for a multi-variant product and only
    // when it diverges from the batch default (#1741); simple products use their
    // explicit Price/Stock inputs instead.
    const pricingDiverges = isMultiVariant && !pricingPolicyEquals(pricingPolicy, batchPricingPolicy);
    const stockDiverges = isMultiVariant && !stockPolicyEquals(stockPolicy, batchStockPolicy);
    const baseOverride: BulkPerProductOverride = {
      publishImmediately: values.publishImmediately,
      ...(baseAmount !== '' ? { price: { amount: Number(baseAmount.replace(',', '.')), currency } } : {}),
      // Stock is only meaningful for a simple product; master stock is
      // authoritative (incl. 0) for multi-variant siblings.
      ...(!isMultiVariant ? { stock: Number(values.stock) } : {}),
      ...(pricingDiverges ? { pricingPolicy } : {}),
      ...(stockDiverges ? { stockPolicy } : {}),
      overrides: {
        title: values.title,
        description: values.description === '' ? null : values.description,
        ...(values.categoryId ? { categoryId: values.categoryId } : {}),
        ...(values.productCardId ? { productCardId: values.productCardId } : {}),
        ...(baseEan !== '' && baseEan !== primaryMasterBarcode ? { ean: baseEan } : {}),
        ...(baseImageUrls !== undefined ? { imageUrls: baseImageUrls } : {}),
        ...(baseParameters.length > 0 ? { parameters: baseParameters } : {}),
        ...(Object.keys(platformParams).length > 0 ? { platformParams } : {}),
      },
    };

    const perVariantOverrides: Record<string, BulkPerProductOverride> = {};
    if (isMultiVariant) {
      const baseParamValues = (values.parameters ?? {}) as CategoryParameterFormValues;
      for (const variant of row.variants) {
        const edit = variantEdits[variant.variantId];
        const overrides: BulkOfferOverrides = {};

        const eanTrimmed = edit.ean.trim();
        if (eanTrimmed !== '' && eanTrimmed !== masterBarcodeOf(variant)) overrides.ean = eanTrimmed;
        if (edit.title !== undefined) overrides.title = edit.title;
        if (edit.description !== undefined) overrides.description = edit.description;
        if (edit.imageUrls !== undefined) overrides.imageUrls = edit.imageUrls;
        if (edit.categoryId !== undefined) overrides.categoryId = edit.categoryId;
        if (edit.productCardId !== undefined) overrides.productCardId = edit.productCardId;

        // Emit the effective parameters array whole (base ∪ per-variant param
        // overrides) so the BE whole-array-replaces (plan §7).
        if (categoryParameters.length > 0) {
          const effective: CategoryParameterFormValues = { ...baseParamValues, ...edit.params };
          try {
            let params = categoryParametersToOfferParameters(effective, categoryParameters);
            // Fill the (hidden) EAN/GTIN slot from this sibling's dedicated EAN
            // field (its single source, pre-filled from master) so the wire GTIN
            // and the catalog self-link key can never diverge (#1741).
            params = injectEanParameter(params, categoryParameters, eanTrimmed);
            if (params.length > 0) overrides.parameters = params;
          } catch {
            // Stale schema for this variant - skip its param emission; base
            // params still cover grouping-determining fields.
          }
        }

        const override: BulkPerProductOverride = {
          ...(edit.publishImmediately !== undefined ? { publishImmediately: edit.publishImmediately } : {}),
          ...(edit.price !== undefined && edit.price.trim() !== ''
            ? { price: { amount: Number(edit.price.replace(',', '.')), currency } }
            : {}),
          ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
        };
        if (Object.keys(override).length > 0) perVariantOverrides[variant.variantId] = override;
      }
    }

    const editFormValues: Record<string, unknown> = {
      parameters: values.parameters ?? {},
      base: values,
      variantParams: Object.fromEntries(Object.entries(variantEdits).map(([id, e]) => [id, e.params])),
    };

    onSave(row.productId, baseOverride, perVariantOverrides, { ...included }, editFormValues);
    onClose();
  };

  // ── Scope list + status ──
  const scopeList = useMemo(() => {
    if (!isMultiVariant) return [{ id: 'simple', label: 'Offer fields' }];
    return [
      { id: 'base', label: 'Shared base' },
      ...row.variants.map((v, i) => ({ id: v.variantId, label: distinguishingLabel(v, i) })),
    ];
  }, [isMultiVariant, row.variants]);

  const variantStatus = useCallback(
    (variant: BulkVariantRow): ScopeStatusKind => {
      if (!included[variant.variantId]) return 'off';
      const ean = variantEdits[variant.variantId]?.ean.trim() ?? '';
      const eanInvalid = ean !== '' && !isValidGtin(ean);
      const hasBlocker = variant.blockers.length > 0 || eanInvalid || dupEanIds.has(variant.variantId);
      return hasBlocker ? 'attn' : 'ok';
    },
    [included, variantEdits, dupEanIds],
  );

  const scopeStatus = useCallback(
    (id: string): ScopeStatusKind => {
      if (id === 'base' || id === 'simple') return 'base';
      const variant = row.variants.find((v) => v.variantId === id);
      return variant ? variantStatus(variant) : 'base';
    },
    [row.variants, variantStatus],
  );

  const onRailKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const idx = scopeList.findIndex((s) => s.id === scope);
    const nextIdx =
      event.key === 'ArrowDown'
        ? Math.min(scopeList.length - 1, idx + 1)
        : Math.max(0, idx - 1);
    const nextId = scopeList[nextIdx].id;
    setScope(nextId);
    const nextEl = event.currentTarget.querySelector<HTMLElement>(`[data-scope="${nextId}"]`);
    nextEl?.focus();
  };

  const effectiveCategoryId = baseValues.categoryId || row.resolvedCategoryId || '';

  // For a browsable destination with a resolved category but NO locally-captured
  // breadcrumb (the pre-resolved / EAN-auto-match case), resolve the id -> path
  // via the marketplace `CategoryPathReader`. Manual picks already carry
  // `categoryPathNames` (captured on select, no flicker), so we skip the fetch
  // there by passing an empty id (which disables the query).
  const hasCapturedPath = Boolean(categoryPathNames && categoryPathNames.length > 0);
  const shouldResolvePath = canBrowseCategories && !hasCapturedPath;
  const categoryPathQuery = useCategoryPathQuery(
    connectionId,
    shouldResolvePath ? effectiveCategoryId : '',
  );
  const resolvedPathNames = categoryPathQuery.data?.map((n) => n.name) ?? null;
  const displayPathNames = hasCapturedPath
    ? categoryPathNames
    : resolvedPathNames && resolvedPathNames.length > 0
      ? resolvedPathNames
      : null;
  const crumbContent =
    displayPathNames && displayPathNames.length > 0 ? (
      displayPathNames.map((name, i) => (
        <Fragment key={`${name}-${i}`}>
          {i > 0 ? <span className="sep"> › </span> : null}
          {i === displayPathNames.length - 1 ? <b>{name}</b> : name}
        </Fragment>
      ))
    ) : effectiveCategoryId ? (
      <span className="mono-text">{effectiveCategoryId}</span>
    ) : (
      <span className="bulk-editor__cat-missing">Not set</span>
    );
  const categoryMissing = !effectiveCategoryId && !(displayPathNames && displayPathNames.length > 0);
  const productTypeLabel = isMultiVariant
    ? `${row.variants.length} variants`
    : 'Simple product · no variants';

  const applyCategory = (categoryId: string, pathNames: string[] | null): void => {
    baseFormRef.current?.setValue('categoryId', categoryId, { shouldDirty: true });
    baseFormRef.current?.setValue('productCardId', '', { shouldDirty: true });
    setCategoryPathNames(pathNames);
  };

  return (
    <>
      <div className="bulk-editor__head">
        <DialogTitle className="bulk-editor__title">
          Edit offer <span>- {row.product?.name ?? row.productId}</span>
        </DialogTitle>
        <Button
          tone="ghost"
          type="button"
          className="button--icon"
          aria-label="Close editor"
          onClick={onRequestClose}
        >
          ×
        </Button>
      </div>
      <DialogDescription className="sr-only">
        Edit the shared base offer and per-variant overrides for this product.
      </DialogDescription>

      <div className="bulk-editor__cat-chip">
        {canBrowseCategories ? (
          <Button
            tone="ghost"
            type="button"
            className="bulk-editor__cat-change"
            onClick={() => setCatModalOpen(true)}
          >
            change ↱
          </Button>
        ) : null}
        <span className="eyebrow">Category</span>
        {canBrowseCategories ? (
          <button
            type="button"
            className="bulk-editor__cat-crumb crumb"
            onClick={() => setCatModalOpen(true)}
            aria-label="Change category"
          >
            {crumbContent}
          </button>
        ) : (
          <span className="crumb">{crumbContent}</span>
        )}
        {categoryMissing && canBrowseCategories ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="bulk-editor__warn-tri" role="img" aria-label="Category is required">
                &#9650;
              </span>
            </TooltipTrigger>
            <TooltipContent>
              Category is required. Choose one with the change button.
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>

      <div className="bulk-editor__ptype">{productTypeLabel}</div>

      <div className={['bulk-editor__body', isMultiVariant ? '' : 'bulk-editor__body--simple'].filter(Boolean).join(' ')}>
        {isMultiVariant ? (
          <nav
            className="bulk-editor__rail"
            role="radiogroup"
            aria-label="Variant scope selector"
            onKeyDown={onRailKeyDown}
          >
            <div className="eyebrow bulk-editor__rail-eyebrow">Scope</div>
            <RailItem
              id="base"
              label="Shared base"
              status="base"
              active={scope === 'base'}
              excluded={false}
              onSelect={setScope}
            />
            <div className="bulk-editor__rail-sep" />
            <div className="eyebrow bulk-editor__rail-eyebrow">Variants</div>
            {row.variants.map((v, i) => (
              <RailItem
                key={v.variantId}
                id={v.variantId}
                label={distinguishingLabel(v, i)}
                status={scopeStatus(v.variantId)}
                active={scope === v.variantId}
                excluded={!included[v.variantId]}
                onSelect={setScope}
              />
            ))}
          </nav>
        ) : null}

        <div className="bulk-editor__scopes">
          {/* A demo read-only viewer can browse scopes (rail stays live) but
              every field edit + image control is natively disabled; nothing can
              be committed (`Save all` is locked below). `display:contents` keeps
              the layout while `disabled` cascades to all nested controls. */}
          <fieldset
            disabled={demoReadOnly}
            style={{ border: 0, margin: 0, padding: 0, minWidth: 0, display: 'contents' }}
          >
          {/* Base / simple scope - always mounted so its RHF state persists
              across rail switches. Hidden (not active) via `hidden` + the mobile
              accordion `--acc-open` class. */}
          {isMultiVariant ? (
            <AccordionHead
              id="base"
              label="Shared base"
              status="base"
              active={scope === 'base'}
              onSelect={setScope}
            />
          ) : null}
          <BaseScopeForm
            mode={isMultiVariant ? 'base' : 'simple'}
            active={scope === (isMultiVariant ? 'base' : 'simple')}
            row={row}
            connectionId={connectionId}
            connection={connection}
            canBrowseCategories={canBrowseCategories}
            currency={currency}
            platformName={platformName}
            platformSection={platformSection}
            platformParams={platformParams}
            onPlatformParamsChange={setPlatformParams}
            batchDeliveryPriceList={batchDeliveryPriceList}
            masterImages={masterImages}
            baseImageUrls={baseImageUrls}
            onBaseImageUrlsChange={setBaseImageUrls}
            onZoom={setZoomSrc}
            pricingPolicy={pricingPolicy}
            onPricingPolicyChange={setPricingPolicy}
            stockPolicy={stockPolicy}
            onStockPolicyChange={setStockPolicy}
            onCategoryPicked={setCategoryPathNames}
            categoryParametersQuery={categoryParametersQuery}
            categoryParameters={renderableCategoryParameters}
            initialValues={initialBase}
            simpleIncluded={included[row.variants[0].variantId]}
            onSimpleIncludedChange={(next) => setIncluded((prev) => ({ ...prev, [row.variants[0].variantId]: next }))}
            onReady={(form) => {
              baseFormRef.current = form;
            }}
            onValuesChange={setBaseValues}
          />

          {isMultiVariant
            ? row.variants.map((v, i) => (
                <Fragment key={v.variantId}>
                  <AccordionHead
                    id={v.variantId}
                    label={distinguishingLabel(v, i)}
                    status={scopeStatus(v.variantId)}
                    active={scope === v.variantId}
                    onSelect={setScope}
                  />
                  {scope === v.variantId ? (
                    <VariantScopeForm
                      variant={v}
                      index={i}
                      edit={variantEdits[v.variantId]}
                      included={included[v.variantId]}
                      baseValues={baseValues}
                      basePriceValue={resolveBasePrice(baseValues, pricingPolicy, v.masterPrice)}
                      masterImages={masterImages}
                      onZoom={setZoomSrc}
                      categoryParameters={renderableCategoryParameters}
                      duplicateEan={dupEanIds.has(v.variantId)}
                      onPatch={(patch) => patchVariant(v.variantId, patch)}
                      onParamChange={(paramId, value) => setVariantParam(v.variantId, paramId, value)}
                      onIncludedChange={(next) => setIncluded((prev) => ({ ...prev, [v.variantId]: next }))}
                      onFixOnBase={() => setScope('base')}
                    />
                  ) : null}
                </Fragment>
              ))
            : null}
          </fieldset>
        </div>
      </div>

      <div className="bulk-editor__foot">
        <span className="grow">
          {isMultiVariant
            ? scope === 'base'
              ? 'Editing shared base - changes cascade to every variant that has not overridden the field.'
              : 'Editing one variant - only overridden fields diverge from the base.'
            : 'Simple product - no variants. These fields apply to the single offer.'}
        </span>
        <Button tone="ghost" type="button" onClick={onRequestClose}>
          Cancel
        </Button>
        <ReadOnlyLock active={demoReadOnly} message={DEMO_READ_ONLY_ACTION_MESSAGE}>
          <Button
            tone="primary"
            type="button"
            disabled={demoReadOnly}
            onClick={() => {
              void handleSaveAll();
            }}
          >
            Save all
          </Button>
        </ReadOnlyLock>
      </div>

      {canBrowseCategories ? (
        <BulkCategoryChooseModal
          open={catModalOpen}
          onOpenChange={setCatModalOpen}
          connectionId={connectionId}
          productName={row.product?.name ?? row.productId}
          selectedId={baseValues.categoryId || null}
          onSelect={applyCategory}
        />
      ) : null}

      {zoomSrc ? (
        <BulkImageLightbox
          src={zoomSrc}
          name={row.product?.name ?? 'Offer image'}
          onClose={() => setZoomSrc(null)}
        />
      ) : null}
    </>
  );
}

// ── Rail + accordion ─────────────────────────────────────────────────────────

function RailItem({
  id,
  label,
  status,
  active,
  excluded,
  onSelect,
}: {
  id: string;
  label: string;
  status: ScopeStatusKind;
  active: boolean;
  excluded: boolean;
  onSelect: (id: string) => void;
}): ReactElement {
  const classes = [
    'bulk-editor__rail-item',
    active ? 'bulk-editor__rail-item--active' : '',
    excluded ? 'bulk-editor__rail-item--excluded' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      type="button"
      className={classes}
      role="radio"
      aria-checked={active}
      aria-current={active ? 'true' : undefined}
      tabIndex={active ? 0 : -1}
      data-scope={id}
      onClick={() => onSelect(id)}
    >
      <span className={`rd rd--${status}`} aria-hidden="true" />
      <span className="rlabel">{label}</span>
      {status === 'attn' ? <span aria-hidden="true">⚠</span> : null}
    </button>
  );
}

function AccordionHead({
  id,
  label,
  status,
  active,
  onSelect,
}: {
  id: string;
  label: string;
  status: ScopeStatusKind;
  active: boolean;
  onSelect: (id: string) => void;
}): ReactElement {
  return (
    <button
      type="button"
      className="bulk-editor__acc-head"
      aria-expanded={active}
      onClick={() => onSelect(id)}
    >
      <span className={`rd rd--${status}`} aria-hidden="true" />
      {label}
      <span className="chev" aria-hidden="true">
        ▸
      </span>
    </button>
  );
}

// ── Provenance badge ─────────────────────────────────────────────────────────

type Provenance = 'inherit' | 'master' | 'override' | 'distinct' | 'policy' | 'defaults';
const PROV_LABEL: Record<Provenance, string> = {
  inherit: 'inherited',
  master: 'from master',
  override: 'overridden',
  distinct: 'distinguishing',
  policy: 'policy',
  defaults: 'defaults for all variants',
};

function ProvBadge({ kind }: { kind: Provenance }): ReactElement {
  return <span className={`bulk-editor__prov bulk-editor__prov--${kind}`}>{PROV_LABEL[kind]}</span>;
}

// ── Base / simple scope form (the only RHF form) ─────────────────────────────

interface BaseScopeFormProps {
  mode: 'base' | 'simple';
  active: boolean;
  row: BulkWizardRow;
  connectionId: string;
  connection: Connection;
  canBrowseCategories: boolean;
  currency: string;
  platformName: string;
  platformSection?: ComponentType<BulkOfferRowSectionProps>;
  platformParams: Record<string, unknown>;
  onPlatformParamsChange: (next: Record<string, unknown>) => void;
  batchDeliveryPriceList: string;
  masterImages: string[];
  /** Base image override (#1741); `undefined` ⇒ inherit the master set. */
  baseImageUrls: string[] | undefined;
  onBaseImageUrlsChange: (next: string[] | undefined) => void;
  /** Opens the shared zoom lightbox for an image url (always allowed, #1741). */
  onZoom: (src: string) => void;
  /** Per-product pricing/stock policy (#1741) - shown as selects in `base` mode. */
  pricingPolicy: PricingPolicy;
  onPricingPolicyChange: (next: PricingPolicy) => void;
  stockPolicy: StockPolicy;
  onStockPolicyChange: (next: StockPolicy) => void;
  /** Captures a chip-friendly breadcrumb when a suggested-category chip is picked. */
  onCategoryPicked: (pathNames: string[] | null) => void;
  categoryParametersQuery: ReturnType<typeof useCategoryParametersQuery>;
  categoryParameters: CategoryParameter[];
  initialValues: BulkEditModalValues;
  simpleIncluded: boolean;
  onSimpleIncludedChange: (next: boolean) => void;
  onReady: (form: UseFormReturn<BulkEditModalValues, undefined, BulkEditModalSubmission>) => void;
  onValuesChange: (values: BulkEditModalValues) => void;
}

function BaseScopeForm({
  mode,
  active,
  row,
  connectionId,
  connection,
  canBrowseCategories,
  currency,
  platformName,
  platformSection,
  platformParams,
  onPlatformParamsChange,
  batchDeliveryPriceList,
  masterImages,
  baseImageUrls,
  onBaseImageUrlsChange,
  onZoom,
  pricingPolicy,
  onPricingPolicyChange,
  stockPolicy,
  onStockPolicyChange,
  onCategoryPicked,
  categoryParametersQuery,
  categoryParameters,
  initialValues,
  simpleIncluded,
  onSimpleIncludedChange,
  onReady,
  onValuesChange,
}: BaseScopeFormProps): ReactElement {
  const [addingImage, setAddingImage] = useState(false);
  const [newImageUrl, setNewImageUrl] = useState('');
  const effectiveImages = baseImageUrls ?? masterImages;
  const imagesOverridden = baseImageUrls !== undefined;
  const schema = useMemo(() => makeBulkEditModalSchema(canBrowseCategories), [canBrowseCategories]);
  const form = useForm<BulkEditModalValues, undefined, BulkEditModalSubmission>({
    defaultValues: initialValues,
    resolver: zodResolver(schema),
    mode: 'onSubmit',
  });

  useEffect(() => {
    onReady(form);
    onValuesChange(form.getValues());
    const sub = form.watch(() => onValuesChange(form.getValues()));
    return () => sub.unsubscribe();
  }, [form]);

  const watchedCategoryId = form.watch('categoryId');
  const watchedEan = form.watch('ean');
  const eanInvalid = watchedEan.trim() !== '' && !isValidGtin(watchedEan.trim());
  const classes = ['bulk-editor__form', active ? 'bulk-editor__form--acc-open' : ''].filter(Boolean).join(' ');

  return (
    <FormProvider {...form}>
      <div className={classes} hidden={!active} data-form={mode}>
        <div className="bulk-editor__scope-head">
          <h4>{mode === 'simple' ? 'Offer fields' : 'Shared base'}</h4>
          <div className="grow" />
          {mode === 'simple' ? (
            <label className="checkbox-row" style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <input
                type="checkbox"
                checked={simpleIncluded}
                onChange={(e) => onSimpleIncludedChange(e.target.checked)}
              />
              <span>Include in this batch</span>
            </label>
          ) : (
            <div className="bulk-editor__scope-toggles">
              <ProvBadge kind="defaults" />
              <label className="checkbox-row" style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <input type="checkbox" {...form.register('publishImmediately')} />
                <span>
                  Publish immediately{' '}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="bulk-editor__infotip" role="img" aria-label="About publish immediately">
                        &#9432;
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      Requests publication. The marketplace still decides: if required parameters are
                      missing or invalid on its side it keeps the offer as a draft to finish in its own
                      panel (common on Erli).
                    </TooltipContent>
                  </Tooltip>
                </span>
              </label>
            </div>
          )}
        </div>

        <FormField
          name="bulk-edit-title"
          label="Title"
          description={`Max 75 characters (${platformName} limit).`}
          error={form.formState.errors.title?.message}
        >
          <Input
            {...form.register('title')}
            className="bulk-editor__input"
            maxLength={75}
            aria-invalid={Boolean(form.formState.errors.title)}
          />
        </FormField>

        {mode === 'simple' ? (
          <div className="bulk-editor__field">
            <label>EAN (GTIN)</label>
            <Input
              {...form.register('ean')}
              className={['bulk-editor__input', eanInvalid ? 'bulk-editor__input--error' : '']
                .filter(Boolean)
                .join(' ')}
              inputMode="numeric"
              placeholder="e.g. 5901234567897"
              aria-label="EAN (GTIN)"
              aria-invalid={eanInvalid}
            />
            {eanInvalid ? (
              <div className="bulk-editor__ean-err">
                Invalid GTIN checksum - Allegro will reject this EAN.
              </div>
            ) : null}
            <div className="hint" style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              Offer barcode for this product. Pre-filled from the master barcode; clearing it lists
              the offer without a catalog card.
            </div>
          </div>
        ) : null}

        {row.categoryCandidates.length > 0 ? (
          <div className="bulk-editor__field">
            <label>Suggested categories (EAN matched several)</label>
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              {row.categoryCandidates.map((candidate) => (
                <Button
                  key={candidate.allegroCategoryId}
                  tone="secondary"
                  type="button"
                  className="button--sm"
                  onClick={() => {
                    form.setValue('categoryId', candidate.allegroCategoryId, { shouldDirty: true });
                    form.setValue('productCardId', candidate.productCardId, { shouldDirty: true });
                    onCategoryPicked(candidate.name ? [candidate.name] : null);
                  }}
                >
                  {candidate.name ?? candidate.allegroCategoryId}
                </Button>
              ))}
            </div>
          </div>
        ) : null}

        {canBrowseCategories ? (
          // Category is chosen in the external Choose-category modal via the
          // CATEGORY chip above; the "required" case is surfaced on the chip's
          // warning triangle (with a tooltip). Here we only surface a residual
          // error when a category IS set but still fails validation (e.g. a
          // stale parameter schema).
          watchedCategoryId && form.formState.errors.categoryId ? (
            <div className="bulk-editor__field">
              <div className="bulk-editor__ean-err" role="alert">
                {form.formState.errors.categoryId.message}
              </div>
            </div>
          ) : null
        ) : (
          <FormField
            name="bulk-edit-category"
            label="Allegro category ID"
            description="Reuses the resolved Allegro category id. Leave blank to resolve from your configured category mappings at submit."
            error={form.formState.errors.categoryId?.message}
          >
            <Input
              {...form.register('categoryId')}
              className="bulk-editor__input"
              placeholder="e.g. 12345"
              inputMode="numeric"
              aria-invalid={Boolean(form.formState.errors.categoryId)}
            />
          </FormField>
        )}

        <BaseDescriptionField productId={row.product?.id ?? ''} channel={connection.platformType} />

        {mode === 'simple' ? (
          <div className="bulk-editor__row2">
            <FormField
              name="bulk-edit-price"
              label="Price"
              error={form.formState.errors.priceAmount?.message}
            >
              <Input
                {...form.register('priceAmount')}
                className="bulk-editor__input"
                placeholder="79.00"
                aria-invalid={Boolean(form.formState.errors.priceAmount)}
              />
            </FormField>
            <FormField name="bulk-edit-stock" label="Stock" error={form.formState.errors.stock?.message}>
              <Input
                type="number"
                min={0}
                {...form.register('stock', { valueAsNumber: true })}
                className="bulk-editor__input"
                aria-invalid={Boolean(form.formState.errors.stock)}
              />
            </FormField>
          </div>
        ) : (
          <>
            <div className="bulk-editor__row2">
              <FormField
                name="bulk-edit-pricing-policy"
                label="Price policy"
                description="Per-product override of the batch pricing policy."
              >
                <select
                  className="bulk-editor__input"
                  aria-label="Price policy"
                  value={pricingPolicy.mode}
                  onChange={(e) => onPricingPolicyChange(nextPricingPolicy(e.target.value as PricingPolicyMode, pricingPolicy))}
                >
                  <option value="use-master">Use master price</option>
                  <option value="markup">Markup on master price</option>
                  <option value="flat">Flat price for all rows</option>
                </select>
              </FormField>
              <FormField
                name="bulk-edit-stock-policy"
                label="Stock policy"
                description="Per-product override of the batch stock policy."
              >
                <select
                  className="bulk-editor__input"
                  aria-label="Stock policy"
                  value={stockPolicy.mode}
                  onChange={(e) => onStockPolicyChange(nextStockPolicy(e.target.value as StockPolicyMode, stockPolicy))}
                >
                  <option value="use-master">Use master stock</option>
                  <option value="cap">Cap master stock</option>
                  <option value="flat">Flat stock for all rows</option>
                </select>
              </FormField>
            </div>

            {pricingPolicy.mode !== 'use-master' ? (
              <FormField
                name="bulk-edit-pricing-param"
                label={pricingPolicy.mode === 'markup' ? 'Markup %' : `Flat price (${currency})`}
              >
                <Input
                  className="bulk-editor__input"
                  inputMode="decimal"
                  value={pricingParamValue(pricingPolicy)}
                  aria-label={pricingPolicy.mode === 'markup' ? 'Markup percent' : 'Flat price'}
                  onChange={(e) => onPricingPolicyChange(withPricingParam(pricingPolicy, e.target.value))}
                />
              </FormField>
            ) : null}

            {stockPolicy.mode !== 'use-master' ? (
              <FormField
                name="bulk-edit-stock-param"
                label={stockPolicy.mode === 'cap' ? 'Cap at' : 'Stock'}
              >
                <Input
                  type="number"
                  min={1}
                  className="bulk-editor__input"
                  value={stockParamValue(stockPolicy)}
                  aria-label={stockPolicy.mode === 'cap' ? 'Cap at' : 'Flat stock'}
                  onChange={(e) => onStockPolicyChange(withStockParam(stockPolicy, e.target.value))}
                />
              </FormField>
            ) : null}

            <FormField
              name="bulk-edit-currency"
              label="Currency"
              description="Batch-wide - set in the Config step, applies to every offer."
            >
              <Input className="bulk-editor__input" value={currency} readOnly aria-readonly="true" />
            </FormField>
          </>
        )}

        <div className="bulk-editor__field">
          <label>
            Images {imagesOverridden ? <ProvBadge kind="override" /> : <ProvBadge kind="master" />}
            {imagesOverridden ? (
              <button
                type="button"
                className="bulk-editor__reset"
                onClick={() => onBaseImageUrlsChange(undefined)}
              >
                ↺ reset to master
              </button>
            ) : null}
          </label>
          <div className="bulk-editor__img-strip bulk-editor__img-strip--editable">
            {effectiveImages.map((url, i) => (
              <span className="bulk-editor__img-thumb" key={`${url}-${i}`}>
                <ThumbZoomButton url={url} onZoom={onZoom} />
                <button
                  type="button"
                  className="bulk-editor__img-x"
                  aria-label="Remove image"
                  onClick={() => {
                    const base = baseImageUrls ?? masterImages;
                    onBaseImageUrlsChange(base.filter((_, idx) => idx !== i));
                  }}
                >
                  ×
                </button>
              </span>
            ))}
            {!addingImage ? (
              <button
                type="button"
                className="bulk-editor__img-add"
                aria-label="Add image"
                onClick={() => setAddingImage(true)}
              >
                ＋
              </button>
            ) : null}
          </div>
          {addingImage ? (
            <div className="bulk-editor__img-add-row">
              <Input
                className="bulk-editor__input"
                value={newImageUrl}
                onChange={(e) => setNewImageUrl(e.target.value)}
                placeholder="https://example.com/image.jpg"
                aria-label="New image URL"
              />
              <Button
                tone="primary"
                type="button"
                className="button--sm"
                onClick={() => {
                  const url = newImageUrl.trim();
                  if (url === '') return;
                  const base = baseImageUrls ?? masterImages;
                  onBaseImageUrlsChange([...base, url]);
                  setNewImageUrl('');
                  setAddingImage(false);
                }}
              >
                Add
              </Button>
              <Button
                tone="ghost"
                type="button"
                className="button--sm"
                onClick={() => {
                  setNewImageUrl('');
                  setAddingImage(false);
                }}
              >
                Cancel
              </Button>
            </div>
          ) : null}
          <div className="hint" style={{ color: 'var(--text-muted)', margin: '5px 0 0' }}>
            {effectiveImages.length === 0 ? 'No images yet - add an image URL to include one. ' : ''}
            {mode === 'simple'
              ? 'Master image set for this offer. Add or remove to override it.'
              : 'Default image set for every variant. Add or remove to override the master set.'}
          </div>
        </div>

        {canBrowseCategories ? (
          <BaseParameterSection
            watchedCategoryId={watchedCategoryId}
            parametersQuery={categoryParametersQuery}
            categoryParameters={categoryParameters}
          />
        ) : null}

        {(connection.supportedCapabilities?.includes('DeliveryPriceListReader') ?? false) ? (
          <ErliDeliveryPriceListOverrideField
            connectionId={connectionId}
            value={typeof platformParams.deliveryPriceList === 'string' ? platformParams.deliveryPriceList : undefined}
            batchDefault={batchDeliveryPriceList}
            onChange={(next) => {
              const copy = { ...platformParams };
              if (next === undefined) delete copy.deliveryPriceList;
              else copy.deliveryPriceList = next;
              onPlatformParamsChange(copy);
            }}
          />
        ) : null}

        {platformSection ? (
          <Suspense fallback={<p className="muted-text">Loading…</p>}>
            <PlatformRowSection
              section={platformSection}
              connection={connection}
              platformParams={platformParams}
              onChange={onPlatformParamsChange}
            />
          </Suspense>
        ) : null}

        {mode === 'simple' ? (
          <label className="checkbox-row" style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)' }}>
            <input type="checkbox" {...form.register('publishImmediately')} />
            <span>
              <strong>Publish immediately</strong>{' '}
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="bulk-editor__infotip" role="img" aria-label="About publish immediately">
                    &#9432;
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  Requests publication. The marketplace still decides: if required parameters are
                  missing or invalid on its side it keeps the offer as a draft to finish in its own
                  panel (common on Erli).
                </TooltipContent>
              </Tooltip>
              <small style={{ display: 'block', color: 'var(--text-muted)' }}>
                Uncheck to create as a draft.
              </small>
            </span>
          </label>
        ) : null}
      </div>
    </FormProvider>
  );
}

function BaseDescriptionField({ productId, channel }: { productId: string; channel: string }): ReactElement {
  const form = useFormContext<BulkEditModalValues>();
  const error = form.formState.errors.description?.message;
  return (
    <div className="bulk-editor__field">
      <label>
        Description
        {productId !== '' ? (
          <span style={{ marginLeft: 'auto' }}>
            <SuggestionDialog
              productId={productId}
              channel={channel}
              onApply={(suggestion) => {
                form.setValue('description', suggestion, { shouldDirty: true });
              }}
            />
          </span>
        ) : null}
      </label>
      <Textarea
        {...form.register('description')}
        className="bulk-editor__input"
        rows={6}
        aria-label="Description"
        aria-invalid={Boolean(error)}
      />
      {error ? <div className="bulk-editor__ean-err">{error}</div> : null}
      <div className="hint" style={{ color: 'var(--text-muted)', fontSize: 12 }}>
        Plain text. AI writes one description shared by every variant unless a variant overrides it.
      </div>
    </div>
  );
}

interface BaseParameterSectionProps {
  watchedCategoryId: string | undefined;
  parametersQuery: ReturnType<typeof useCategoryParametersQuery>;
  categoryParameters: CategoryParameter[];
}

function BaseParameterSection({
  watchedCategoryId,
  parametersQuery,
  categoryParameters,
}: BaseParameterSectionProps): ReactElement | null {
  if (!watchedCategoryId) return null;
  if (parametersQuery.isLoading) {
    return <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Loading category parameters…</div>;
  }
  if (parametersQuery.error) {
    return (
      <Alert tone="warning">
        Could not load category parameters. You can still save - the worker may reject if required params are missing.
      </Alert>
    );
  }
  if (categoryParameters.length === 0) {
    return (
      <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>No category parameters required for this category.</div>
    );
  }
  return (
    <div className="bulk-editor__platform-slot">
      <div className="bulk-editor__slot-tag">
        <span className="eyebrow">Category parameters</span>
      </div>
      <CategoryParametersStep parameters={categoryParameters} formNamespace="parameters" />
    </div>
  );
}

// ── Variant scope form (controlled off the edit model) ───────────────────────

interface VariantScopeFormProps {
  variant: BulkVariantRow;
  index: number;
  edit: VariantEdit;
  included: boolean;
  baseValues: BulkEditModalValues;
  /** Concrete base price this variant inherits (pre-filled value, #1741). */
  basePriceValue: string;
  masterImages: string[];
  categoryParameters: CategoryParameter[];
  duplicateEan: boolean;
  /** Opens the shared zoom lightbox for an image url (always allowed, #1741). */
  onZoom: (src: string) => void;
  onPatch: (patch: Partial<VariantEdit>) => void;
  onParamChange: (paramId: string, value: FormParameterValue) => void;
  onIncludedChange: (next: boolean) => void;
  onFixOnBase: () => void;
}

function VariantScopeForm({
  variant,
  index,
  edit,
  included,
  baseValues,
  basePriceValue,
  masterImages,
  categoryParameters,
  duplicateEan,
  onZoom,
  onPatch,
  onParamChange,
  onIncludedChange,
  onFixOnBase,
}: VariantScopeFormProps): ReactElement {
  const label = distinguishingLabel(variant, index);
  const master = masterBarcodeOf(variant);
  const ean = edit.ean;
  const eanInvalid = ean.trim() !== '' && !isValidGtin(ean.trim());
  const eanError = eanInvalid
    ? 'Invalid GTIN checksum - Allegro will reject this EAN.'
    : duplicateEan
      ? 'Duplicate of another included variant - they would collapse to one Allegro card.'
      : '';

  const effectiveImages = edit.imageUrls ?? masterImages;
  const imagesOverridden = edit.imageUrls !== undefined;
  const [addingImage, setAddingImage] = useState(false);
  const [newImageUrl, setNewImageUrl] = useState('');

  // Grouping-determining params (Marka/Stan) are locked to base by default; the
  // operator can unlock them per variant behind a warning (a per-variant value
  // splits the variant into its own Allegro listing). `warnParamIds` = the
  // transient "confirm?" state; `unlockedParamIds` = confirmed-editable (#1741).
  const [warnParamIds, setWarnParamIds] = useState<ReadonlySet<string>>(() => new Set());
  const [unlockedParamIds, setUnlockedParamIds] = useState<ReadonlySet<string>>(() => new Set());
  const addTo = (set: ReadonlySet<string>, id: string): ReadonlySet<string> => new Set(set).add(id);
  const removeFrom = (set: ReadonlySet<string>, id: string): ReadonlySet<string> => {
    const next = new Set(set);
    next.delete(id);
    return next;
  };

  const formClasses = [
    'bulk-editor__form',
    'bulk-editor__form--acc-open',
    included ? '' : 'bulk-editor__form--excluded',
  ]
    .filter(Boolean)
    .join(' ');

  // Category parameters mirror the base scope: filter through parameter-level
  // visibility (a `dependsOn`-gated param is hidden until its parent has a
  // qualifying value), then split required-first / optional-behind-expander
  // (#1741). The effective values are the base values overridden by this
  // variant's own overrides (variant wins; inherited entries fall back to base).
  const effectiveParamValues: CategoryParameterFormValues = useMemo(
    () => ({ ...((baseValues.parameters as CategoryParameterFormValues | undefined) ?? {}), ...edit.params }),
    [baseValues.parameters, edit.params],
  );
  const visibleParams = useMemo(
    () => categoryParameters.filter((p) => isParameterVisible(p, effectiveParamValues)),
    [categoryParameters, effectiveParamValues],
  );
  const requiredParams = visibleParams.filter((p) => p.required);
  const optionalParams = visibleParams.filter((p) => !p.required);

  // The type-appropriate editable control for a param (dictionary select /
  // combobox, number, or text). `opts.splitBadge` / `opts.onReset` customise the
  // provenance chip + reset for an unlocked base-only grouping param (#1741).
  const renderEditableParamControl = (
    param: CategoryParameter,
    opts?: { splitBadge?: boolean; onReset?: () => void },
  ): ReactElement => {
    const override = edit.params[param.id];
    const overridden = override !== undefined;
    const ariaLabel = `${param.name} for ${label}`;
    const baseDisplay = baseParamDisplay(param, baseValues);
    const provNode = opts?.splitBadge ? (
      <span className="bulk-editor__prov bulk-editor__prov--split">splits listing</span>
    ) : undefined;
    const onReset = opts?.onReset;

    if (param.type === 'dictionary' && (param.dictionary?.length ?? 0) > 0) {
      const useCombobox =
        Boolean(param.restrictions.multipleChoices) ||
        Boolean(param.restrictions.customValuesEnabled) ||
        (param.dictionary?.length ?? 0) >= DICTIONARY_NATIVE_SELECT_THRESHOLD;
      if (useCombobox) {
        return (
          <InheritableComboboxField
            key={param.id}
            label={param.name}
            parameter={param}
            overridden={overridden}
            value={override}
            baseDisplay={baseDisplay}
            ariaLabel={ariaLabel}
            provNode={provNode}
            onReset={onReset}
            onChange={(next) => onParamChange(param.id, next)}
          />
        );
      }
      return (
        <InheritableSelectField
          key={param.id}
          label={param.name}
          overridden={overridden}
          value={typeof override === 'string' ? override : undefined}
          options={(param.dictionary ?? []).map((e) => ({ id: e.id, label: e.value }))}
          baseDisplay={baseDisplay}
          ariaLabel={ariaLabel}
          provNode={provNode}
          onReset={onReset}
          onChange={(next) => onParamChange(param.id, next)}
        />
      );
    }

    if (param.type === 'integer' || param.type === 'float') {
      return (
        <InheritableTextField
          key={param.id}
          label={param.name}
          type="number"
          overridden={overridden}
          value={typeof override === 'string' ? override : ''}
          baseValue={baseDisplay}
          ariaLabel={ariaLabel}
          provNode={provNode}
          onReset={onReset}
          onChange={(next) => onParamChange(param.id, next)}
        />
      );
    }

    return (
      <InheritableTextField
        key={param.id}
        label={param.name}
        overridden={overridden}
        value={typeof override === 'string' ? override : ''}
        baseValue={baseDisplay}
        ariaLabel={ariaLabel}
        provNode={provNode}
        onReset={onReset}
        onChange={(next) => onParamChange(param.id, next)}
      />
    );
  };

  const renderVariantParam = (param: CategoryParameter): ReactElement => {
    // Exact name match (not substring) so grouping-determining params (Marka /
    // Stan) lock to base, but similarly-named non-grouping params (e.g. "Stan
    // opakowania") stay per-variant editable.
    const isBaseOnly = BASE_ONLY_PARAM_NAMES.includes(param.name.trim().toLowerCase());
    if (!isBaseOnly) {
      return renderEditableParamControl(param);
    }

    const baseLabel = baseParamDisplay(param, baseValues);
    const baseRaw = (baseValues.parameters as CategoryParameterFormValues | undefined)?.[param.id];
    const unlocked = unlockedParamIds.has(param.id) || edit.params[param.id] !== undefined;
    const inWarn = warnParamIds.has(param.id);

    // State 3 - unlocked: the type-appropriate editable control, a "splits
    // listing" warning chip, and a reset that re-locks it to base.
    if (unlocked) {
      return renderEditableParamControl(param, {
        splitBadge: true,
        onReset: () => {
          onParamChange(param.id, undefined);
          setUnlockedParamIds((prev) => removeFrom(prev, param.id));
        },
      });
    }

    // State 2 - warning: consequence-first callout before unlocking.
    if (inWarn) {
      return (
        <div className="bulk-editor__field" key={param.id}>
          <label>
            {param.name} <ProvBadge kind="inherit" />
          </label>
          <div className="bulk-editor__split-warn" role="alert">
            <p>
              Overriding {param.name} for one variant splits it into its own Allegro listing - it stops grouping
              with the other variants.
            </p>
            <div className="bulk-editor__split-warn-actions">
              <Button
                tone="primary"
                type="button"
                className="button--sm"
                onClick={() => {
                  setWarnParamIds((prev) => removeFrom(prev, param.id));
                  setUnlockedParamIds((prev) => addTo(prev, param.id));
                  if (baseRaw !== undefined) onParamChange(param.id, baseRaw);
                }}
              >
                Override anyway
              </Button>
              <Button
                tone="ghost"
                type="button"
                className="button--sm"
                onClick={() => setWarnParamIds((prev) => removeFrom(prev, param.id))}
              >
                Keep shared
              </Button>
            </div>
          </div>
        </div>
      );
    }

    // State 1 - inherited: read-only base value + a quiet "override" affordance.
    return (
      <div className="bulk-editor__field" key={param.id}>
        <label>
          {param.name} <ProvBadge kind="inherit" />
        </label>
        <Input
          className="bulk-editor__input bulk-editor__input--inherited"
          value={baseLabel || 'Not set on base'}
          readOnly
          aria-readonly="true"
        />
        <div className="hint" style={{ color: 'var(--text-muted)', fontSize: 12 }}>
          Shared across all variants - grouping-determining, edit on base.
        </div>
        <button
          type="button"
          className="bulk-editor__override-link"
          onClick={() => setWarnParamIds((prev) => addTo(prev, param.id))}
        >
          Override for this variant
        </button>
      </div>
    );
  };

  return (
    <div className={formClasses} data-form={variant.variantId}>
      <div className="bulk-editor__scope-head">
        <h4>Variant · {label}</h4>
        <div className="grow" />
        <div className="bulk-editor__scope-toggles">
          <label className="checkbox-row" style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <input type="checkbox" checked={included} onChange={(e) => onIncludedChange(e.target.checked)} />
            <span>Include in this batch</span>
          </label>
          <label className="checkbox-row" style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <input
              type="checkbox"
              checked={edit.publishImmediately ?? Boolean(baseValues.publishImmediately)}
              onChange={(e) => onPatch({ publishImmediately: e.target.checked })}
            />
            <span>
              Publish immediately{' '}
              {edit.publishImmediately !== undefined ? <ProvBadge kind="override" /> : <ProvBadge kind="inherit" />}
            </span>
          </label>
        </div>
      </div>

      {!included ? (
        <div className="bulk-editor__excl-note">
          This variant is excluded - it will not be submitted. The product&apos;s other variants still list and group, but
          buyers will see one fewer option. Switch it back on to include it.
        </div>
      ) : null}

      {variant.blockers.map((blocker) => (
        <div key={blocker} className="bulk-editor__banner bulk-editor__banner--error">
          <b>{blocker}.</b> Resolve this blocker for the variant, or exclude it.{' '}
          <Button tone="ghost" type="button" className="button--sm" onClick={onFixOnBase}>
            Fix on base
          </Button>
        </div>
      ))}

      <div className="eyebrow" style={{ marginBottom: 'var(--space-3)' }}>
        Per-variant
      </div>

      {/* Title + description overrides - collapsed at the top; inherit base by default. */}
      <details className="bulk-editor__field">
        <summary style={{ cursor: 'pointer', color: 'var(--accent-primary)' }}>
          Override base title / description
        </summary>
        <div style={{ marginTop: 'var(--space-3)' }}>
          <InheritableTextField
            label="Title"
            overridden={edit.title !== undefined}
            value={edit.title ?? ''}
            baseValue={baseValues.title}
            ariaLabel={`Title for ${label}`}
            onChange={(next) => onPatch({ title: next })}
          />
          <div className="bulk-editor__field">
            <label>
              Description {edit.description !== undefined ? <ProvBadge kind="override" /> : <ProvBadge kind="inherit" />}
              {edit.description !== undefined ? (
                <button type="button" className="bulk-editor__reset" onClick={() => onPatch({ description: undefined })}>
                  ↺ reset to base
                </button>
              ) : null}
            </label>
            <Textarea
              className={[
                'bulk-editor__input',
                edit.description !== undefined ? 'bulk-editor__input--overridden' : 'bulk-editor__input--inherited',
              ].join(' ')}
              rows={4}
              value={edit.description !== undefined ? edit.description : baseValues.description}
              aria-label={`Description for ${label}`}
              onChange={(e) =>
                onPatch({ description: e.target.value === baseValues.description ? undefined : e.target.value })
              }
            />
          </div>
        </div>
      </details>

      {/* EAN - from master, editable, GS1 + intra-group duplicate validated. */}
      <div className="bulk-editor__field">
        <label>
          EAN (GTIN) {ean.trim() !== master ? <ProvBadge kind="override" /> : <ProvBadge kind="master" />}
        </label>
        <Input
          className={['bulk-editor__input', eanError ? 'bulk-editor__input--error' : ''].filter(Boolean).join(' ')}
          value={ean}
          inputMode="numeric"
          aria-label={`EAN for ${label}`}
          aria-invalid={Boolean(eanError)}
          onChange={(e) => onPatch({ ean: e.target.value })}
        />
        {eanError ? <div className="bulk-editor__ean-err">{eanError}</div> : null}
        <div className="hint" style={{ color: 'var(--text-muted)', fontSize: 12 }}>
          Pre-filled from this variant&apos;s master EAN. Edits are checksum + duplicate validated; clearing lists it
          without a catalog card.
        </div>
      </div>

      {/* Stock (read-only, authoritative from master incl. 0) + Price
          (inherit base / override) on one row. The variant header above
          ("Variant - {label}") already surfaces the distinguishing attribute,
          so a separate read-only Distinguishing field would just duplicate it. */}
      <div className="bulk-editor__row2">
        <div className="bulk-editor__field">
          <label>
            Stock <ProvBadge kind="master" />
          </label>
          <Input
            className="bulk-editor__input bulk-editor__input--inherited"
            value={variant.masterStock ?? 0}
            readOnly
            aria-readonly="true"
          />
          <div className="hint" style={{ color: 'var(--text-muted)', fontSize: 12 }}>
            Authoritative from master inventory. Out-of-stock lists as 0, never backfilled.
          </div>
        </div>

        <InheritableTextField
          label="Price"
          overridden={edit.price !== undefined}
          value={edit.price ?? ''}
          baseValue={basePriceValue}
          ariaLabel={`Price for ${label}`}
          onChange={(next) => onPatch({ price: next })}
        />
      </div>

      {/* Images - inherit base set / override among master URLs. */}
      <div className="bulk-editor__field">
        <label>
          Images {imagesOverridden ? <ProvBadge kind="override" /> : <ProvBadge kind="inherit" />}
          {imagesOverridden ? (
            <button
              type="button"
              className="bulk-editor__reset"
              onClick={() => onPatch({ imageUrls: undefined })}
            >
              ↺ reset to base
            </button>
          ) : null}
        </label>
        <div className="bulk-editor__img-strip bulk-editor__img-strip--editable">
          {effectiveImages.map((url, i) => (
            <span
              key={`${url}-${i}`}
              className={['bulk-editor__img-thumb', imagesOverridden ? '' : 'bulk-editor__img-thumb--ghost']
                .filter(Boolean)
                .join(' ')}
            >
              <ThumbZoomButton url={url} onZoom={onZoom} />
              <button
                type="button"
                className="bulk-editor__img-x"
                aria-label="Remove image"
                onClick={() => {
                  const base = edit.imageUrls ?? masterImages;
                  const next = base.filter((_, idx) => idx !== i);
                  onPatch({ imageUrls: next });
                }}
              >
                ×
              </button>
            </span>
          ))}
          {!addingImage ? (
            <button
              type="button"
              className="bulk-editor__img-add"
              aria-label="Add image"
              onClick={() => setAddingImage(true)}
            >
              ＋
            </button>
          ) : null}
        </div>
        {addingImage ? (
          <div className="bulk-editor__img-add-row">
            <Input
              className="bulk-editor__input"
              value={newImageUrl}
              onChange={(e) => setNewImageUrl(e.target.value)}
              placeholder="https://example.com/image.jpg"
              aria-label="New image URL"
            />
            <Button
              tone="primary"
              type="button"
              className="button--sm"
              onClick={() => {
                const url = newImageUrl.trim();
                if (url === '') return;
                onPatch({ imageUrls: [...effectiveImages, url] });
                setNewImageUrl('');
                setAddingImage(false);
              }}
            >
              Add
            </Button>
            <Button
              tone="ghost"
              type="button"
              className="button--sm"
              onClick={() => {
                setNewImageUrl('');
                setAddingImage(false);
              }}
            >
              Cancel
            </Button>
          </div>
        ) : null}
        <div className="hint" style={{ color: 'var(--text-muted)', fontSize: 12 }}>
          {imagesOverridden
            ? 'Custom image set for this variant.'
            : 'Inherits the base images - add or remove to override for this variant.'}
        </div>
      </div>

      {/* Category parameters - inheritable; required first, optional collapsed
          behind an expander (mirrors the base CategoryParametersStep). */}
      {categoryParameters.length > 0 ? (
        <div className="bulk-editor__platform-slot">
          <div className="bulk-editor__slot-tag">
            <span className="eyebrow">Category parameters</span>
          </div>
          <div className="hint" style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 'var(--space-3)' }}>
            Everything inherits from base. Override only the parameters that differ for this variant.
          </div>
          {requiredParams.length > 0 ? (
            <div className="bulk-editor__vparams-grid">{requiredParams.map(renderVariantParam)}</div>
          ) : null}
          {optionalParams.length > 0 ? (
            <details className="category-parameters-step__expander">
              <summary className="category-parameters-step__expander-summary">
                Show optional fields ({optionalParams.length})
              </summary>
              <div className="bulk-editor__vparams-grid">{optionalParams.map(renderVariantParam)}</div>
            </details>
          ) : null}
        </div>
      ) : null}

      {/* Progressive disclosure - rarely-touched base overrides. */}
    </div>
  );
}

/**
 * An inheritable single-line text/number field (#1741). The base value is
 * pre-filled as the actual input VALUE (not a ghosted placeholder) so what the
 * variant inherits is visible and editable in place. Provenance is derived by
 * comparing against the base: typing a value that equals the base is treated as
 * INHERITED (`onChange(undefined)`), a diverging value is an OVERRIDE
 * (`onChange(value)`). Reset clears the override (`onChange(undefined)`).
 *
 * Contract: `value` is the current override (meaningful only when `overridden`),
 * `baseValue` is the inherited base. Display = `overridden ? value : baseValue`.
 * `onChange` receives `undefined` for inherit, the string for an override.
 */
function InheritableTextField({
  label,
  overridden,
  value,
  baseValue,
  ariaLabel,
  type,
  provNode,
  onReset,
  onChange,
}: {
  label: string;
  overridden: boolean;
  value: string;
  baseValue: string;
  ariaLabel: string;
  /** `'number'` for integer/float category parameters; defaults to text. */
  type?: 'text' | 'number';
  /** Custom provenance badge (e.g. the base-only "splits listing" chip). */
  provNode?: ReactNode;
  /** Custom reset handler; when set the reset control always shows. */
  onReset?: () => void;
  onChange: (next: string | undefined) => void;
}): ReactElement {
  const displayValue = overridden ? value : baseValue;
  const showReset = overridden || Boolean(onReset);
  return (
    <div className="bulk-editor__field">
      <label>
        {label} {provNode ?? (overridden ? <ProvBadge kind="override" /> : <ProvBadge kind="inherit" />)}
        {showReset ? (
          <button type="button" className="bulk-editor__reset" onClick={() => (onReset ? onReset() : onChange(undefined))}>
            ↺ reset to base
          </button>
        ) : null}
      </label>
      <Input
        type={type ?? 'text'}
        className={[
          'bulk-editor__input',
          overridden ? 'bulk-editor__input--overridden' : 'bulk-editor__input--inherited',
        ].join(' ')}
        value={displayValue}
        aria-label={ariaLabel}
        onChange={(e) => {
          const typed = e.target.value;
          onChange(typed === baseValue ? undefined : typed);
        }}
      />
    </div>
  );
}

/**
 * Zoomable thumbnail trigger (#1741). A `role="button"` span (not a native
 * `<button>`) so it stays clickable even inside the demo read-only `fieldset`
 * disabled cascade - zooming is always allowed; only edit actions are gated.
 * `stopPropagation` keeps the click from toggling the surrounding controls.
 */
function ThumbZoomButton({ url, onZoom }: { url: string; onZoom: (src: string) => void }): ReactElement {
  return (
    <span
      role="button"
      tabIndex={0}
      className="bulk-editor__thumb-btn"
      aria-label="Zoom image"
      onClick={(e) => {
        e.stopPropagation();
        onZoom(url);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onZoom(url);
        }
      }}
    >
      <img src={url} alt="" />
    </span>
  );
}

/** Human display for a parameter's base value (dictionary ids -> entry labels). */
function baseParamDisplay(param: CategoryParameter, baseValues: BulkEditModalValues): string {
  const raw = (baseValues.parameters as CategoryParameterFormValues | undefined)?.[param.id];
  if (raw === undefined) return '';
  if (param.type === 'dictionary' && param.dictionary) {
    const ids = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
    if (ids.length === 0) return '';
    return ids.map((id) => param.dictionary?.find((e) => e.id === id)?.value ?? id).join(', ');
  }
  return stringifyParamValue(raw);
}

/**
 * Inheritable native <select> for a small single-select dictionary parameter -
 * the per-variant analogue of the base scope's native select. A leading
 * "Inherit from base" sentinel surfaces the base value; picking it reverts to
 * inherited, picking a real entry overrides.
 */
function InheritableSelectField({
  label,
  overridden,
  value,
  options,
  baseDisplay,
  ariaLabel,
  provNode,
  onReset,
  onChange,
}: {
  label: string;
  overridden: boolean;
  value: string | undefined;
  options: { id: string; label: string }[];
  baseDisplay: string;
  ariaLabel: string;
  provNode?: ReactNode;
  onReset?: () => void;
  onChange: (next: string | undefined) => void;
}): ReactElement {
  const showReset = overridden || Boolean(onReset);
  return (
    <div className="bulk-editor__field">
      <label>
        {label} {provNode ?? (overridden ? <ProvBadge kind="override" /> : <ProvBadge kind="inherit" />)}
        {showReset ? (
          <button type="button" className="bulk-editor__reset" onClick={() => (onReset ? onReset() : onChange(undefined))}>
            ↺ reset to base
          </button>
        ) : null}
      </label>
      <select
        className={[
          'bulk-editor__input',
          overridden ? 'bulk-editor__input--overridden' : 'bulk-editor__input--inherited',
        ].join(' ')}
        value={value ?? ''}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
      >
        <option value="">{baseDisplay ? `Inherit from base (${baseDisplay})` : 'Inherit from base'}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Inheritable Combobox for a large / multi-select / custom-value dictionary
 * parameter - the per-variant analogue of the base scope's Combobox. Reuses the
 * base scope's value <-> combobox helpers so the wire shape matches. Clearing
 * the selection reverts to inherited (the placeholder surfaces the base value).
 */
function InheritableComboboxField({
  label,
  parameter,
  overridden,
  value,
  baseDisplay,
  ariaLabel,
  provNode,
  onReset,
  onChange,
}: {
  label: string;
  parameter: CategoryParameter;
  overridden: boolean;
  value: FormParameterValue;
  baseDisplay: string;
  ariaLabel: string;
  provNode?: ReactNode;
  onReset?: () => void;
  onChange: (next: FormParameterValue) => void;
}): ReactElement {
  const showReset = overridden || Boolean(onReset);
  return (
    <div className="bulk-editor__field">
      <label>
        {label} {provNode ?? (overridden ? <ProvBadge kind="override" /> : <ProvBadge kind="inherit" />)}
        {showReset ? (
          <button type="button" className="bulk-editor__reset" onClick={() => (onReset ? onReset() : onChange(undefined))}>
            ↺ reset to base
          </button>
        ) : null}
      </label>
      <Combobox
        ariaLabel={ariaLabel}
        options={(parameter.dictionary ?? []).map((e) => toComboboxOption(e))}
        mode={parameter.restrictions.multipleChoices ? 'multi' : 'single'}
        allowCustomValues={parameter.restrictions.customValuesEnabled}
        value={toComboboxValue(parameter, value)}
        onChange={(next: ComboboxValue | null) => onChange(fromComboboxValue(parameter, next))}
        placeholder={baseDisplay ? `Inherit from base (${baseDisplay})` : 'Pick a value or inherit from base'}
        invalid={false}
      />
    </div>
  );
}

/**
 * Renders the plugin-resolved per-row platform section (#1096) - a thin wrapper
 * so the dynamically-resolved `ComponentType` is invoked as a JSX element.
 */
function PlatformRowSection({
  section: Section,
  connection,
  platformParams,
  onChange,
}: {
  section: ComponentType<BulkOfferRowSectionProps>;
  connection: Connection;
  platformParams: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}): ReactElement {
  return <Section connection={connection} platformParams={platformParams} onChange={onChange} />;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function stringifyParamValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string').join(', ');
  if (value && typeof value === 'object' && 'from' in value && 'to' in value) {
    const range = value as { from: string; to: string };
    return `${range.from}-${range.to}`;
  }
  return '';
}

/**
 * Project the live edit model onto a row shape so `duplicateEanVariantIds` can
 * flag intra-group EAN collisions using the operator's in-progress edits.
 */
function applyEditsToRow(
  row: BulkWizardRow,
  variantEdits: Record<string, VariantEdit>,
  included: Record<string, boolean>,
): BulkWizardRow {
  return {
    ...row,
    variants: row.variants.map((v) => {
      const edit = variantEdits[v.variantId];
      const eanTrimmed = edit?.ean.trim() ?? '';
      return {
        ...v,
        included: included[v.variantId] ?? v.included,
        override: {
          ...v.override,
          overrides: {
            ...v.override.overrides,
            ...(eanTrimmed !== '' ? { ean: eanTrimmed } : {}),
          },
        },
      };
    }),
  };
}
