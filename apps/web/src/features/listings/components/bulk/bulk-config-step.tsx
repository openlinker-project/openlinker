/**
 * Bulk wizard Step 1 - Config (thin shell, #1096)
 *
 * Batch-wide settings applied to every row before review/edit. After #1096
 * this is a **thin, marketplace-agnostic shell**: it selects target
 * connections by the `OfferManager` capability (not a hardcoded
 * `platformType`), renders the SHARED fields (master-pull pricing + stock
 * policies, publish/AI toggles), and renders the resolved per-platform config
 * section (`usePlatform(connection.platformType).bulkOfferConfigSection`) for
 * the platform-specific fields (Allegro delivery policy + currency; Erli
 * dispatch time). No `platformType === '…'` branch lives here.
 *
 * Form state is one React Hook Form keyed by `BulkConfigFormValues`; the
 * platform section writes its fields under `platformParams.*`. "Proceed" is
 * gated on an explicit `canProceed` predicate (shared-slice validity AND the
 * section's `isComplete`) - NOT `formState.isValid`, which is stale-until-touched.
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import { Suspense, useEffect, useMemo, useState, type ReactElement } from 'react';
import { useForm } from 'react-hook-form';

import { Alert, Button, FormField, Input } from '../../../../shared/ui';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../shared/ui/tooltip';
import { ReadOnlyLock } from '../../../../shared/ui/read-only-lock';
import { DEMO_READ_ONLY_ACTION_MESSAGE } from '../../../../shared/config/demo-mode';
import { useWriteAccess } from '../../../../shared/auth/use-permission';
import { useDemoMode } from '../../../system';
import { useConnectionsQuery } from '../../../connections';
import { PublishDestinationRail } from '../publish-destination-rail';
import {
  publishDestinationKind,
  selectPublishDestinations,
  type PublishDestination,
} from '../../lib/publish-destinations';
import { usePlatform, type BulkConfigFormValues } from '../../../../shared/plugins';
import type {
  BulkWizardConfig,
  PricingPolicy,
  PricingPolicyMode,
  StockPolicy,
  StockPolicyMode,
} from './bulk-wizard.types';

interface BulkConfigStepProps {
  initial: Partial<BulkWizardConfig>;
  /** Connection preselected from the entry-point picker / URL (#1096). */
  preselectedConnectionId?: string;
  onProceed: (config: BulkWizardConfig) => void;
  onCancel: () => void;
  /**
   * Reports the live-selected connection id up so the wizard can branch its
   * step model by the destination's capability (#1829) - a `ProductPublisher`
   * shop runs Config -> Review, an `OfferCreator` marketplace keeps
   * Config -> Resolve -> Review. Fires on auto-select and manual change.
   */
  onConnectionChange?: (connectionId: string) => void;
}

const DEFAULT_CURRENCY = 'PLN';

function defaultFormValues(initial: Partial<BulkWizardConfig>): BulkConfigFormValues {
  return {
    pricingMode: initial.pricingPolicy?.mode ?? 'use-master',
    markupPercent:
      initial.pricingPolicy?.mode === 'markup' ? String(initial.pricingPolicy.percent) : '10',
    flatPriceAmount:
      initial.pricingPolicy?.mode === 'flat' ? String(initial.pricingPolicy.amount) : '',
    stockMode: initial.stockPolicy?.mode ?? 'use-master',
    capValue: initial.stockPolicy?.mode === 'cap' ? String(initial.stockPolicy.value) : '5',
    flatStockValue:
      initial.stockPolicy?.mode === 'flat' ? String(initial.stockPolicy.value) : '',
    publishImmediately: initial.publishImmediately ?? true,
    generateDescription: initial.generateDescription ?? false,
    currency: initial.currency ?? DEFAULT_CURRENCY,
    platformParams: initial.platformParams ?? {},
  };
}

export function BulkConfigStep({
  initial,
  preselectedConnectionId,
  onProceed,
  onCancel,
  onConnectionChange,
}: BulkConfigStepProps): ReactElement {
  const connectionsQuery = useConnectionsQuery();
  // Unified publish targets (#1828): offer marketplaces (OfferCreator) OR
  // online shops (ProductPublisher), capability-driven. Marketplaces render a
  // per-platform config section and gate Proceed on it; shops (#1829) skip the
  // section and the Resolve step entirely - see `isShop` / `canProceed` below.
  const destinations: PublishDestination[] = useMemo(
    () => selectPublishDestinations(connectionsQuery.data ?? []),
    [connectionsQuery.data],
  );
  const publishConnections = useMemo(() => destinations.map((d) => d.connection), [destinations]);

  const form = useForm<BulkConfigFormValues>({
    defaultValues: defaultFormValues(initial),
    mode: 'onChange',
  });

  const [connectionId, setConnectionId] = useState<string>(
    initial.connectionId ?? preselectedConnectionId ?? '',
  );

  // Auto-select the sole publish connection (honors explicit preselect first).
  useEffect(() => {
    if (connectionId === '' && publishConnections.length === 1) {
      setConnectionId(publishConnections[0]!.id);
    }
  }, [publishConnections, connectionId]);

  // Report the live selection up so the wizard can branch its step model by the
  // destination's capability (#1829).
  useEffect(() => {
    if (connectionId !== '') onConnectionChange?.(connectionId);
  }, [connectionId, onConnectionChange]);

  const connection = publishConnections.find((c) => c.id === connectionId) ?? null;
  // Capability-driven destination kind - never a platformType literal (#1829).
  const isShop = connection ? publishDestinationKind(connection) === 'shop' : false;
  const platform = usePlatform(connection?.platformType);
  // Shops carry no per-platform offer-config section (category/attributes/images
  // are resolved from the master product at publish time).
  const section = isShop ? undefined : platform?.bulkOfferConfigSection;

  const values = form.watch();
  const demoMode = useDemoMode();
  const generateDescriptionAccess = useWriteAccess('listings:write', demoMode);

  // ---- shared-slice validity (explicit, deterministic - not formState.isValid) ----
  const markupValid =
    values.pricingMode !== 'markup' ||
    (/^-?\d+(\.\d+)?$/.test(values.markupPercent.trim()) &&
      Number(values.markupPercent) >= -100 &&
      Number(values.markupPercent) <= 500);
  // The `> 0` floor mirrors `CreateOfferPriceDto.amount` (`@IsPositive()`),
  // which is validated per override-map value - a single `0` rejects the whole
  // batch with an opaque `price: invalid value` (#1934/F3). The `cap` and
  // `flat` stock predicates below already carry the same shape of floor.
  const flatPriceValid =
    values.pricingMode !== 'flat' ||
    (/^\d+([.,]\d{1,2})?$/.test(values.flatPriceAmount.trim()) &&
      Number(values.flatPriceAmount.trim().replace(',', '.')) > 0);
  const capValid =
    values.stockMode !== 'cap' ||
    (/^\d+$/.test(values.capValue.trim()) && Number(values.capValue) >= 1);
  const flatStockValid =
    values.stockMode !== 'flat' ||
    (/^\d+$/.test(values.flatStockValue.trim()) && Number(values.flatStockValue) >= 1);

  const sharedSliceValid = markupValid && flatPriceValid && capValid && flatStockValid;
  // Marketplaces must complete their per-platform config section before
  // Proceed; shops have no section (#1829) so the shared slice alone gates.
  // A marketplace with no registered `bulkOfferConfigSection` (today
  // impossible - Allegro and Erli both register one) must NOT permanently
  // block Proceed with no explanation - pre-epic behavior was `: true`
  // (nothing to complete = nothing blocking), matching #1096's original
  // fallback before the unified-publish rework inverted it.
  const sectionComplete = isShop ? true : section ? section.isComplete(values) : true;

  // The destination needs a master catalogue to read product data from, or the
  // builder throws `MASTER_CATALOG_NOT_CONFIGURED` for EVERY record (#1934/F4).
  // Nothing in the wizard used to read this, so a connection created via the
  // API - or one whose auto-select never fired because the operator has 0 or
  // 2+ candidate master shops - produced an all-green Review and a batch in
  // which 100% of children failed. Absent connection ⇒ not yet a problem;
  // the empty-connection case is already covered by `connectionId !== ''`.
  const masterCatalogConfigured =
    connection === null ||
    typeof connection.config?.masterCatalogConnectionId === 'string';

  const canProceed =
    connectionId !== '' && sharedSliceValid && sectionComplete && masterCatalogConfigured;

  function buildPricingPolicy(): PricingPolicy {
    if (values.pricingMode === 'markup') {
      return { mode: 'markup', percent: Number(values.markupPercent) };
    }
    if (values.pricingMode === 'flat') {
      return { mode: 'flat', amount: Number(values.flatPriceAmount.replace(',', '.')) };
    }
    return { mode: 'use-master' };
  }

  function buildStockPolicy(): StockPolicy {
    if (values.stockMode === 'cap') return { mode: 'cap', value: Number(values.capValue) };
    if (values.stockMode === 'flat') return { mode: 'flat', value: Number(values.flatStockValue) };
    return { mode: 'use-master' };
  }

  function handleProceed(): void {
    if (!canProceed || !connection) return;
    onProceed({
      connectionId: connection.id,
      currency: values.currency || DEFAULT_CURRENCY,
      pricingPolicy: buildPricingPolicy(),
      stockPolicy: buildStockPolicy(),
      publishImmediately: values.publishImmediately,
      generateDescription: values.generateDescription,
      platformParams: values.platformParams,
    });
  }

  if (connectionsQuery.isLoading) {
    return <Alert tone="info">Loading connections…</Alert>;
  }
  if (publishConnections.length === 0) {
    return (
      <Alert tone="error">
        No active publish destinations found. Add a marketplace or online-shop connection from{' '}
        <a href="/connections">Connections</a>.
      </Alert>
    );
  }

  const setPricingMode = (mode: PricingPolicyMode): void =>
    form.setValue('pricingMode', mode, { shouldDirty: true });
  const setStockMode = (mode: StockPolicyMode): void =>
    form.setValue('stockMode', mode, { shouldDirty: true });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <header>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, letterSpacing: 'var(--tracking-tight)' }}>
          Configure batch
        </h2>
        <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 13 }}>
          Batch-wide defaults applied to all selected products. You can fine-tune any of
          them - price, stock, and platform fields like dispatch time - per product in the
          next Review step (use <strong>Edit</strong> on a row).
        </p>
      </header>

      {publishConnections.length > 1 ? (
        // Same grouped, keyboard-accessible rail the picker modals use
        // (`OfferProductPickerModal` / `MarketplacePickerModal`) - the operator
        // sees one consistent destination-picking pattern across the whole
        // publish flow instead of a plain `<Select>` here.
        <div className="form-field">
          <label id="bulk-config-connection-label" className="form-field__label">
            Destination connection
          </label>
          <PublishDestinationRail
            destinations={destinations}
            selectedConnectionId={connectionId || null}
            onSelect={setConnectionId}
            labelledBy="bulk-config-connection-label"
          />
        </div>
      ) : (
        <Alert tone="info">
          Publishing as <strong>{publishConnections[0]?.name}</strong>.
        </Alert>
      )}

      {!masterCatalogConfigured && connection !== null ? (
        <Alert tone="error">
          <strong>{connection.name}</strong> has no master catalogue set, so nothing can read
          the product data these offers need - every offer in the batch would fail. Open the
          connection&apos;s settings and pick the shop that owns the catalogue, then come back.
        </Alert>
      ) : null}

      {/* Shops resolve category, attributes & images from the master product at
          publish time (#1829) - no per-platform section to configure. */}
      {connection && isShop ? (
        <div className="shop-publish-callout">
          Publishing to an online shop. Category placement, attributes &amp; images are resolved
          from the master product at publish time - only visibility, price, and stock policy below
          apply.
        </div>
      ) : null}

      {/* Per-platform config section (Allegro: delivery policy + currency; Erli: dispatch time). */}
      {connection && !isShop ? (
        section ? (
          <Suspense fallback={<Alert tone="info">Loading marketplace options…</Alert>}>
            <section.component connection={connection} form={form} />
          </Suspense>
        ) : (
          <Alert tone="warning">
            Bulk offer creation isn't configured for this marketplace yet.
          </Alert>
        )
      ) : null}

      <fieldset className="bulk-config__policy">
        <legend>Pricing policy</legend>
        <PolicyRadio
          name="bulk-pricing-mode"
          checked={values.pricingMode === 'use-master'}
          onChange={() => setPricingMode('use-master')}
          label="Use master price"
          hint="Each offer uses the product's own price. Rows without a master price are flagged."
        />
        <PolicyRadio
          name="bulk-pricing-mode"
          checked={values.pricingMode === 'markup'}
          onChange={() => setPricingMode('markup')}
          label="Markup on master price"
          hint="Apply a percentage to each master price (negative = discount)."
        >
          {values.pricingMode === 'markup' ? (
            <FormField name="bulk-config-markup" label="Markup %">
              <Input
                placeholder="10"
                value={values.markupPercent}
                onChange={(e) => form.setValue('markupPercent', e.target.value, { shouldDirty: true })}
                aria-invalid={!markupValid}
              />
            </FormField>
          ) : null}
        </PolicyRadio>
        <PolicyRadio
          name="bulk-pricing-mode"
          checked={values.pricingMode === 'flat'}
          onChange={() => setPricingMode('flat')}
          label="Flat price for all rows"
          hint={`Same price (in ${values.currency}) for every offer, ignoring master prices.`}
        >
          {values.pricingMode === 'flat' ? (
            <FormField name="bulk-config-flat-price" label={`Flat price (${values.currency})`}>
              <Input
                placeholder="79.00"
                value={values.flatPriceAmount}
                onChange={(e) =>
                  form.setValue('flatPriceAmount', e.target.value, { shouldDirty: true })
                }
                aria-invalid={!flatPriceValid}
              />
            </FormField>
          ) : null}
        </PolicyRadio>
      </fieldset>

      <fieldset className="bulk-config__policy">
        <legend>Stock policy</legend>
        <PolicyRadio
          name="bulk-stock-mode"
          checked={values.stockMode === 'use-master'}
          onChange={() => setStockMode('use-master')}
          label="Use master stock"
          hint="Each offer uses the product's available quantity. Zero-stock rows are flagged."
        />
        <PolicyRadio
          name="bulk-stock-mode"
          checked={values.stockMode === 'cap'}
          onChange={() => setStockMode('cap')}
          label="Cap master stock"
          hint="Use the master quantity, capped at N."
        >
          {values.stockMode === 'cap' ? (
            <FormField name="bulk-config-cap" label="Cap at">
              <Input
                type="number"
                min={1}
                value={values.capValue}
                onChange={(e) => form.setValue('capValue', e.target.value, { shouldDirty: true })}
                aria-invalid={!capValid}
              />
            </FormField>
          ) : null}
        </PolicyRadio>
        <PolicyRadio
          name="bulk-stock-mode"
          checked={values.stockMode === 'flat'}
          onChange={() => setStockMode('flat')}
          label="Flat stock for all rows"
          hint="Same quantity for every offer, ignoring master stock."
        >
          {values.stockMode === 'flat' ? (
            <FormField name="bulk-config-flat-stock" label="Stock">
              <Input
                type="number"
                min={1}
                value={values.flatStockValue}
                onChange={(e) =>
                  form.setValue('flatStockValue', e.target.value, { shouldDirty: true })
                }
                aria-invalid={!flatStockValid}
              />
            </FormField>
          ) : null}
        </PolicyRadio>
      </fieldset>

      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)' }}>
        <input
          type="checkbox"
          checked={values.publishImmediately}
          onChange={(e) => form.setValue('publishImmediately', e.target.checked, { shouldDirty: true })}
        />
        <span>
          <strong>Publish immediately</strong>{' '}
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="bulk-editor__infotip" role="img" aria-label="About publish immediately">
                &#9432;
              </span>
            </TooltipTrigger>
            <TooltipContent>
              Requests publication for every offer. The marketplace still decides: it can keep an
              offer as a draft if required parameters are missing or invalid on its side (common on
              Erli).
            </TooltipContent>
          </Tooltip>
          <small style={{ display: 'block', color: 'var(--text-muted)' }}>
            Uncheck to create all offers as drafts.
          </small>
        </span>
      </label>

      {generateDescriptionAccess.visible ? (
        // Direct-write-adjacent action (triggers an LLM completion per row via
        // the worker), so it follows the `useWriteAccess` + `ReadOnlyLock`
        // pattern (#1615/#1668): visible-but-disabled for a demo viewer,
        // hidden entirely for a genuinely unauthorized non-demo session. The
        // bulk-create endpoint is `@Roles('admin', 'operator')`-gated in
        // every environment, so a session without `listings:write` could
        // never actually have this take effect even if it slipped through.
        <ReadOnlyLock
          active={generateDescriptionAccess.demoReadOnly}
          message={DEMO_READ_ONLY_ACTION_MESSAGE}
        >
          <label
            style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)' }}
            aria-disabled={generateDescriptionAccess.demoReadOnly}
          >
            <input
              type="checkbox"
              checked={generateDescriptionAccess.demoReadOnly ? false : values.generateDescription}
              disabled={generateDescriptionAccess.demoReadOnly}
              onChange={(e) => {
                if (generateDescriptionAccess.demoReadOnly) return;
                form.setValue('generateDescription', e.target.checked, { shouldDirty: true });
              }}
            />
            <span>
              <strong>
                {generateDescriptionAccess.demoReadOnly ? (
                  <span aria-hidden="true" style={{ marginRight: 'var(--space-1)' }}>
                    🔒
                  </span>
                ) : null}
                Generate AI descriptions by default
              </strong>
              <small style={{ display: 'block', color: 'var(--text-muted)' }}>
                {generateDescriptionAccess.demoReadOnly
                  ? DEMO_READ_ONLY_ACTION_MESSAGE
                  : 'Worker uses ContentSuggestionService per row. Per-row toggle in the edit modal overrides this.'}
              </small>
            </span>
          </label>
        </ReadOnlyLock>
      ) : null}

      <footer className="bulk-wizard__footer">
        <div className="bulk-wizard__footer-spacer" />
        <Button tone="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button tone="primary" disabled={!canProceed} onClick={handleProceed}>
          Proceed →
        </Button>
      </footer>
    </div>
  );
}

interface PolicyRadioProps {
  name: string;
  checked: boolean;
  onChange: () => void;
  label: string;
  hint: string;
  children?: ReactElement | null;
}

function PolicyRadio({
  name,
  checked,
  onChange,
  label,
  hint,
  children,
}: PolicyRadioProps): ReactElement {
  return (
    <div className="bulk-config__policy-option">
      <label className="bulk-config__policy-label">
        <input type="radio" name={name} checked={checked} onChange={onChange} />
        <span className="bulk-config__policy-text">
          <strong>{label}</strong>
          <small style={{ display: 'block', color: 'var(--text-muted)' }}>{hint}</small>
        </span>
      </label>
      {children ? <div className="bulk-config__policy-detail">{children}</div> : null}
    </div>
  );
}
