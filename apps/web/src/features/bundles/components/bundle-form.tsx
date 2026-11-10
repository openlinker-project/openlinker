/**
 * Bundle form (#3624, mockup M22)
 *
 * One screen, no wizard: the product that becomes the bundle, its components
 * with a quantity each, one availability line, the price split on demand, and
 * a History tab. A bundle is an ordinary product that also has components, so
 * the form never creates a product: it picks one and writes its composition.
 *
 * The price split, the availability and the open-order sentence are derived on
 * screen from what the operator has typed; nothing here is stored except the
 * composition (and the gift mark on a component).
 *
 * @module apps/web/src/features/bundles/components
 */
import { useMemo, useState, type ReactElement } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { useWriteAccess } from '../../../shared/auth/use-permission';
import { formatPlural, interpolate, useFormat, useLocale, useMessages } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { Input } from '../../../shared/ui/input';
import { ComposerSection } from '../../../shared/ui/composer-section';
import { ReadbackSentence } from '../../../shared/ui/readback-sentence';
import { SaveButton, useSaveButtonState } from '../../../shared/ui/save-button';
import { StickyActionBar } from '../../../shared/ui/sticky-action-bar';
import { useToast } from '../../../shared/ui/toast-provider';
import { useDemoMode } from '../../system';
import type { ApiError } from '../../../shared/api/api-error';
import { isBundleNestingReason } from '../api/bundles.types';
import { useBundleHistoryQuery, useBundleQuery } from '../hooks/use-bundle-queries';
import { useSyncBundleFromMasterMutation } from '../hooks/use-sync-bundle-from-master-mutation';
import { useSaveBundleMutation } from '../hooks/use-save-bundle-mutation';
import { computeBundleAvailability } from '../lib/bundle-availability';
import { toBundleChoice, type BundleProductChoice } from '../lib/bundle-choice';
import { splitBundlePrice } from '../lib/bundle-price-split';
import {
  GiftFormPickerValues,
  GiftDocumentFormCards,
  useGiftDocumentSettingsQuery,
  type GiftDocumentFormChoice,
} from '../../gift-documents';
import { BundleGuide, BundleGuideButton } from './bundle-guide';
import { BundleHistory } from './bundle-history';
import { BundleProductPicker } from './bundle-product-picker';

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

const quantitySchema = z.string().regex(/^[1-9]\d*$/);
const formSchema = z.object({
  components: z
    .array(
      z.object({
        variantId: z.string(),
        productId: z.string(),
        name: z.string(),
        sku: z.string().nullable(),
        price: z.number().nullable(),
        currency: z.string().nullable(),
        availableToPromise: z.number().nullable(),
        isBundle: z.boolean(),
        quantity: quantitySchema,
        gift: z.boolean(),
        documentForm: z.string(),
      })
    )
    .min(1),
});
type FormValues = z.infer<typeof formSchema>;

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
  const giftCopy = useMessages('gift-documents');
  const giftSettings = useGiftDocumentSettingsQuery();
  const { locale } = useLocale();
  const format = useFormat();
  const apiClient = useApiClient();
  const { showToast } = useToast();
  const demoMode = useDemoMode();
  const write = useWriteAccess('bundles:write', demoMode);
  const editing = bundleVariantId !== undefined;
  const navigate = useNavigate();
  const location = useLocation();
  // A create navigates to the edit route (so a second Save is an update) and
  // hands the result over, since the route change remounts this form.
  const handedOver = readHandedOverSave(location.state);

  const detail = useBundleQuery(bundleVariantId);
  const history = useBundleHistoryQuery(bundleVariantId, editing);
  const [showErrors, setShowErrors] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);
  const [savedCount, setSavedCount] = useState(0);
  const save = useSaveBundleMutation();
  const saveButtonState = useSaveButtonState(save.isPending, savedCount);
  const syncFromMaster = useSyncBundleFromMasterMutation();

  const [bundleProduct, setBundleProduct] = useState<BundleProductChoice | null>(null);
  const [nestedError, setNestedError] = useState<string | null>(null);
  const [showSplit, setShowSplit] = useState(false);
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

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
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
  const currency = bundleProduct?.currency ?? rows[0]?.currency ?? undefined;
  const parsedRows = useMemo(
    () =>
      rows.map((row) => ({
        ...row,
        qty: quantitySchema.safeParse(row.quantity).success ? Number(row.quantity) : 0,
      })),
    [rows]
  );

  const availability = computeBundleAvailability(
    parsedRows
      .filter((row) => row.qty > 0)
      .map((row) => ({
        name: row.name,
        quantity: row.qty,
        availableToPromise: row.availableToPromise,
      }))
  );
  const split = splitBundlePrice(
    bundleProduct?.price ?? null,
    parsedRows.map((row) => ({
      variantId: row.variantId,
      quantity: Math.max(row.qty, 1),
      standalonePrice: row.price,
      giftSlot: row.gift,
    }))
  );

  const readOnly = !write.canWrite;
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
    components.append({ ...choice, quantity: '1', gift: false, documentForm: '' });
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

  const submit = form.handleSubmit((values) => {
    if (!bundleProduct) return;
    save.mutate(
      {
        variantId: bundleProduct.variantId,
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
          const available = availability.kind === 'known' ? availability.bundles : null;
          showToast({ tone: 'success', description: copy.form.saved });
          setSavedAs({
            available,
            released: result.releasedOrders,
            productId: bundleProduct.productId,
            variantId: bundleProduct.variantId,
          });
          if (!editing) {
            // Now an existing bundle: the next Save must be an update, not a
            // second create that answers 409.
            void navigate(`/products/bundles/${encodeURIComponent(bundleProduct.variantId)}`, {
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
                  ? interpolate(copy.form.nestedVariantIsComponent, { name: bundleProduct.name })
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
  });

  if (editing && detail.isLoading) {
    return <p className="text-muted">{copy.form.loading}</p>;
  }
  if (editing && detail.isError) {
    return (
      <Alert tone="error" title={copy.form.loadFailed}>
        {copy.form.loadFailed}
      </Alert>
    );
  }

  const missing: string[] = [];
  if (bundleProduct === null) missing.push(copy.form.missingProduct);
  if (rows.length === 0) missing.push(copy.form.missingComponent);
  else if (parsedRows.some((row) => row.qty === 0)) missing.push(copy.form.missingQuantities);
  const ready = missing.length === 0;
  const saveBlocked = readOnly || save.isPending;
  const unknownReason =
    availability.kind === 'unknown' && availability.component !== null
      ? interpolate(copy.form.availabilityUnknown, { name: availability.component })
      : copy.form.availabilityUnknownGeneric;
  const openOrders = detail.data?.openOrdersOnOlderComposition ?? 0;

  const pressSave = (): void => {
    if (!ready) {
      setShowErrors(true);
      setShakeKey((key) => key + 1);
      return;
    }
    void submit();
  };

  // Component rows, as the readback sentence and the availability bars use them.
  const valid = parsedRows.filter((row) => row.qty > 0);
  const tailText =
    availability.kind === 'known'
      ? availability.limitedBy === null
        ? interpolate(copy.form.readbackTail, { n: availability.bundles })
        : interpolate(copy.form.readbackTailLimited, {
            n: availability.bundles,
            name: availability.limitedBy,
          })
      : availability.kind === 'unknown'
        ? copy.form.readbackUnknown
        : '';
  const supported = valid
    .filter((row) => row.availableToPromise !== null)
    .map((row) => ({
      key: row.variantId,
      name: row.name,
      sets: Math.floor((row.availableToPromise ?? 0) / row.qty),
    }));
  const barMax = Math.max(1, ...supported.map((entry) => entry.sets));
  const limitedName = availability.kind === 'known' ? availability.limitedBy : null;

  return (
    <BundleGuide>
      <div className="bundle-form screen" data-testid="bundle-form">
        <div className="page-section pm-reveal">
          <header className="page-header page-header--split">
            <div className="page-header__content">
              <Link to="/products?bundles=only" className="pm-back">
                <span aria-hidden="true">‹</span>
                {copy.form.backToProducts}
              </Link>
              <p className="eyebrow">{copy.form.eyebrow}</p>
              <h1 className="page-title" data-testid="bundle-form-title">
                {title}
              </h1>
              <p className="page-description">{copy.form.intro}</p>
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
            <Alert
              tone="info"
              title={copy.list.readonlyTitle}
              data-testid="bundle-form-readonly-notice"
            >
              {copy.form.viewOnlyReason}
            </Alert>
          ) : null}

          {saveError !== null ? (
            <Alert tone="error" title={copy.form.saveFailed} data-testid="bundle-form-save-error">
              {saveError}
            </Alert>
          ) : null}

          {savedAs !== null ? (
            <div
              className="cx-note cx-note--ok"
              role="status"
              data-testid="bundle-form-saved-alert"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M8 12.5l3 3 5-6" />
              </svg>
              <div>
                <p>
                  <b>{copy.form.saved}</b>{' '}
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
              {savedAs.productId || detail.data?.productId ? (
                <span className="cx-note__a">
                  <Link
                    className="button button--secondary button--sm"
                    to={`/products/${encodeURIComponent(savedAs.productId || (detail.data?.productId ?? ''))}`}
                  >
                    {copy.form.seeBundle}
                  </Link>
                  <Link
                    className="button button--sm"
                    data-testid="bundle-form-list-offer"
                    to={`/listings/bulk-create/wizard?${new URLSearchParams({
                      productIds: savedAs.productId || (detail.data?.productId ?? ''),
                      variantIds: savedAs.variantId,
                    }).toString()}`}
                  >
                    {copy.form.listOffer}
                  </Link>
                </span>
              ) : null}
            </div>
          ) : null}

          <div className="pm-grid">
            <div className="pm-col">
              <ComposerSection
                step="01"
                title={copy.form.productSection}
                aside={copy.form.productAside}
                riseIndex={2}
              >
                <p className="pm-help">{copy.form.bundleProductHelp}</p>
                {bundleProduct === null ? (
                  <div style={{ position: 'relative' }}>
                    <div className={`pm-picker is-empty${showErrors ? ' is-invalid' : ''}`}>
                      <span className="pm-picker__e">
                        <span className="pm-thumb pm-thumb--lg" aria-hidden="true">
                          <svg className="pm-ico" viewBox="0 0 24 24">
                            <path d="M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8" />
                          </svg>
                        </span>
                        <span>
                          <span className="pm-picker__n">{copy.form.noProduct}</span>
                          <br />
                          <span className="pm-picker__s">{copy.form.noProductHint}</span>
                        </span>
                        <button
                          type="button"
                          className="button button--secondary button--sm"
                          aria-expanded={pickerOpen}
                          disabled={readOnly}
                          onClick={() => {
                            setPickerOpen((open) => !open);
                          }}
                        >
                          {copy.form.pickProduct}
                        </button>
                      </span>
                    </div>
                    {showErrors ? <p className="pm-err">{copy.form.noProductHint}</p> : null}
                    {pickerOpen || readOnly ? (
                      <div
                        className="dropdown-menu__content cx-plist"
                        style={{
                          position: 'static',
                          maxWidth: 'none',
                          marginTop: 'var(--space-2)',
                        }}
                      >
                        <BundleProductPicker
                          label={copy.form.pickProduct}
                          placeholder={copy.form.searchProduct}
                          disabled={readOnly}
                          excludeVariantIds={rows.map((row) => row.variantId)}
                          onPick={(choice) => {
                            pickBundleProduct(choice);
                            setPickerOpen(false);
                          }}
                          testIdPrefix="bundle-form-product-search"
                        />
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="pm-picker">
                    <span className="pm-picker__f">
                      <span className="cx-mosaic cx-mosaic--lg" aria-hidden="true">
                        <i className="t-a" />
                        <i className="t-d" />
                        <i className="t-b" />
                        <i className="t-c" />
                      </span>
                      <span>
                        <span className="pm-picker__n" data-testid="bundle-form-name">
                          {bundleProduct.name}
                        </span>
                        <br />
                        <span className="pm-picker__s">
                          <span data-testid="bundle-form-sku">{bundleProduct.sku ?? ''}</span>
                          {bundleProduct.price !== null
                            ? ` · ${copy.form.price.toLowerCase()} ${format.money(bundleProduct.price, currency)}`
                            : ''}
                        </span>
                      </span>
                      {!editing ? (
                        <Button
                          tone="secondary"
                          className="button--sm"
                          disabled={readOnly}
                          onClick={() => {
                            setBundleProduct(null);
                            setPickerOpen(true);
                          }}
                        >
                          {copy.form.changeProduct}
                        </Button>
                      ) : (
                        <span />
                      )}
                    </span>
                  </div>
                )}
                <span hidden data-testid="bundle-form-price">
                  {bundleProduct?.price === null || bundleProduct === null
                    ? ''
                    : format.money(bundleProduct.price, currency)}
                </span>
              </ComposerSection>

              <ComposerSection
                step="02"
                title={copy.form.componentsSection}
                aside={formatPlural(rows.length, copy.form.componentsCount, locale)}
                riseIndex={3}
              >
                <div className="form-field pm-combo">
                  <BundleProductPicker
                    label={copy.form.addComponent}
                    placeholder={copy.form.searchComponent}
                    disabled={readOnly}
                    excludeVariantIds={rows.map((row) => row.variantId)}
                    onPick={addComponent}
                    testIdPrefix="bundle-form-component-search"
                  />
                </div>
                {nestedError !== null ? (
                  <Alert tone="error" data-testid="bundle-form-nested-error">
                    {nestedError}
                  </Alert>
                ) : null}

                <ul className="cx-rows" data-testid="bundle-form-components">
                  {components.fields.map((field, index) => {
                    const row = rows[index];
                    const parsed = parsedRows[index];
                    const key = row?.sku ?? row?.variantId ?? field.id;
                    const invalidQuantity =
                      form.formState.errors.components?.[index]?.quantity !== undefined;
                    const isLimiting = limitedName !== null && row?.name === limitedName;
                    const sets =
                      parsed &&
                      parsed.qty > 0 &&
                      row?.availableToPromise !== null &&
                      row !== undefined
                        ? Math.floor((row.availableToPromise ?? 0) / parsed.qty)
                        : null;
                    return (
                      <li
                        key={field.id}
                        className={`cx-row${row?.gift ? ' is-gift' : ''}${isLimiting ? ' is-lim' : ''}${
                          invalidQuantity ? ' is-invalid' : ''
                        }`}
                        data-testid={`bundle-form-component-row-${key}`}
                      >
                        <div className="cx-row__m">
                          <span className="cx-ord">
                            <button
                              type="button"
                              className="pm-mv"
                              disabled={readOnly || index === 0}
                              aria-label={interpolate(copy.form.moveUp, { name: row?.name ?? '' })}
                              onClick={() => {
                                components.move(index, index - 1);
                              }}
                            >
                              <svg viewBox="0 0 12 12" aria-hidden="true">
                                <path d="M2.5 7.5 6 4l3.5 3.5" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              className="pm-mv"
                              disabled={readOnly || index === components.fields.length - 1}
                              aria-label={interpolate(copy.form.moveDown, {
                                name: row?.name ?? '',
                              })}
                              onClick={() => {
                                components.move(index, index + 1);
                              }}
                            >
                              <svg viewBox="0 0 12 12" aria-hidden="true">
                                <path d="M2.5 4.5 6 8l3.5-3.5" />
                              </svg>
                            </button>
                          </span>
                          <span className="pm-thumb pm-thumb--a" aria-hidden="true">
                            <svg className="pm-ico" viewBox="0 0 24 24">
                              <path d="M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8" />
                            </svg>
                          </span>
                          <span className="cx-row__n">
                            <span style={{ fontWeight: 600, fontSize: '.8125rem' }}>
                              {row?.name}
                            </span>
                            <span
                              className="cx-sub mono"
                              data-testid={`bundle-form-component-sku-${key}`}
                            >
                              {row?.sku ?? ''}
                            </span>
                            <span className="cx-row__av">
                              {row?.availableToPromise === null || row === undefined ? (
                                copy.form.stockUnknown
                              ) : (
                                <>
                                  <b>{interpolate(copy.form.pcs, { n: row.availableToPromise })}</b>
                                  {sets !== null ? (
                                    <>
                                      {' · '}
                                      {interpolate(copy.form.enoughFor, { n: sets })}
                                    </>
                                  ) : null}
                                </>
                              )}
                              {isLimiting ? (
                                <>
                                  {' · '}
                                  <b>{copy.form.limits}</b>
                                </>
                              ) : null}
                            </span>
                          </span>
                          <span className="cx-qty">
                            <span>×</span>
                            <Input
                              type="number"
                              min={1}
                              step={1}
                              inputMode="numeric"
                              aria-label={interpolate(copy.form.componentQuantity, {
                                name: row?.name ?? '',
                              })}
                              data-testid={`bundle-form-component-qty-${key}`}
                              disabled={readOnly}
                              invalid={invalidQuantity}
                              {...form.register(`components.${index}.quantity`)}
                            />
                          </span>
                          <span className="cx-row__t">
                            <label className="ol-toggle">
                              <input
                                type="checkbox"
                                checked={row?.gift ?? false}
                                disabled={readOnly}
                                data-testid={`bundle-form-component-toggle-gift-${key}`}
                                aria-label={interpolate(copy.form.markGiftFor, {
                                  name: row?.name ?? '',
                                })}
                                onChange={(event) => {
                                  form.setValue(`components.${index}.gift`, event.target.checked, {
                                    shouldDirty: true,
                                  });
                                }}
                              />
                              <span>{copy.form.gift}</span>
                            </label>
                            <Button
                              tone="ghost"
                              className="button--sm"
                              disabled={readOnly}
                              title={readOnly ? copy.form.viewOnlyReason : undefined}
                              aria-label={interpolate(copy.form.removeFor, {
                                name: row?.name ?? '',
                              })}
                              data-testid={`bundle-form-component-remove-${key}`}
                              onClick={() => {
                                components.remove(index);
                              }}
                            >
                              {copy.form.remove}
                            </Button>
                          </span>
                        </div>
                        {row?.gift ? (
                          <>
                            <span hidden data-testid={`bundle-form-component-gift-${key}`} />
                            <div className="cx-gift" style={{ gridTemplateRows: '1fr' }}>
                              <div>
                                <div className="cx-gift__in" style={{ opacity: 1 }}>
                                  <div className="cx-gift__h">
                                    <b>{copy.form.giftOnDocument}</b>
                                    <span>{copy.form.giftDefault}</span>
                                  </div>
                                  <GiftDocumentFormCards
                                    name={`gift-form-${key}`}
                                    aria-label={giftCopy.perGift.label}
                                    value={isGiftDocumentFormChoice(row.documentForm) ? row.documentForm : 'inherit'}
                                    onChange={(next) => {
                                      form.setValue(
                                        `components.${index}.documentForm`,
                                        next === 'inherit' ? '' : next,
                                        { shouldDirty: true }
                                      );
                                    }}
                                    customPrice=""
                                    onCustomPriceChange={() => undefined}
                                    withInherit
                                    forms={
                                      row.documentForm === 'omit'
                                        ? ['priced-in', 'technical-cent', 'show-zero', 'omit']
                                        : ['priced-in', 'technical-cent', 'show-zero']
                                    }
                                    inheritedForm={giftSettings.data?.giftDocumentForm ?? null}
                                    disabled={readOnly}
                                  />
                                  <p className="cx-gift__f">
                                    {copy.form.giftDecision}{' '}
                                    <Link to="/settings/sales-documents">
                                      {copy.form.giftSettingsLink}
                                    </Link>
                                  </p>
                                </div>
                              </div>
                            </div>
                          </>
                        ) : null}
                        <p className="pm-err">{copy.form.quantityInvalid}</p>
                      </li>
                    );
                  })}
                </ul>
                {rows.length === 0 ? (
                  <div className="cx-empty">
                    <p className="pm-empty__t">{copy.form.emptyTitle}</p>
                    <p className="pm-empty__d">{copy.form.emptyComponents}</p>
                  </div>
                ) : null}
                {showErrors && rows.length === 0 ? (
                  <p className="pm-err" style={{ display: 'block' }}>
                    {copy.form.emptyComponents}
                  </p>
                ) : null}
                {form.formState.errors.components !== undefined && rows.length > 0 ? (
                  <p className="form-field__error" role="alert">
                    {copy.form.quantityInvalid}
                  </p>
                ) : null}

                <div className="pm-disc">
                  <button
                    type="button"
                    className="pm-disc__btn"
                    aria-expanded={showSplit}
                    onClick={() => {
                      setShowSplit((value) => !value);
                    }}
                  >
                    <span className="pm-disc__caret" aria-hidden="true" />
                    <span>{showSplit ? copy.form.priceSplitHide : copy.form.priceSplitShow}</span>
                    <span className="pm-disc__sum">{copy.form.priceSplitInfoOnly}</span>
                  </button>
                  <div className={`pm-disc__body${showSplit ? ' is-open' : ''}`}>
                    <div>
                      <div
                        className="pm-disc__inner"
                        data-testid={showSplit ? 'bundle-form-price-split' : undefined}
                      >
                        {showSplit ? (
                          <>
                            <p className="pm-help">{copy.form.priceSplitIntro}</p>
                            {split.kind === 'ok' ? (
                              <div className="pm-doc">
                                {split.lines.map((line) => {
                                  const row = rows.find((r) => r.variantId === line.variantId);
                                  return (
                                    <span
                                      key={line.variantId}
                                      className={`pm-doc__l${row?.gift ? ' is-gift' : ''}`}
                                      data-testid={`bundle-form-price-split-line-${row?.sku ?? line.variantId}`}
                                    >
                                      {interpolate(copy.form.priceSplitLine, {
                                        name: row?.name ?? line.variantId,
                                        amount: format.money(line.amount, currency),
                                      })}
                                    </span>
                                  );
                                })}
                              </div>
                            ) : split.kind === 'unknown-component-price' ? (
                              <Alert tone="warning" data-testid="bundle-form-price-share-alert">
                                {interpolate(copy.form.priceSplitMissingPrice, {
                                  name:
                                    rows.find((r) => r.variantId === split.variantIds[0])?.name ??
                                    split.variantIds[0],
                                })}
                              </Alert>
                            ) : split.kind === 'no-paid-component' ? (
                              <p className="pm-help">{copy.form.priceSplitNoPaid}</p>
                            ) : (
                              <p className="pm-help">{copy.form.priceSplitNoPrice}</p>
                            )}
                          </>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              </ComposerSection>
            </div>

            <aside className="pm-col pm-rail">
              <ReadbackSentence
                eyebrow={copy.form.readbackEyebrow}
                name={bundleProduct?.name ?? copy.form.readbackNoProduct}
                data-testid="bundle-form-readback"
              >
                {valid.length === 0 ? (
                  copy.form.readbackEmpty
                ) : (
                  <>
                    {valid.map((row, index) => (
                      <span key={row.variantId}>
                        {index > 0
                          ? index === valid.length - 1
                            ? ` ${copy.form.and} `
                            : ', '
                          : ''}
                        <b>{row.name}</b> ×{row.qty}
                        {row.gift ? ` (${copy.form.giftLower})` : ''}
                      </span>
                    ))}{' '}
                    {copy.form.inOnePackage} {tailText}
                  </>
                )}
              </ReadbackSentence>

              <ComposerSection
                title={copy.form.availabilityTitle}
                aside={copy.form.liveAside}
                riseIndex={4}
              >
                <div
                  className={`cx-avail ${
                    availability.kind === 'known'
                      ? availability.bundles === 0
                        ? 'is-zero'
                        : 'is-warn'
                      : 'is-unk'
                  }`}
                  data-testid="bundle-form-availability"
                >
                  {availability.kind === 'known' ? (
                    <span>
                      <span className="cx-big mono tabular">
                        {availability.bundles} <small>{copy.form.bundlesWord}</small>
                      </span>
                      <br />
                      {availability.limitedBy === null
                        ? interpolate(copy.form.availabilityOk, { n: availability.bundles })
                        : interpolate(copy.form.availabilityLimited, {
                            n: availability.bundles,
                            name: availability.limitedBy,
                          })}
                    </span>
                  ) : availability.kind === 'unknown' ? (
                    <span>{unknownReason}</span>
                  ) : (
                    <span>{copy.form.availabilityEmpty}</span>
                  )}
                </div>
                <div className="cx-bars">
                  {supported.map((entry) => (
                    <div
                      key={entry.key}
                      className={`cx-bar${entry.name === limitedName ? ' is-lim' : ''}`}
                    >
                      <span>{entry.name}</span>
                      <b className="mono tabular">{entry.sets}</b>
                      <span className="pm-bar">
                        <i
                          style={{
                            width: `${String(Math.max(3, (100 * entry.sets) / barMax))}%`,
                            animation: 'none',
                          }}
                        />
                      </span>
                    </div>
                  ))}
                </div>
                <p className="pm-help">{copy.form.channelsGetNumber}</p>
              </ComposerSection>

              {editing ? (
                <ComposerSection
                  title={copy.form.historyTitle}
                  aside={
                    history.data
                      ? formatPlural(history.data.length, copy.form.versionsCount, locale)
                      : undefined
                  }
                  riseIndex={5}
                >
                  <BundleHistory
                    entries={history.data}
                    isLoading={history.isLoading}
                    isError={history.isError}
                    currency={currency}
                  />
                </ComposerSection>
              ) : null}
            </aside>
          </div>

          <StickyActionBar
            missingLabel={copy.form.missingLabel}
            missing={missing.join(' · ')}
            readyText={`${copy.form.ready} ${formatPlural(rows.length, copy.form.componentsCount, locale)}, ${
              availability.kind === 'known'
                ? interpolate(copy.form.readyAvailable, { n: availability.bundles })
                : copy.form.readyUnknown
            }`}
            shaking={shakeKey > 0}
          >
            {editing && openOrders > 0 ? (
              <span className="cx-opennote" data-testid="bundle-form-open-orders-note">
                {formatPlural(openOrders, copy.form.openOrdersNote, locale)}
              </span>
            ) : null}
            <Link className="button button--secondary button--sm" to="/products?bundles=only">
              {copy.form.cancel}
            </Link>
            <SaveButton
              state={saveButtonState}
              labels={{ idle: copy.form.save, saving: copy.form.saving, saved: copy.form.savedShort }}
              disabled={saveBlocked}
              title={readOnly ? copy.form.viewOnlyReason : undefined}
              onClick={pressSave}
              data-testid="bundle-form-save"
            />
          </StickyActionBar>
        </div>
      </div>
    </BundleGuide>
  );
}
