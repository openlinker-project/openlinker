/**
 * Bulk wizard Step 1 — Config
 *
 * Batch-wide settings applied to every row before review/edit: connection,
 * shipping/delivery policy, listing currency, and the master-pull pricing +
 * stock policies (#792 PR 3). Per-row values are computed from each product's
 * master price/stock via the policy; the operator overrides individual rows in
 * the next step.
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import { useEffect, useState, type ReactElement } from 'react';
import {
  Alert,
  Button,
  FormField,
  Input,
  Select,
} from '../../../../shared/ui';
import { useConnectionsQuery } from '../../../connections';
import type { Connection } from '../../../connections';
import { useSellerPoliciesQuery } from '../../hooks/use-seller-policies-query';
import type {
  BulkWizardConfig,
  PricingPolicy,
  PricingPolicyMode,
  StockPolicy,
  StockPolicyMode,
} from './bulk-wizard.types';

interface BulkConfigStepProps {
  initial: Partial<BulkWizardConfig>;
  onProceed: (config: BulkWizardConfig) => void;
  onCancel: () => void;
}

const DEFAULT_CURRENCY = 'PLN';
const CURRENCY_OPTIONS = ['PLN', 'EUR', 'USD'] as const;

export function BulkConfigStep({
  initial,
  onProceed,
  onCancel,
}: BulkConfigStepProps): ReactElement {
  const connectionsQuery = useConnectionsQuery({ platformType: 'allegro' });
  const allegroConnections: Connection[] = (connectionsQuery.data ?? []).filter(
    (c) => c.status === 'active' && c.supportedCapabilities?.includes('OfferManager'),
  );

  const [connectionId, setConnectionId] = useState<string>(initial.connectionId ?? '');

  // Auto-select the only available active connection.
  useEffect(() => {
    if (connectionId === '' && allegroConnections.length === 1) {
      setConnectionId(allegroConnections[0]!.id);
    }
  }, [allegroConnections, connectionId]);

  const policiesQuery = useSellerPoliciesQuery(connectionId);
  const deliveryPolicies = policiesQuery.data?.deliveryPolicies ?? [];

  const [deliveryPolicyId, setDeliveryPolicyId] = useState<string>(
    initial.deliveryPolicyId ?? '',
  );
  const [currency, setCurrency] = useState<string>(initial.currency ?? DEFAULT_CURRENCY);

  const [pricingMode, setPricingMode] = useState<PricingPolicyMode>(
    initial.pricingPolicy?.mode ?? 'use-master',
  );
  const [markupPercent, setMarkupPercent] = useState<string>(
    initial.pricingPolicy?.mode === 'markup' ? String(initial.pricingPolicy.percent) : '10',
  );
  const [flatPriceAmount, setFlatPriceAmount] = useState<string>(
    initial.pricingPolicy?.mode === 'flat' ? String(initial.pricingPolicy.amount) : '',
  );

  const [stockMode, setStockMode] = useState<StockPolicyMode>(
    initial.stockPolicy?.mode ?? 'use-master',
  );
  const [capValue, setCapValue] = useState<string>(
    initial.stockPolicy?.mode === 'cap' ? String(initial.stockPolicy.value) : '5',
  );
  const [flatStockValue, setFlatStockValue] = useState<string>(
    initial.stockPolicy?.mode === 'flat' ? String(initial.stockPolicy.value) : '',
  );

  const [publishImmediately, setPublishImmediately] = useState<boolean>(
    initial.publishImmediately ?? true,
  );
  const [generateDescription, setGenerateDescription] = useState<boolean>(
    initial.generateDescription ?? false,
  );

  // Reset deliveryPolicyId if the connection changes (different seller, different list).
  useEffect(() => {
    if (deliveryPolicyId && !deliveryPolicies.some((p) => p.id === deliveryPolicyId)) {
      setDeliveryPolicyId('');
    }
  }, [deliveryPolicyId, deliveryPolicies]);

  const markupValid =
    pricingMode !== 'markup' ||
    (/^-?\d+(\.\d+)?$/.test(markupPercent.trim()) &&
      Number(markupPercent) >= -100 &&
      Number(markupPercent) <= 500);
  const flatPriceValid =
    pricingMode !== 'flat' || /^\d+([.,]\d{1,2})?$/.test(flatPriceAmount.trim());
  const capValid =
    stockMode !== 'cap' || (/^\d+$/.test(capValue.trim()) && Number(capValue) >= 1);
  const flatStockValid =
    stockMode !== 'flat' || (/^\d+$/.test(flatStockValue.trim()) && Number(flatStockValue) >= 1);

  const canProceed =
    connectionId !== '' &&
    deliveryPolicyId !== '' &&
    markupValid &&
    flatPriceValid &&
    capValid &&
    flatStockValid;

  function buildPricingPolicy(): PricingPolicy {
    if (pricingMode === 'markup') return { mode: 'markup', percent: Number(markupPercent) };
    if (pricingMode === 'flat') {
      return { mode: 'flat', amount: Number(flatPriceAmount.replace(',', '.')) };
    }
    return { mode: 'use-master' };
  }

  function buildStockPolicy(): StockPolicy {
    if (stockMode === 'cap') return { mode: 'cap', value: Number(capValue) };
    if (stockMode === 'flat') return { mode: 'flat', value: Number(flatStockValue) };
    return { mode: 'use-master' };
  }

  function handleProceed(): void {
    if (!canProceed) return;
    onProceed({
      connectionId,
      deliveryPolicyId,
      currency,
      pricingPolicy: buildPricingPolicy(),
      stockPolicy: buildStockPolicy(),
      publishImmediately,
      generateDescription,
    });
  }

  if (connectionsQuery.isLoading) {
    return <Alert tone="info">Loading connections…</Alert>;
  }
  if (allegroConnections.length === 0) {
    return (
      <Alert tone="error">
        No active Allegro connections with offer-creation capability found. Add one from{' '}
        <a href="/connections">Connections</a>.
      </Alert>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <header>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, letterSpacing: 'var(--tracking-tight)' }}>
          Configure batch
        </h2>
        <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 13 }}>
          Batch-wide settings applied to all selected products. Per-row price and stock are
          pulled from each product's master data via the policies below; override individual
          rows in the next step.
        </p>
      </header>

      {allegroConnections.length > 1 ? (
        <FormField name="bulk-config-connection" label="Allegro connection">
          <Select value={connectionId} onChange={(e) => { setConnectionId(e.target.value); }}>
            <option value="" disabled>
              Select a connection…
            </option>
            {allegroConnections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </FormField>
      ) : (
        <Alert tone="info">
          Publishing as <strong>{allegroConnections[0]?.name}</strong>.
        </Alert>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--space-3)' }}>
        <FormField name="bulk-config-shipping" label="Shipping rate package">
          {policiesQuery.isLoading ? (
            <Input disabled value="Loading policies…" />
          ) : policiesQuery.error ? (
            <Alert tone="error">Could not load shipping policies for this connection.</Alert>
          ) : (
            <Select
              value={deliveryPolicyId}
              onChange={(e) => { setDeliveryPolicyId(e.target.value); }}
              disabled={deliveryPolicies.length === 0}
            >
              <option value="" disabled>
                Select a delivery package…
              </option>
              {deliveryPolicies.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          )}
            ))}
          </Select>
        )}
      </FormField>

      <div className="form-field-row form-field-row--cols-3">
        <FormField name="bulk-config-stock" label="Default stock">
          <Input
            type="number"
            min={0}
            value={defaultStock}
            onChange={(e) => { setDefaultStock(e.target.value); }}
            aria-invalid={!stockValid}
          />
        </FormField>
        <FormField
          name="bulk-config-price-amount"
          label="Default price (optional)"
          description="Used when a product has no price set."
        >
          <Input
            placeholder="79.00"
            value={defaultPriceAmount}
            onChange={(e) => { setDefaultPriceAmount(e.target.value); }}
            aria-invalid={!priceValid}
          />
        </FormField>
        <FormField name="bulk-config-currency" label="Currency">
          <Select value={currency} onChange={(e) => { setCurrency(e.target.value); }}>
            {CURRENCY_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </FormField>
      </div>

      <fieldset className="bulk-config__policy">
        <legend>Pricing policy</legend>
        <PolicyRadio
          name="bulk-pricing-mode"
          checked={pricingMode === 'use-master'}
          onChange={() => { setPricingMode('use-master'); }}
          label="Use master price"
          hint="Each offer uses the product's own price. Rows without a master price are flagged."
        />
        <PolicyRadio
          name="bulk-pricing-mode"
          checked={pricingMode === 'markup'}
          onChange={() => { setPricingMode('markup'); }}
          label="Markup on master price"
          hint="Apply a percentage to each master price (negative = discount)."
        >
          {pricingMode === 'markup' ? (
            <FormField name="bulk-config-markup" label="Markup %">
              <Input
                placeholder="10"
                value={markupPercent}
                onChange={(e) => { setMarkupPercent(e.target.value); }}
                aria-invalid={!markupValid}
              />
            </FormField>
          ) : null}
        </PolicyRadio>
        <PolicyRadio
          name="bulk-pricing-mode"
          checked={pricingMode === 'flat'}
          onChange={() => { setPricingMode('flat'); }}
          label="Flat price for all rows"
          hint={`Same price (in ${currency}) for every offer, ignoring master prices.`}
        >
          {pricingMode === 'flat' ? (
            <FormField name="bulk-config-flat-price" label={`Flat price (${currency})`}>
              <Input
                placeholder="79.00"
                value={flatPriceAmount}
                onChange={(e) => { setFlatPriceAmount(e.target.value); }}
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
          checked={stockMode === 'use-master'}
          onChange={() => { setStockMode('use-master'); }}
          label="Use master stock"
          hint="Each offer uses the product's available quantity. Zero-stock rows are flagged."
        />
        <PolicyRadio
          name="bulk-stock-mode"
          checked={stockMode === 'cap'}
          onChange={() => { setStockMode('cap'); }}
          label="Cap master stock"
          hint="Use the master quantity, capped at N."
        >
          {stockMode === 'cap' ? (
            <FormField name="bulk-config-cap" label="Cap at">
              <Input
                type="number"
                min={1}
                value={capValue}
                onChange={(e) => { setCapValue(e.target.value); }}
                aria-invalid={!capValid}
              />
            </FormField>
          ) : null}
        </PolicyRadio>
        <PolicyRadio
          name="bulk-stock-mode"
          checked={stockMode === 'flat'}
          onChange={() => { setStockMode('flat'); }}
          label="Flat stock for all rows"
          hint="Same quantity for every offer, ignoring master stock."
        >
          {stockMode === 'flat' ? (
            <FormField name="bulk-config-flat-stock" label="Stock">
              <Input
                type="number"
                min={1}
                value={flatStockValue}
                onChange={(e) => { setFlatStockValue(e.target.value); }}
                aria-invalid={!flatStockValid}
              />
            </FormField>
          ) : null}
        </PolicyRadio>
      </fieldset>

      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)' }}>
        <input
          type="checkbox"
          checked={publishImmediately}
          onChange={(e) => { setPublishImmediately(e.target.checked); }}
        />
        <span>
          <strong>Publish immediately</strong>
          <small style={{ display: 'block', color: 'var(--text-muted)' }}>
            Uncheck to create all offers as drafts.
          </small>
        </span>
      </label>

      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)' }}>
        <input
          type="checkbox"
          checked={generateDescription}
          onChange={(e) => { setGenerateDescription(e.target.checked); }}
        />
        <span>
          <strong>Generate AI descriptions by default</strong>
          <small style={{ display: 'block', color: 'var(--text-muted)' }}>
            Worker uses ContentSuggestionService per row. Per-row toggle in the edit modal
            overrides this.
          </small>
        </span>
      </label>

      <footer className="bulk-wizard__footer">
        <div className="bulk-wizard__footer-spacer" />
        <Button tone="ghost" onClick={onCancel}>Cancel</Button>
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
      {/* Conditional input lives OUTSIDE the <label> — nesting a FormField (which
          renders its own <label>) inside would produce invalid label-in-label markup. */}
      {children ? <div className="bulk-config__policy-detail">{children}</div> : null}
    </div>
  );
}
