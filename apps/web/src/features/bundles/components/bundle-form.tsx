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
import { GiftDocumentFormField, GiftDocumentFormChoiceValues, type GiftDocumentFormChoice } from '../../gift-documents';
import { Button } from '../../../shared/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../shared/ui/dropdown-menu';
import { Input } from '../../../shared/ui/input';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../shared/ui/tabs';
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
import { BundleHistory } from './bundle-history';
import { BundleProductPicker } from './bundle-product-picker';

function isGiftDocumentFormChoice(value: string): value is GiftDocumentFormChoice {
  return (GiftDocumentFormChoiceValues as readonly string[]).includes(value);
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
      }),
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
  const giftDocumentsCopy = useMessages('gift-documents');
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
  const [tab, setTab] = useState<'composition' | 'history'>('composition');
  const history = useBundleHistoryQuery(bundleVariantId, tab === 'history');
  const save = useSaveBundleMutation();
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
      : null,
  );
  const [saveError, setSaveError] = useState<string | null>(null);

  const seed = useQuery({
    queryKey: ['bundles', 'seed-component', seedComponent?.variantId ?? seedComponent?.productId ?? ''],
    queryFn: async (): Promise<BundleProductChoice> => {
      const productId =
        seedComponent?.variantId !== undefined
          ? (await apiClient.products.getVariant(seedComponent.variantId)).productId
          : (seedComponent?.productId ?? '');
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
  const editSeedKey = editing && detail.data ? `edit:${detail.data.variantId}:${String(detail.data.version)}` : null;
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
    [rows],
  );

  const availability = computeBundleAvailability(
    parsedRows
      .filter((row) => row.qty > 0)
      .map((row) => ({ name: row.name, quantity: row.qty, availableToPromise: row.availableToPromise })),
  );
  const split = splitBundlePrice(
    bundleProduct?.price ?? null,
    parsedRows.map((row) => ({
      variantId: row.variantId,
      quantity: Math.max(row.qty, 1),
      standalonePrice: row.price,
      giftSlot: row.gift,
    })),
  );

  const readOnly = !write.canWrite;
  const title = editing
    ? (bundleProduct?.name ?? copy.form.editTitleFallback)
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
                  : copy.form.nestedGeneric,
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
                  : copy.form.saveFailed,
          );
        },
      },
    );
  });

  if (editing && detail.isLoading) {
    return <p className="text-muted">{copy.form.loading}</p>;
  }
  if (editing && detail.isError) {
    return <Alert tone="error" title={copy.form.loadFailed}>{copy.form.loadFailed}</Alert>;
  }

  const saveBlocked = readOnly || bundleProduct === null || rows.length === 0 || save.isPending;
  const unknownReason =
    availability.kind === 'unknown' && availability.component !== null
      ? interpolate(copy.form.availabilityUnknown, { name: availability.component })
      : copy.form.availabilityUnknownGeneric;

  return (
    <div className="bundle-form" data-testid="bundle-form">
      <div className="page-header page-header--split">
        <div className="page-header__content">
          <Link to="/products?bundles=only" className="back-link">
            {copy.form.backToProducts}
          </Link>
          <h2 className="page-title" data-testid="bundle-form-title">
            {title}
          </h2>
          <p className="page-description">{copy.form.intro}</p>
        </div>
        <div className="page-header__actions">
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
          <Button
            tone="primary"
            data-testid="bundle-form-save"
            disabled={saveBlocked}
            title={readOnly ? copy.form.viewOnlyReason : undefined}
            onClick={() => {
              void submit();
            }}
          >
            {save.isPending ? copy.form.saving : copy.form.save}
          </Button>
        </div>
      </div>

      {readOnly ? (
        <Alert tone="info" title={copy.list.readonlyTitle} data-testid="bundle-form-readonly-notice">
          {copy.form.viewOnlyReason}
        </Alert>
      ) : null}

      {saveError !== null ? (
        <Alert tone="error" title={copy.form.saveFailed} data-testid="bundle-form-save-error">
          {saveError}
        </Alert>
      ) : null}

      {savedAs !== null ? (
        <Alert tone="success" title={copy.form.saved} data-testid="bundle-form-saved-alert">
          <p>
            {savedAs.available === null
              ? copy.form.savedBodyUnknown
              : interpolate(copy.form.savedBody, { n: savedAs.available })}
          </p>
          {savedAs.released > 0 ? (
            <p data-testid="bundle-form-released-orders">
              {formatPlural(savedAs.released, copy.form.releasedOrders, locale)}
            </p>
          ) : null}
          {(savedAs.productId || detail.data?.productId) ? (
          <Link
            className="button button--secondary"
            data-testid="bundle-form-list-offer"
            to={`/listings/bulk-create/wizard?${new URLSearchParams({
              productIds: savedAs.productId || (detail.data?.productId ?? ''),
              variantIds: savedAs.variantId,
            }).toString()}`}
          >
            {copy.form.listOffer}
          </Link>
          ) : null}
        </Alert>
      ) : null}

      <Tabs
        value={tab}
        onValueChange={(value) => {
          setTab(value === 'history' ? 'history' : 'composition');
        }}
      >
        <TabsList aria-label={copy.form.composition}>
          <TabsTrigger value="composition" data-testid="bundle-form-tab-composition">
            {copy.form.composition}
          </TabsTrigger>
          {editing ? (
            <TabsTrigger value="history" data-testid="bundle-form-tab-history">
              {copy.form.history}
            </TabsTrigger>
          ) : null}
        </TabsList>

        <TabsContent value="composition">
          <section className="detail-card">
            <div className="detail-card__head">
              <h3 className="detail-card__title">{copy.form.productSection}</h3>
            </div>
            {bundleProduct === null ? (
              <BundleProductPicker
                label={copy.form.bundleProductHelp}
                placeholder={copy.form.searchProduct}
                disabled={readOnly}
                excludeVariantIds={rows.map((row) => row.variantId)}
                onPick={pickBundleProduct}
                testIdPrefix="bundle-form-product-search"
              />
            ) : null}
            <div className="mk-form-grid bundle-form__product-grid">
              <div className="form-field">
                <label className="form-field__label" htmlFor="bf-name">{copy.form.bundleName}</label>
                <Input id="bf-name" data-testid="bundle-form-name" readOnly value={bundleProduct?.name ?? ''} />
              </div>
              <div className="form-field">
                <label className="form-field__label" htmlFor="bf-sku">{copy.form.sku}</label>
                <Input id="bf-sku" data-testid="bundle-form-sku" readOnly value={bundleProduct?.sku ?? ''} />
              </div>
              <div className="form-field">
                <label className="form-field__label" htmlFor="bf-price">{copy.form.price}</label>
                <Input
                  id="bf-price"
                  data-testid="bundle-form-price"
                  readOnly
                  value={bundleProduct?.price === null || bundleProduct === null ? '' : format.money(bundleProduct.price, currency)}
                />
              </div>
            </div>
            {!editing && bundleProduct !== null ? (
              <Button tone="ghost" disabled={readOnly} onClick={() => { setBundleProduct(null); }}>
                {copy.form.changeProduct}
              </Button>
            ) : null}
          </section>

          <section className="detail-card">
            <div className="detail-card__head">
              <h3 className="detail-card__title">{copy.form.componentsSection}</h3>
            </div>
            <ul className="mk-complist" data-testid="bundle-form-components" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {components.fields.map((field, index) => {
                const row = rows[index];
                const key = row?.sku ?? row?.variantId ?? field.id;
                const invalidQuantity = form.formState.errors.components?.[index]?.quantity !== undefined;
                return (
                  <li
                    key={field.id}
                    className="bundle-component"
                    data-testid={`bundle-form-component-row-${key}`}
                    style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', padding: 'var(--space-2) 0' }}
                  >
                    <span style={{ flex: 1 }}>
                      {row?.name}{' '}
                      <span className="mono-text text-muted">{row?.sku ?? ''}</span>{' '}
                      {row?.gift ? (
                        <StatusBadge tone="success" compact data-testid={`bundle-form-component-gift-${key}`}>
                          {copy.form.gift}
                        </StatusBadge>
                      ) : null}
                      {row?.gift ? (
                        <span className="bundle-component__doc-form" style={{ display: 'block', marginTop: 'var(--space-1)' }}>
                          <label className="form-field__label" htmlFor={`bf-doc-form-${key}`}>
                            {giftDocumentsCopy.perGift.label}
                          </label>
                          <GiftDocumentFormField
                            id={`bf-doc-form-${key}`}
                            data-testid={`bundle-form-component-doc-form-${key}`}
                            value={isGiftDocumentFormChoice(row.documentForm) ? row.documentForm : ''}
                            disabled={readOnly}
                            onChange={(next) =>
                              form.setValue(`components.${index}.documentForm`, next, { shouldDirty: true })
                            }
                          />
                        </span>
                      ) : null}
                    </span>
                    <Input
                      type="number"
                      min={1}
                      step={1}
                      inputMode="numeric"
                      style={{ width: '5rem' }}
                      aria-label={interpolate(copy.form.componentQuantity, { name: row?.name ?? '' })}
                      data-testid={`bundle-form-component-qty-${key}`}
                      disabled={readOnly}
                      invalid={invalidQuantity}
                      {...form.register(`components.${index}.quantity`)}
                    />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          tone="ghost"
                          disabled={readOnly}
                          title={readOnly ? copy.form.viewOnlyReason : undefined}
                          aria-label={interpolate(copy.form.componentMenuLabel, { name: row?.name ?? '' })}
                          data-testid={`bundle-form-component-more-${key}`}
                        >
                          {copy.form.componentMenu}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent data-testid={`bundle-form-component-menu-${key}`}>
                        <DropdownMenuItem
                          data-testid={`bundle-form-component-toggle-gift-${key}`}
                          onSelect={() => {
                            form.setValue(`components.${index}.gift`, !row?.gift, { shouldDirty: true });
                          }}
                        >
                          {row?.gift ? copy.form.unmarkGift : copy.form.markGift}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          data-testid={`bundle-form-component-remove-${key}`}
                          onSelect={() => {
                            components.remove(index);
                          }}
                        >
                          {copy.form.remove}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </li>
                );
              })}
            </ul>
            {rows.length === 0 ? <p className="text-muted">{copy.form.emptyComponents}</p> : null}
            {form.formState.errors.components !== undefined && rows.length > 0 ? (
              <p className="form-field__error" role="alert">{copy.form.quantityInvalid}</p>
            ) : null}

            <div className="mk-add">
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

            <p className="mk-availability" data-testid="bundle-form-availability">
              {availability.kind === 'known'
                ? availability.limitedBy === null
                  ? interpolate(copy.form.availabilityOk, { n: availability.bundles })
                  : interpolate(copy.form.availabilityLimited, { n: availability.bundles, name: availability.limitedBy })
                : availability.kind === 'unknown'
                  ? unknownReason
                  : ''}
            </p>

            {editing && detail.data && detail.data.openOrdersOnOlderComposition > 0 ? (
              <p className="text-muted" data-testid="bundle-form-open-orders-note">
                {formatPlural(detail.data.openOrdersOnOlderComposition, copy.form.openOrdersNote, locale)}
              </p>
            ) : null}
          </section>

          <section className="detail-card">
            <Button
              tone="ghost"
              aria-expanded={showSplit}
              onClick={() => { setShowSplit((value) => !value); }}
            >
              {showSplit ? copy.form.priceSplitHide : copy.form.priceSplitShow}
            </Button>
            {showSplit ? (
              <div data-testid="bundle-form-price-split">
                <p className="text-muted">{copy.form.priceSplitIntro}</p>
                {split.kind === 'ok' ? (
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {split.lines.map((line) => {
                      const row = rows.find((r) => r.variantId === line.variantId);
                      return (
                        <li key={line.variantId} data-testid={`bundle-form-price-split-line-${row?.sku ?? line.variantId}`}>
                          {interpolate(copy.form.priceSplitLine, {
                            name: row?.name ?? line.variantId,
                            amount: format.money(line.amount, currency),
                          })}
                        </li>
                      );
                    })}
                  </ul>
                ) : split.kind === 'unknown-component-price' ? (
                  <Alert tone="warning" data-testid="bundle-form-price-share-alert">
                    {interpolate(copy.form.priceSplitMissingPrice, {
                      name:
                        rows.find((r) => r.variantId === split.variantIds[0])?.name ?? split.variantIds[0],
                    })}
                  </Alert>
                ) : split.kind === 'no-paid-component' ? (
                  <p className="text-muted">{copy.form.priceSplitNoPaid}</p>
                ) : (
                  <p className="text-muted">{copy.form.priceSplitNoPrice}</p>
                )}
              </div>
            ) : null}
          </section>
        </TabsContent>

        {editing ? (
          <TabsContent value="history">
            <BundleHistory
              entries={history.data}
              isLoading={history.isLoading}
              isError={history.isError}
              currency={currency}
            />
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}
