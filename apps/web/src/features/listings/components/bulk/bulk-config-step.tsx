/**
 * Bulk wizard Step 1 — Config
 *
 * Shared defaults applied to every row before review/edit. Operator picks
 * the Allegro connection (auto-hidden when there's exactly one) and the
 * shipping rate / delivery policy from the seller's catalogue.
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
import type { BulkWizardConfig } from './bulk-wizard.types';

interface BulkConfigStepProps {
  initial: Partial<BulkWizardConfig>;
  onProceed: (config: BulkWizardConfig) => void;
  onCancel: () => void;
}

const DEFAULT_CURRENCY = 'PLN';

export function BulkConfigStep({
  initial,
  onProceed,
  onCancel,
}: BulkConfigStepProps): ReactElement {
  const connectionsQuery = useConnectionsQuery({ platformType: 'allegro' });
  const allegroConnections: Connection[] = (connectionsQuery.data ?? []).filter(
    (c) =>
      c.status === 'active' &&
      c.supportedCapabilities?.includes('OfferManager'),
  );

  const [connectionId, setConnectionId] = useState<string>(
    initial.connectionId ?? '',
  );

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
  const [defaultStock, setDefaultStock] = useState<string>(
    String(initial.defaultStock ?? 1),
  );
  const [defaultPriceAmount, setDefaultPriceAmount] = useState<string>(
    initial.defaultPrice ? String(initial.defaultPrice.amount) : '',
  );
  const [defaultPriceCurrency, setDefaultPriceCurrency] = useState<string>(
    initial.defaultPrice?.currency ?? DEFAULT_CURRENCY,
  );
  const [publishImmediately, setPublishImmediately] = useState<boolean>(
    initial.publishImmediately ?? true,
  );
  const [generateDescription, setGenerateDescription] = useState<boolean>(
    initial.generateDescription ?? false,
  );

  // Reset deliveryPolicyId if the connection changes (different seller, different list).
  useEffect(() => {
    if (
      deliveryPolicyId &&
      !deliveryPolicies.some((p) => p.id === deliveryPolicyId)
    ) {
      setDeliveryPolicyId('');
    }
  }, [deliveryPolicyId, deliveryPolicies]);

  const stockValid = /^\d+$/.test(defaultStock.trim()) && Number(defaultStock) >= 0;
  const priceProvided = defaultPriceAmount.trim() !== '';
  const priceValid =
    !priceProvided ||
    /^\d+([.,]\d{1,2})?$/.test(defaultPriceAmount.trim());

  const canProceed =
    connectionId !== '' &&
    deliveryPolicyId !== '' &&
    stockValid &&
    priceValid;

  function handleProceed(): void {
    if (!canProceed) return;
    onProceed({
      connectionId,
      deliveryPolicyId,
      defaultStock: Number(defaultStock),
      publishImmediately,
      generateDescription,
      ...(priceProvided
        ? {
            defaultPrice: {
              amount: Number(defaultPriceAmount.replace(',', '.')),
              currency: defaultPriceCurrency,
            },
          }
        : {}),
    });
  }

  if (connectionsQuery.isLoading) {
    return <Alert tone="info">Loading connections…</Alert>;
  }
  if (allegroConnections.length === 0) {
    return (
      <Alert tone="error">
        No active Allegro connections with offer-creation capability found. Add one
        from <a href="/connections">Connections</a>.
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
          Shared defaults applied to all selected products. You can override per row in
          the next step.
        </p>
      </header>

      {allegroConnections.length > 1 ? (
        <FormField name="bulk-config-connection" label="Allegro connection">
          <Select
            value={connectionId}
            onChange={(e) => { setConnectionId(e.target.value); }}
          >
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
        <FormField name="bulk-config-price-currency" label="Currency">
          <Select
            value={defaultPriceCurrency}
            onChange={(e) => { setDefaultPriceCurrency(e.target.value); }}
          >
            <option value="PLN">PLN</option>
            <option value="EUR">EUR</option>
            <option value="USD">USD</option>
          </Select>
        </FormField>
      </div>

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
            Worker uses ContentSuggestionService per row. Per-row toggle in the edit
            modal overrides this.
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
