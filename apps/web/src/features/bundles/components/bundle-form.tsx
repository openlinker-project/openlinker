/**
 * Bundle form (#3624, #3935)
 *
 * A stepper, because a bundle is four separate decisions and one long form hid
 * which: what is in it, which product it is sold as (one the shop already has,
 * or a new one OpenLinker creates), how a gift looks on a document, and a last
 * look before saving. A summary is always in view (a column beside the steps,
 * a bottom sheet on a phone) so the name, price, availability and what limits
 * it never depend on remembering an earlier step.
 *
 * The price split, the availability and the open-order sentence are derived on
 * screen from what the operator has typed; nothing here is stored except the
 * composition (and the gift mark on a component) and, for a new product, the
 * product the master creates.
 *
 * @module apps/web/src/features/bundles/components
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { useWriteAccess } from '../../../shared/auth/use-permission';
import { useSession } from '../../../shared/auth/use-session';
import { formatPlural, interpolate, useFormat, useLocale, useMessages } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { SNAPPY_SPRING } from '../../../shared/ui/motion-presets';
import { SaveButton, useSaveButtonState } from '../../../shared/ui/save-button';
import { SetupStepper } from '../../../shared/ui/setup-stepper';
import { SidePanel } from '../../../shared/ui/side-panel';
import { StickyActionBar } from '../../../shared/ui/sticky-action-bar';
import { useToast } from '../../../shared/ui/toast-provider';
import { useDemoMode } from '../../system';
import { useConnectionsQuery } from '../../connections';
import type { ApiError } from '../../../shared/api/api-error';
import { isBundleNestingReason } from '../api/bundles.types';
import {
  useBundleCreationTargetsQuery,
  useBundleHistoryQuery,
  useBundleQuery,
} from '../hooks/use-bundle-queries';
import { useCreateBundleProductMutation } from '../hooks/use-create-bundle-product-mutation';
import { useSyncBundleFromMasterMutation } from '../hooks/use-sync-bundle-from-master-mutation';
import { useSaveBundleMutation } from '../hooks/use-save-bundle-mutation';
import { computeBundleAvailability } from '../lib/bundle-availability';
import { toBundleChoice, type BundleProductChoice } from '../lib/bundle-choice';
import {
  BUNDLE_STEP_KEYS,
  EMPTY_PRODUCT_DRAFT,
  bundleFormSchema,
  componentsSum,
  formatPriceInput,
  parsePrice,
  quantitySchema,
  suggestedDescription,
  suggestedSku,
  type BundleFormValues,
  type BundleProductMode,
  type BundleStepKey,
  type NewProductDraft,
} from '../lib/bundle-form-model';
import {
  GiftFormPickerValues,
  useGiftDocumentSettingsQuery,
  useGiftFormLabels,
  type GiftDocumentFormChoice,
} from '../../gift-documents';
import { BundleGuide, BundleGuideButton } from './bundle-guide';
import { BundleHistory } from './bundle-history';
import { BundleLeaveGuard } from './bundle-leave-guard';
import { BundleLoadError } from './bundle-load-error';
import { BundleStepComponents } from './bundle-step-components';
import { BundleStepGifts } from './bundle-step-gifts';
import { BundleStepProduct } from './bundle-step-product';
import { BundleStepReview } from './bundle-step-review';
import { BundleSummary } from './bundle-summary';

function isGiftDocumentFormChoice(value: string): value is GiftDocumentFormChoice {
  return (GiftFormPickerValues as readonly string[]).includes(value);
}

export interface BundleFormSeedComponent {
  /** The exact variant, when the caller knows it (the multipack hold does). */
  variantId?: string;
  /** A product; used only when it has a single variant, otherwise the form starts empty. */
  productId?: string;
  quantity: number;
}

export interface BundleFormProps {
  /** Present when editing an existing bundle. */
  bundleVariantId?: string;
  /** A component to start from: "Make a bundle from this" and the multipack hold. */
  seedComponent?: BundleFormSeedComponent;
}

interface HandedOverSave {
  available: number | null;
  released: number;
}

function readHandedOverSave(state: unknown): HandedOverSave | null {
  if (typeof state !== 'object' || state === null) return null;
  const saved = (state as Record<string, unknown>).bundleSaved;
  if (typeof saved !== 'object' || saved === null) return null;
  const record = saved as Record<string, unknown>;
  return {
    available: typeof record.available === 'number' ? record.available : null,
    released: typeof record.released === 'number' ? record.released : 0,
  };
}

function readErrorCode(error: ApiError | null): { code: string | null; reason: string | null } {
  const details = error?.details;
  if (typeof details === 'object' && details !== null) {
    const record = details as Record<string, unknown>;
    return {
      code: typeof record.code === 'string' ? record.code : null,
      reason: typeof record.reason === 'string' ? record.reason : null,
    };
  }
  return { code: null, reason: null };
}

export function BundleForm({ bundleVariantId, seedComponent }: BundleFormProps): ReactElement {
  const copy = useMessages('bundles');
  const giftSettings = useGiftDocumentSettingsQuery();
  const giftLabels = useGiftFormLabels();
  const { locale } = useLocale();
  const format = useFormat();
  const apiClient = useApiClient();
  const { showToast } = useToast();
  const demoMode = useDemoMode();
  const write = useWriteAccess('bundles:write', demoMode);
  const editing = bundleVariantId !== undefined;
  const navigate = useNavigate();
  const location = useLocation();
  const reduceMotion = useReducedMotion() ?? false;
  // A create navigates to the edit route (so a second Save is an update) and
  // hands the result over, since the route change remounts this form.
  const handedOver = readHandedOverSave(location.state);

  const detail = useBundleQuery(bundleVariantId);
  const history = useBundleHistoryQuery(bundleVariantId, editing);
  const targets = useBundleCreationTargetsQuery();
  const [showErrors, setShowErrors] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);
  const [savedCount, setSavedCount] = useState(0);
  const save = useSaveBundleMutation();
  const createProduct = useCreateBundleProductMutation();
  const saveButtonState = useSaveButtonState(save.isPending || createProduct.isPending, savedCount);
  const syncFromMaster = useSyncBundleFromMasterMutation();

  const { isReady: sessionReady } = useSession();
  const connections = useConnectionsQuery();
  const [searchParams, setSearchParams] = useSearchParams();
  const [maxStep, setMaxStep] = useState<number>(
    handedOver !== null || editing ? BUNDLE_STEP_KEYS.length - 1 : 0
  );
  // The step lives in the URL (`?krok=`) so the browser's Back button walks the
  // steps instead of leaving the wizard, and a reload lands on the same step. A
  // step past the furthest one the operator has reached falls back to it.
  const requestedKey = searchParams.get('krok');
  const requestedStep = BUNDLE_STEP_KEYS.findIndex((key) => key === requestedKey);
  const step = Math.min(
    requestedStep >= 0 ? requestedStep : handedOver !== null ? BUNDLE_STEP_KEYS.length - 1 : 0,
    maxStep
  );
  const setStep = (index: number): void => {
    const key = BUNDLE_STEP_KEYS[index];
    if (key === undefined) return;
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.set('krok', key);
        return next;
      },
      { replace: false }
    );
  };
  const previousStep = useRef(step);
  const direction = step >= previousStep.current ? 1 : -1;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const savedRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const released = useRef(false);
  const stepMounted = useRef(false);
  const pendingFocus = useRef(false);
  const [announcement, setAnnouncement] = useState('');
  const [blockedNote, setBlockedNote] = useState<string | null>(null);
  const [createdProduct, setCreatedProduct] = useState<{
    variantId: string;
    productId: string;
    name: string;
  } | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [mode, setMode] = useState<BundleProductMode>('existing');
  const [draft, setDraft] = useState<NewProductDraft>(EMPTY_PRODUCT_DRAFT);
  const [createError, setCreateError] = useState<string | null>(null);
  const [bundleProduct, setBundleProduct] = useState<BundleProductChoice | null>(null);
  const [nestedError, setNestedError] = useState<string | null>(null);
  const [savedAs, setSavedAs] = useState<{
    available: number | null;
    released: number;
    productId: string;
    variantId: string;
  } | null>(
    handedOver !== null && bundleVariantId !== undefined
      ? { ...handedOver, productId: '', variantId: bundleVariantId }
      : null
  );
  const [saveError, setSaveError] = useState<string | null>(null);

  const seed = useQuery({
    queryKey: [
      'bundles',
      'seed-component',
      seedComponent?.variantId ?? seedComponent?.productId ?? '',
    ],
    queryFn: async (): Promise<BundleProductChoice> => {
      const productId =
        seedComponent?.variantId !== undefined
          ? (await apiClient.products.getVariant(seedComponent.variantId)).productId
          : seedComponent?.productId ?? '';
      const product = await apiClient.products.getById(productId);
      const variants = product.variants ?? [];
      const picked =
        seedComponent?.variantId !== undefined
          ? variants.find((v) => v.id === seedComponent.variantId)
          : variants.length === 1
            ? variants[0]
            : undefined;
      if (picked === undefined) {
        throw new Error('seed variant not found');
      }
      return toBundleChoice(product, picked, variants.length);
    },
    retry: false,
    enabled: seedComponent !== undefined && !editing,
  });

  const form = useForm<BundleFormValues>({
    resolver: zodResolver(bundleFormSchema),
    defaultValues: { components: [] },
    mode: 'onChange',
  });
  const components = useFieldArray({ control: form.control, name: 'components' });
  const [seededFrom, setSeededFrom] = useState<string | null>(null);

  // Seed the rows once the source of truth has arrived. State derived during
  // render (not an effect) so a refetch never overwrites what the operator typed.
  const editSeedKey =
    editing && detail.data ? `edit:${detail.data.variantId}:${String(detail.data.version)}` : null;
  const newSeedKey = !editing && seed.data && seedComponent ? `new:${seed.data.variantId}` : null;
  const seedKey = editSeedKey ?? newSeedKey;
  if (seedKey !== null && seedKey !== seededFrom) {
    setSeededFrom(seedKey);
    if (editing && detail.data) {
      setBundleProduct({
        variantId: detail.data.variantId,
        productId: detail.data.productId ?? '',
        name: detail.data.bundle.name ?? '',
        sku: detail.data.bundle.sku,
        price: detail.data.bundle.price,
        currency: detail.data.bundle.currency,
        availableToPromise: detail.data.bundlesAvailable,
        isBundle: true,
        imageUrl: detail.data.bundle.imageUrl ?? null,
      });
      form.reset({
        components: detail.data.componentAvailability.map((component) => ({
          variantId: component.variantId,
          productId: component.productId,
          name: component.summary.name ?? component.summary.sku ?? component.variantId,
          sku: component.summary.sku,
          price: component.summary.price,
          currency: component.summary.currency,
          availableToPromise: component.availableToPromise,
          isBundle: false,
          imageUrl: component.summary.imageUrl ?? null,
          quantity: String(component.quantity),
          gift: component.giftSlot === true,
          documentForm: component.documentForm ?? '',
        })),
      });
    } else if (seed.data && seedComponent) {
      form.reset({
        components: [
          { ...seed.data, quantity: String(seedComponent.quantity), gift: false, documentForm: '' },
        ],
      });
    }
  }

  const rows = form.watch('components');
  const currency =
    bundleProduct?.currency ?? rows.find((row) => row.currency !== null)?.currency ?? undefined;
  // Not memoised: `watch` hands back the same array when one nested field
  // changes, so a memo keyed on it would keep showing the previous gift mark.
  const parsedRows = rows.map((row) => ({
    ...row,
    qty: quantitySchema.safeParse(row.quantity).success ? Number(row.quantity) : 0,
  }));

  const availability = computeBundleAvailability(
    parsedRows
      .filter((row) => row.qty > 0)
      .map((row) => ({
        name: row.name,
        quantity: row.qty,
        availableToPromise: row.availableToPromise,
      }))
  );

  const readOnly = !write.canWrite;
  const creators = (targets.data ?? []).filter((target) => target.creationMode !== null);
  const creating = !editing && mode === 'create';
  const masterId = draft.connectionId !== '' ? draft.connectionId : (creators[0]?.connectionId ?? '');
  const masterName = creators.find((target) => target.connectionId === masterId)?.connectionName ?? '';
  const effectiveSku = draft.touched.sku ? draft.sku : suggestedSku(parsedRows);
  const effectivePriceText = draft.touched.price
    ? draft.price
    : formatPriceInput(componentsSum(parsedRows));
  const newPrice = parsePrice(effectivePriceText);
  const effectiveDescription = draft.touched.description
    ? draft.description
    : suggestedDescription(parsedRows);
  const newProductValid = draft.name.trim() !== '' && effectiveSku.trim() !== '' && newPrice !== null && masterId !== '';

  const bundleName = creating ? (draft.name.trim() !== '' ? draft.name : null) : (bundleProduct?.name ?? null);
  const bundlePrice = creating ? newPrice : (bundleProduct?.price ?? null);

  const title = editing
    ? bundleProduct?.name ?? copy.form.editTitleFallback
    : seedComponent !== undefined
      ? copy.form.fromProductTitle
      : copy.form.newTitle;

  const addComponent = (choice: BundleProductChoice): void => {
    if (choice.isBundle) {
      setNestedError(interpolate(copy.form.nestedBundle, { name: choice.name }));
      return;
    }
    if (choice.variantId === bundleProduct?.variantId) {
      setNestedError(copy.form.nestedSelf);
      return;
    }
    setNestedError(null);
    components.append(
      {
        ...choice,
        imageUrl: choice.imageUrl ?? null,
        ean: choice.ean ?? null,
        attributes: choice.attributes ?? null,
        quantity: '1',
        gift: false,
        documentForm: '',
      },
      { shouldFocus: false }
    );
  };

  const pickBundleProduct = (choice: BundleProductChoice): void => {
    if (rows.some((row) => row.variantId === choice.variantId)) {
      setNestedError(copy.form.nestedSelf);
      return;
    }
    setNestedError(null);
    setBundleProduct(choice);
  };

  const master = detail.data?.composedByMaster ?? null;
  const runMasterSync = (): void => {
    if (master === null || bundleVariantId === undefined) return;
    syncFromMaster.mutate(bundleVariantId, {
      onSuccess: () => {
        showToast({
          tone: 'success',
          description: interpolate(copy.form.syncDone, { name: master.connectionName }),
        });
      },
      onError: (error) => {
        const details =
          typeof error.details === 'object' && error.details !== null
            ? (error.details as Record<string, unknown>)
            : {};
        const unmapped = Array.isArray(details.unmappedComponents)
          ? details.unmappedComponents.filter((id): id is string => typeof id === 'string')
          : [];
        showToast({
          tone: 'error',
          description:
            details.reason === 'component-unmapped'
              ? interpolate(copy.form.syncUnmapped, { ids: unmapped.join(', ') })
              : details.reason === 'not-a-bundle-in-master'
                ? interpolate(copy.form.syncNotPack, { name: master.connectionName })
                : details.reason === 'master-unavailable'
                  ? interpolate(copy.form.syncMasterUnavailable, { name: master.connectionName })
                  : copy.form.syncFailed,
        });
      },
    });
  };

  const writeDefinition = (
    target: { variantId: string; productId: string; name: string },
    values: BundleFormValues
  ): void => {
    save.mutate(
      {
        variantId: target.variantId,
        existing: editing,
        components: values.components.map((row) => ({
          variantId: row.variantId,
          quantity: Number(row.quantity),
          ...(row.gift ? { giftSlot: true } : {}),
          ...(row.gift && isGiftDocumentFormChoice(row.documentForm)
            ? { documentForm: row.documentForm }
            : {}),
        })),
      },
      {
        onSuccess: (result) => {
          setNestedError(null);
          setSaveError(null);
          setSavedCount((n) => n + 1);
          setCreatedProduct(null);
          const available = availability.kind === 'known' ? availability.bundles : null;
          setSavedAs({
            available,
            released: result.releasedOrders,
            productId: target.productId,
            variantId: target.variantId,
          });
          if (editing) {
            // What was just saved is the new baseline, so Save waits for the next change.
            form.reset(form.getValues());
          } else {
            released.current = true;
            // Now an existing bundle: the next Save must be an update, not a
            // second create that answers 409.
            void navigate(`/products/bundles/${encodeURIComponent(target.variantId)}`, {
              replace: true,
              state: { bundleSaved: { available, released: result.releasedOrders } },
            });
          }
        },
        onError: (error) => {
          const { code, reason } = readErrorCode(error);
          if (code === 'BUNDLE_NESTING_REFUSED') {
            setNestedError(
              reason === 'component-is-self'
                ? copy.form.nestedSelf
                : isBundleNestingReason(reason) && reason === 'variant-is-component'
                  ? interpolate(copy.form.nestedVariantIsComponent, { name: target.name })
                  : copy.form.nestedGeneric
            );
            return;
          }
          setSaveError(
            error.status === 409
              ? copy.form.saveConflict
              : error.status === 400
                ? copy.form.saveInvalid
                : error.status === 404
                  ? copy.form.saveNotFound
                  : copy.form.saveFailed
          );
        },
      }
    );
  };

  const submit = form.handleSubmit((values) => {
    setCreateError(null);
    if (creating) {
      if (createdProduct !== null) {
        // The product was created by an earlier attempt whose composition write
        // failed; creating again would make a second product.
        writeDefinition(createdProduct, values);
        return;
      }
      const rateSource = values.components.find((row) => !row.gift) ?? values.components[0];
      createProduct.mutate(
        {
          connectionId: masterId,
          name: draft.name.trim(),
          sku: effectiveSku.trim(),
          price: newPrice ?? 0,
          ...(currency !== undefined ? { currency } : {}),
          ...(draft.ean.trim() !== '' ? { ean: draft.ean.trim() } : {}),
          ...(effectiveDescription.trim() !== '' ? { description: effectiveDescription.trim() } : {}),
          ...(rateSource !== undefined ? { rateSourceVariantId: rateSource.variantId } : {}),
        },
        {
          onSuccess: (created) => {
            if (created.adopted) {
              showToast({ tone: 'info', description: copy.form.s2Adopted });
            }
            const target = {
              variantId: created.variantId,
              productId: created.productId,
              name: created.name,
            };
            setCreatedProduct(target);
            writeDefinition(target, values);
          },
          onError: (error) => {
            const { reason } = readErrorCode(error);
            setCreateError(
              reason === 'master-cannot-create-products'
                ? interpolate(copy.form.s2CreateCannot, { name: masterName })
                : reason === 'master-unavailable'
                  ? interpolate(copy.form.s2CreateUnavailable, { name: masterName })
                  : reason === 'not-synced'
                    ? copy.form.s2CreateNotSynced
                    : error.status === 422
                      ? copy.form.s2CreateFailed
                      : copy.form.s2CreateFailedGeneric
            );
            setStep(BUNDLE_STEP_KEYS.indexOf('product'));
          },
        }
      );
      return;
    }
    if (!bundleProduct) return;
    writeDefinition(bundleProduct, values);
  });

  const quantitiesOk = rows.length > 0 && !parsedRows.some((row) => row.qty === 0);
  const productOk = editing || (creating ? newProductValid : bundleProduct !== null);
  const stepValid: Record<BundleStepKey, boolean> = {
    components: quantitiesOk,
    product: productOk,
    gifts: true,
    review: quantitiesOk && productOk,
  };
  // Built from the real predicates, so the bar names the field that is wrong
  // instead of one sentence covering four of them.
  const missingFor = (key: BundleStepKey): string[] => {
    const list: string[] = [];
    if (key === 'components' || key === 'review') {
      if (rows.length === 0) list.push(copy.form.missingComponent);
      else if (!quantitiesOk) list.push(copy.form.missingQuantities);
    }
    if ((key === 'product' || key === 'review') && !productOk) {
      if (creating) {
        if (draft.name.trim() === '') list.push(copy.form.missingName);
        if (effectiveSku.trim() === '') list.push(copy.form.missingSku);
        if (newPrice === null) list.push(copy.form.missingPrice);
        if (masterId === '') list.push(copy.form.missingShop);
      } else {
        list.push(copy.form.missingProduct);
      }
    }
    return list;
  };
  const missing = missingFor('review');
  const ready = missing.length === 0;
  const stepKey = BUNDLE_STEP_KEYS[step] ?? 'components';
  const stepMissing = missingFor(stepKey).join(' · ');
  const saveBlocked = readOnly || save.isPending || createProduct.isPending;
  const openOrders = detail.data?.openOrdersOnOlderComposition ?? 0;
  const lastStep = step === BUNDLE_STEP_KEYS.length - 1;

  const failStep = (): void => {
    setShowErrors(true);
    setShakeKey((n) => n + 1);
    pendingFocus.current = true;
  };
  const goTo = (index: number): void => {
    // Never past what the earlier steps have answered.
    for (let i = 0; i < index; i += 1) {
      const key = BUNDLE_STEP_KEYS[i];
      if (key !== undefined && !stepValid[key]) {
        failStep();
        setBlockedNote(
          interpolate(copy.form.stepLockedFirst, { n: i + 1, missing: missingFor(key).join(' · ') })
        );
        setStep(i);
        return;
      }
    }
    setBlockedNote(null);
    setStep(index);
    setMaxStep((current) => Math.max(current, index));
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  };
  const goNext = (): void => {
    if (!stepValid[stepKey]) {
      failStep();
      return;
    }
    goTo(step + 1);
  };
  const pressSave = (): void => {
    if (!ready) {
      failStep();
      return;
    }
    void submit();
  };

  // A step change moves focus to the new step's heading and says so, because a
  // scroll alone leaves a keyboard user on a button that is no longer there.
  useEffect(() => {
    previousStep.current = step;
    if (!stepMounted.current) {
      stepMounted.current = true;
      return;
    }
    headingRef.current?.focus({ preventScroll: true });
    setAnnouncement(
      interpolate(copy.form.stepAnnounce, {
        n: step + 1,
        total: BUNDLE_STEP_KEYS.length,
        name: copy.form.stepNames[BUNDLE_STEP_KEYS[step] ?? 'components'],
      })
    );
  }, [step]);

  // A refused Next/Save lands on the first control that is wrong, so the
  // refusal is not a shake the operator has to interpret.
  useEffect(() => {
    if (!pendingFocus.current) return;
    pendingFocus.current = false;
    const panel = panelRef.current;
    if (panel === null) return;
    const target =
      panel.querySelector<HTMLElement>('[aria-invalid="true"]') ??
      panel.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled])');
    target?.focus({ preventScroll: true });
    target?.scrollIntoView?.({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
  }, [shakeKey, step, reduceMotion]);

  // A save result is at the top of the page while the Save button is at the
  // bottom, so bring it to the operator.
  useEffect(() => {
    if (savedAs === null) return;
    savedRef.current?.focus({ preventScroll: true });
    savedRef.current?.scrollIntoView?.({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
  }, [savedAs, reduceMotion]);
  useEffect(() => {
    if (saveError === null) return;
    errorRef.current?.focus({ preventScroll: true });
    errorRef.current?.scrollIntoView?.({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
  }, [saveError, reduceMotion]);

  const dirty = form.formState.isDirty;
  const guardActive = editing
    ? dirty
    : rows.length > 0 || draft !== EMPTY_PRODUCT_DRAFT || bundleProduct !== null;

  const giftRows = parsedRows.filter((row) => row.gift && row.qty > 0);
  const inheritedForm = giftSettings.data?.giftDocumentForm ?? null;
  const giftFormLabel = (documentForm: string): string =>
    isGiftDocumentFormChoice(documentForm)
      ? giftLabels.short(documentForm)
      : inheritedForm !== null
        ? interpolate(copy.form.s3Inherit, { form: giftLabels.short(inheritedForm) })
        : copy.form.s3InheritUnknown;
  const giftDocumentLine =
    giftRows.length === 0
      ? null
      : interpolate(copy.form.summaryGiftDoc, {
          form: giftRows.map((row) => giftFormLabel(row.documentForm)).join(', '),
        });
  const giftLine =
    giftRows.length === 0
      ? copy.form.s4NoGifts
      : giftRows.map((row) => `${row.name}: ${giftFormLabel(row.documentForm)}`).join('; ');
  const productLine = creating
    ? `${draft.name.trim() || copy.form.readbackNoProduct} (${interpolate(copy.form.s4ProductNew, { master: masterName })})`
    : `${bundleProduct?.name ?? copy.form.readbackNoProduct} (${copy.form.s4ProductExisting})`;

  const stepNames = BUNDLE_STEP_KEYS.map((key) => copy.form.stepNames[key]);
  const stepMeta = BUNDLE_STEP_KEYS.map((key) => copy.form.stepMeta[key]);

  const summary = (
    <BundleSummary
      name={bundleName}
      price={bundlePrice}
      currency={currency}
      rows={parsedRows}
      availability={availability}
      giftDocumentLine={giftDocumentLine}
    />
  );
  const summaryHeadline =
    availability.kind === 'known'
      ? interpolate(copy.form.summarySets, { n: availability.bundles })
      : copy.form.summaryUnknown;

  const panel = {
    components: (
      <BundleStepComponents
        form={form}
        components={components}
        rows={rows}
        parsedRows={parsedRows}
        readOnly={readOnly}
        limitedName={availability.kind === 'known' ? availability.limitedBy : null}
        showErrors={showErrors}
        onAdd={addComponent}
        blockedVariantIds={bundleProduct ? [bundleProduct.variantId] : []}
      />
    ),
    product: (
      <BundleStepProduct
        editing={editing}
        readOnly={readOnly}
        mode={mode}
        onModeChange={setMode}
        targets={targets.data}
        targetsFailed={targets.isError}
        draft={draft}
        onDraftChange={(patch) => {
          setDraft((current) => ({ ...current, ...patch }));
        }}
        parsedRows={parsedRows}
        currency={currency}
        bundleProduct={bundleProduct}
        onPickProduct={pickBundleProduct}
        onClearProduct={() => {
          setBundleProduct(null);
        }}
        excludeVariantIds={rows.map((row) => row.variantId)}
        showErrors={showErrors}
        createError={createError}
      />
    ),
    gifts: (
      <BundleStepGifts
        rows={rows}
        readOnly={readOnly}
        currency={currency}
        bundleName={bundleName}
        bundlePrice={bundlePrice}
        onFormChange={(variantId, documentForm) => {
          const index = rows.findIndex((row) => row.variantId === variantId);
          if (index >= 0) {
            form.setValue(`components.${index}.documentForm`, documentForm, { shouldDirty: true });
          }
        }}
        onBackToComponents={() => {
          setStep(0);
        }}
      />
    ),
    review: (
      <BundleStepReview
        name={bundleName}
        price={bundlePrice}
        currency={currency}
        rows={parsedRows}
        availability={availability}
        productLine={productLine}
        giftLine={giftLine}
        creating={creating}
        masterName={masterName}
        onGoTo={(key) => {
          setStep(BUNDLE_STEP_KEYS.indexOf(key));
        }}
        saved={
          savedAs !== null && (savedAs.productId !== '' || detail.data?.productId)
            ? {
                productId: savedAs.productId || (detail.data?.productId ?? ''),
                variantId: savedAs.variantId,
              }
            : null
        }
      />
    ),
  }[stepKey];

  if (editing && detail.isLoading) {
    return (
      <div
        className="bf-skeleton bf-skeleton--page"
        role="status"
        aria-live="polite"
        data-testid="bundle-form-loading"
      >
        <span className="sr-only">{copy.form.loading}</span>
        <span className="bf-skeleton__row bf-skeleton__row--bar" aria-hidden="true" />
        <span className="bf-skeleton__row bf-skeleton__row--card" aria-hidden="true" />
        <span className="bf-skeleton__row bf-skeleton__row--card" aria-hidden="true" />
      </div>
    );
  }
  if (editing && detail.isError) {
    return (
      <BundleLoadError
        testId="bundle-form-load-error"
        onRetry={() => {
          void detail.refetch();
        }}
      />
    );
  }
  if (!editing && sessionReady && !write.visible) {
    // Nothing on this form can be done by this role, so say so instead of
    // showing four steps of disabled controls.
    return (
      <div className="bundle-form screen">
        <Alert
          tone="info"
          title={copy.form.viewOnlyCreateTitle}
          data-testid="bundle-form-readonly-notice"
        >
          <p>{copy.form.viewOnlyCreateBody}</p>
          <p>
            <Link className="button button--secondary button--sm" to="/products?bundles=only">
              {copy.form.backToProducts}
            </Link>
          </p>
        </Alert>
      </div>
    );
  }

  const savedProductId = savedAs !== null ? savedAs.productId || (detail.data?.productId ?? '') : '';
  const offerMarketplaces = (connections.data ?? []).filter(
    (c) => c.status === 'active' && c.enabledCapabilities.includes('OfferManager')
  );
  const offerParams = new URLSearchParams({
    productIds: savedProductId,
    variantIds: savedAs?.variantId ?? '',
    // One marketplace left no choice to make, so the wizard opens on it.
    ...(offerMarketplaces.length === 1 && offerMarketplaces[0] !== undefined
      ? { connectionId: offerMarketplaces[0].id }
      : {}),
  });
  const partialPending = createdProduct !== null && savedAs === null && !save.isPending;
  const needsFix = shakeKey > 0 && missingFor(lastStep ? 'review' : stepKey).length > 0;
  const nextBlocked = !stepValid[stepKey];

  return (
    <BundleGuide defaultOpen={stepKey === 'product' ? 'new' : stepKey === 'gifts' ? 'gift' : stepKey === 'components' ? 'kind' : 'what'}>
      <div className="bundle-form screen" data-testid="bundle-form">
        <BundleLeaveGuard active={guardActive} released={released} />
        <a
          className="bf-skip"
          href="#bf-step-heading"
          onClick={(event) => {
            event.preventDefault();
            headingRef.current?.focus();
          }}
        >
          {copy.form.skipToStep}
        </a>
        <p className="sr-only" role="status" aria-live="polite" data-testid="bundle-form-step-announce">
          {announcement}
        </p>
        {needsFix ? (
          <p className="sr-only" role="alert" key={shakeKey}>
            {interpolate(copy.form.fixPrompt, {
              missing: missingFor(lastStep ? 'review' : stepKey).join(', '),
            })}
          </p>
        ) : null}
        <div className="page-section pm-reveal">
          <header className="page-header page-header--split">
            <div className="page-header__content">
              <Link to="/products?bundles=only" className="pm-back">
                <span aria-hidden="true">‹</span>
                {copy.form.backToProducts}
              </Link>
              <p className="eyebrow">{editing ? copy.form.editEyebrow : copy.form.eyebrow}</p>
              <h1 className="page-title" data-testid="bundle-form-title">
                {title}
              </h1>
              <p className="page-description">{editing ? copy.form.editIntro : copy.form.intro}</p>
            </div>
            <div className="page-header__actions">
              <BundleGuideButton />
              {editing && master !== null ? (
                <Button
                  tone="secondary"
                  data-testid="bundle-form-sync-from-master"
                  disabled={readOnly || syncFromMaster.isPending}
                  title={readOnly ? copy.form.viewOnlyReason : undefined}
                  onClick={runMasterSync}
                >
                  {syncFromMaster.isPending
                    ? copy.form.syncing
                    : interpolate(copy.form.syncFromMaster, { name: master.connectionName })}
                </Button>
              ) : null}
            </div>
          </header>

          {readOnly ? (
            <Alert tone="info" title={copy.list.readonlyTitle} data-testid="bundle-form-readonly-notice">
              {copy.form.viewOnlyReason}
            </Alert>
          ) : null}

          {saveError !== null || partialPending ? (
            <div ref={errorRef} tabIndex={-1} className="bf-focusbox">
              {saveError !== null ? (
                <Alert tone="error" title={copy.form.saveFailed} data-testid="bundle-form-save-error">
                  {saveError}
                </Alert>
              ) : null}
              {partialPending ? (
                <Alert tone="warning" data-testid="bundle-form-partial-warning">
                  {interpolate(copy.form.partialWarning, { name: createdProduct.name })}
                </Alert>
              ) : null}
            </div>
          ) : null}

          {savedAs !== null ? (
            <motion.div
              ref={savedRef}
              tabIndex={-1}
              className="cx-note cx-note--ok bf-saved"
              role="status"
              data-testid="bundle-form-saved-alert"
              initial={reduceMotion ? false : { opacity: 0, y: -10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={SNAPPY_SPRING}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M8 12.5l3 3 5-6" />
              </svg>
              <div>
                <p>
                  <b>{copy.form.saved}</b> {copy.form.savedLead}{' '}
                  {savedAs.available === null
                    ? copy.form.savedBodyUnknown
                    : interpolate(copy.form.savedBody, { n: savedAs.available })}
                </p>
                {savedAs.released > 0 ? (
                  <p data-testid="bundle-form-released-orders">
                    {formatPlural(savedAs.released, copy.form.releasedOrders, locale)}
                  </p>
                ) : null}
              </div>
              {savedProductId !== '' ? (
                <span className="cx-note__a">
                  <Link
                    className="button button--secondary button--sm"
                    to={`/products/${encodeURIComponent(savedProductId)}`}
                  >
                    {copy.form.seeBundle}
                  </Link>
                  <Link
                    className="button button--sm"
                    data-testid="bundle-form-list-offer"
                    to={`/listings/bulk-create/wizard?${offerParams.toString()}`}
                  >
                    {copy.form.listOffer}
                  </Link>
                </span>
              ) : null}
            </motion.div>
          ) : null}

          {nestedError !== null ? (
            <Alert tone="error" data-testid="bundle-form-nested-error">
              {nestedError}
            </Alert>
          ) : null}

          <SetupStepper
            steps={stepNames}
            stepMeta={stepMeta}
            currentStep={step}
            maxReachedStep={maxStep}
            completedSteps={new Set(BUNDLE_STEP_KEYS.flatMap((key, index) => (index < step && stepValid[key] ? [index] : [])))}
            onSelectStep={goTo}
            metaInline
            lockedHint={copy.form.stepLockedHint}
            attentionLabel={copy.form.stepNeedsAttention}
            attentionSteps={
              new Set(
                BUNDLE_STEP_KEYS.flatMap((key, index) =>
                  index < maxStep && index !== step && !stepValid[key] ? [index] : []
                )
              )
            }
            testId="bundle-form-stepper"
            className="bf-stepper"
          />
          {blockedNote !== null ? (
            <p className="bf-blockednote" role="status" data-testid="bundle-form-blocked-note">
              {blockedNote}
            </p>
          ) : null}
          {editing ? null : <p className="bf-draftnote">{copy.form.draftNote}</p>}

          <div className="bf-grid">
            <div className="bf-main">
              <div className="bf-card">
                <div className="bf-card__head">
                  <h2 className="bf-card__t" id="bf-step-heading" ref={headingRef} tabIndex={-1}>
                    <span className="pm-card__step">{String(step + 1).padStart(2, '0')}</span>
                    {stepNames[step]}
                  </h2>
                </div>
                <div className="bf-stage" ref={panelRef}>
                  <AnimatePresence mode="popLayout" initial={false} custom={direction}>
                    <motion.div
                      key={stepKey}
                      className="bf-panel"
                      data-testid={`bundle-form-step-${stepKey}`}
                      custom={direction}
                      variants={{
                        enter: (dir: number) => ({ opacity: 0, x: dir * 28 }),
                        center: { opacity: 1, x: 0 },
                        exit: (dir: number) => ({ opacity: 0, x: dir * -28 }),
                      }}
                      initial={reduceMotion ? false : 'enter'}
                      animate="center"
                      exit={reduceMotion ? 'center' : 'exit'}
                      transition={SNAPPY_SPRING}
                    >
                      {panel}
                    </motion.div>
                  </AnimatePresence>
                </div>
              </div>
              {editing ? (
                <div className="bf-card">
                  <div className="bf-card__head">
                    <h2 className="bf-card__t">{copy.form.historyTitle}</h2>
                    <span className="pm-card__aside pm-card__aside--plain">
                      {history.data
                        ? formatPlural(history.data.length, copy.form.versionsCount, locale)
                        : null}
                    </span>
                  </div>
                  <BundleHistory
                    entries={history.data}
                    isLoading={history.isLoading}
                    isError={history.isError}
                    onRetry={() => {
                      void history.refetch();
                    }}
                    currency={currency}
                  />
                </div>
              ) : null}
            </div>
            <aside className="bf-rail" aria-label={copy.form.summaryTitle}>
              <div className="bf-card">
                <div className="bf-card__head">
                  <h2 className="bf-card__t">{copy.form.summaryTitle}</h2>
                  <span className="pm-card__aside pm-card__aside--plain">{copy.form.liveAside}</span>
                </div>
                {summary}
              </div>
            </aside>
          </div>

          {editing && openOrders > 0 ? (
            <div className="cx-note cx-note--warn bf-impact" data-testid="bundle-form-open-orders-note">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v5M12 16v.5" />
              </svg>
              <p>
                <b>{copy.form.impactTitle}.</b> {copy.form.impactBody}{' '}
                {formatPlural(openOrders, copy.form.openOrdersNote, locale)}
              </p>
            </div>
          ) : null}
          <SidePanel
            open={summaryOpen}
            onOpenChange={setSummaryOpen}
            title={copy.form.summaryTitle}
            description={copy.form.summaryDescription}
            closeLabel={copy.form.summaryClose}
          >
            {summary}
          </SidePanel>

          <StickyActionBar
            aria-label={copy.form.actionsLabel}
            missingLabel={copy.form.missingLabel}
            missing={lastStep ? missing.join(' · ') : stepValid[stepKey] ? '' : stepMissing}
            readyText={
              lastStep
                ? `${copy.form.ready} ${formatPlural(rows.length, copy.form.componentsCount, locale)}, ${
                    availability.kind === 'known'
                      ? interpolate(copy.form.readyAvailable, { n: availability.bundles })
                      : copy.form.readyUnknown
                  }`
                : copy.form.ready
            }
            shaking={shakeKey > 0}
          >
            <button
              type="button"
              className="bf-summarychip"
              data-testid="bundle-form-summary-open"
              aria-haspopup="dialog"
              aria-expanded={summaryOpen}
              onClick={() => {
                setSummaryOpen(true);
              }}
            >
              <span className="bf-summarychip__l">{copy.form.summaryOpen}</span>
              <span className="bf-summarychip__r mono tabular">
                {summaryHeadline}
                {bundlePrice !== null ? ` · ${format.money(bundlePrice, currency)}` : ''}
              </span>
            </button>
            {step > 0 ? (
              <Button
                tone="secondary"
                className="button--sm"
                data-testid="bundle-form-back"
                onClick={() => {
                  setBlockedNote(null);
                  setStep(step - 1);
                }}
              >
                <span aria-hidden="true">← </span>
                {copy.form.back}
              </Button>
            ) : (
              <Link className="button button--secondary button--sm" to="/products?bundles=only">
                {copy.form.cancel}
              </Link>
            )}
            {!lastStep ? (
              <Button
                className={['button--sm', nextBlocked ? 'is-blocked' : ''].filter(Boolean).join(' ')}
                data-testid="bundle-form-next"
                aria-disabled={nextBlocked ? true : undefined}
                title={
                  nextBlocked
                    ? interpolate(copy.form.nextBlockedTitle, { missing: stepMissing })
                    : undefined
                }
                onClick={goNext}
              >
                {copy.form.next}
                <span aria-hidden="true"> →</span>
              </Button>
            ) : null}
            {readOnly ? (
              <span className="bf-viewonly" data-testid="bundle-form-view-only">
                {copy.form.viewOnlyNoSave}
              </span>
            ) : lastStep || editing ? (
              <SaveButton
                state={saveButtonState}
                labels={{
                  idle: editing ? copy.form.saveChanges : copy.form.save,
                  saving: copy.form.saving,
                  saved: copy.form.savedShort,
                }}
                disabled={saveBlocked || (editing && !dirty)}
                onClick={pressSave}
                data-testid="bundle-form-save"
              />
            ) : null}
          </StickyActionBar>
        </div>
      </div>
    </BundleGuide>
  );
}
