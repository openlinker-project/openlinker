/**
 * Bulk wizard Step 1 — Config (thin shell, #1096)
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
 * section's `isComplete`) — NOT `formState.isValid`, which is stale-until-touched.
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import { Suspense, useEffect, useMemo, useState, type ReactElement } from 'react';
import { useForm } from 'react-hook-form';

import { Alert, Button, FormField, Input, Select } from '../../../../shared/ui';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../shared/ui/tooltip';
import { BULK_AI_TOGGLE_REQUIRES_WRITE_MESSAGE } from '../../../../shared/config/demo-mode';
import { usePermission } from '../../../../shared/auth/use-permission';
import { useConnectionsQuery } from '../../../connections';
import type { Connection } from '../../../connections';
import { usePlatform, usePlatforms, type BulkConfigFormValues } from '../../../../shared/plugins';
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
}

const DEFAULT_CURRENCY = 'PLN';

function selectOfferManagerConnections(all: readonly Connection[]): Connection[] {
  return all
    // OfferCreator (not coarse OfferManager, #1498): a quantity-only
    // OfferManager (WooCommerce stock write-back) cannot create offers.
    .filter((c) => c.status === 'active' && c.supportedCapabilities?.includes('OfferCreator'))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
}

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
}: BulkConfigStepProps): ReactElement {
  const connectionsQuery = useConnectionsQuery();
  const platforms = usePlatforms();
  const offerManagerConnections = useMemo(
    () => selectOfferManagerConnections(connectionsQuery.data ?? []),
    [connectionsQuery.data],
  );

  const form = useForm<BulkConfigFormValues>({
    defaultValues: defaultFormValues(initial),
    mode: 'onChange',
  });

  const [connectionId, setConnectionId] = useState<string>(
    initial.connectionId ?? preselectedConnectionId ?? '',
  );

  // Auto-select the sole OfferManager connection (honors explicit preselect first).
  useEffect(() => {
    if (connectionId === '' && offerManagerConnections.length === 1) {
      setConnectionId(offerManagerConnections[0]!.id);
    }
  }, [offerManagerConnections, connectionId]);

  const connection = offerManagerConnections.find((c) => c.id === connectionId) ?? null;
  const platform = usePlatform(connection?.platformType);
  const section = platform?.bulkOfferConfigSection;

  const values = form.watch();
  const canGenerateDescription = usePermission('listings:write');

  // ---- shared-slice validity (explicit, deterministic — not formState.isValid) ----
  const markupValid =
    values.pricingMode !== 'markup' ||
    (/^-?\d+(\.\d+)?$/.test(values.markupPercent.trim()) &&
      Number(values.markupPercent) >= -100 &&
      Number(values.markupPercent) <= 500);
  const flatPriceValid =
    values.pricingMode !== 'flat' || /^\d+([.,]\d{1,2})?$/.test(values.flatPriceAmount.trim());
  const capValid =
    values.stockMode !== 'cap' ||
    (/^\d+$/.test(values.capValue.trim()) && Number(values.capValue) >= 1);
  const flatStockValid =
    values.stockMode !== 'flat' ||
    (/^\d+$/.test(values.flatStockValue.trim()) && Number(values.flatStockValue) >= 1);

  const sharedSliceValid = markupValid && flatPriceValid && capValid && flatStockValid;
  const sectionComplete = section ? section.isComplete(values) : true;
  const canProceed = connectionId !== '' && sharedSliceValid && sectionComplete;

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
  if (offerManagerConnections.length === 0) {
    return (
      <Alert tone="error">
        No active connections with offer-creation capability found. Add one from{' '}
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
          them — price, stock, and platform fields like dispatch time — per product in the
          next Review step (use <strong>Edit</strong> on a row).
        </p>
      </header>

      {offerManagerConnections.length > 1 ? (
        <FormField name="bulk-config-connection" label="Marketplace connection">
          <Select value={connectionId} onChange={(e) => setConnectionId(e.target.value)}>
            <option value="" disabled>
              Select a connection…
            </option>
            {offerManagerConnections.map((c) => {
              const label = platforms.find((p) => p.platformType === c.platformType)?.displayName;
              return (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {label ? ` (${label})` : ` (${c.platformType})`}
                </option>
              );
            })}
          </Select>
        </FormField>
      ) : (
        <Alert tone="info">
          Publishing as <strong>{offerManagerConnections[0]?.name}</strong>.
        </Alert>
      )}

      {/* Per-platform config section (Allegro: delivery policy + currency; Erli: dispatch time). */}
      {connection ? (
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
          <strong>Publish immediately</strong>
          <small style={{ display: 'block', color: 'var(--text-muted)' }}>
            Uncheck to create all offers as drafts.
          </small>
        </span>
      </label>

      {(() => {
        // Gated on `listings:write` (admin + operator), not demo mode — the
        // bulk-create endpoint is `@Roles('admin', 'operator')`-gated in
        // every environment, so a viewer session would otherwise see an
        // enabled toggle that 403s on submit, in both demo and production
        // alike. Lock it with an explanatory tooltip; the span wrap is
        // required because a disabled checkbox emits no pointer events.
        const locked = !canGenerateDescription;
        const field = (
          <label
            style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)' }}
            aria-disabled={locked}
          >
            <input
              type="checkbox"
              checked={locked ? false : values.generateDescription}
              disabled={locked}
              onChange={(e) => {
                if (locked) return;
                form.setValue('generateDescription', e.target.checked, { shouldDirty: true });
              }}
            />
            <span>
              <strong>
                {locked ? (
                  <span aria-hidden="true" style={{ marginRight: 'var(--space-1)' }}>
                    🔒
                  </span>
                ) : null}
                Generate AI descriptions by default
              </strong>
              <small style={{ display: 'block', color: 'var(--text-muted)' }}>
                {locked
                  ? BULK_AI_TOGGLE_REQUIRES_WRITE_MESSAGE
                  : 'Worker uses ContentSuggestionService per row. Per-row toggle in the edit modal overrides this.'}
              </small>
            </span>
          </label>
        );
        return locked ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0}>{field}</span>
            </TooltipTrigger>
            <TooltipContent>{BULK_AI_TOGGLE_REQUIRES_WRITE_MESSAGE}</TooltipContent>
          </Tooltip>
        ) : (
          field
        );
      })()}

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
