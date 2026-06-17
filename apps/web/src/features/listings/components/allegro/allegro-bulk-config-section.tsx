/**
 * AllegroBulkConfigSection
 *
 * Platform-specific bulk-offer config section for Allegro (#1096). Migrates
 * the delivery-policy + currency fields that previously lived hardcoded in
 * `bulk-config-step` into Allegro's own plugin contribution — paying down the
 * #608/#740 debt where the host bulk-config was Allegro-shaped. Writes the
 * chosen delivery policy into the parent RHF form's
 * `platformParams.deliveryPolicyId` and the listing currency into `currency`.
 *
 * Registered via the Allegro plugin's `platform.bulkOfferConfigSection` slot,
 * resolved by the host via `usePlatform('allegro')`. Content-only (no Dialog).
 *
 * @module features/listings/components/allegro
 */
import { useEffect, type ReactElement } from 'react';

import { Alert } from '../../../../shared/ui/alert';
import { FormField } from '../../../../shared/ui/form-field';
import { Input } from '../../../../shared/ui/input';
import { Select } from '../../../../shared/ui/select';
import type { BulkOfferConfigSectionProps } from '../../../../shared/plugins';
import { useSellerPoliciesQuery } from '../../hooks/use-seller-policies-query';

const CURRENCY_OPTIONS = ['PLN', 'EUR', 'USD'] as const;

export function AllegroBulkConfigSection({
  connection,
  form,
}: BulkOfferConfigSectionProps): ReactElement {
  const policiesQuery = useSellerPoliciesQuery(connection.id);
  const deliveryPolicies = policiesQuery.data?.deliveryPolicies ?? [];

  const platformParams = form.watch('platformParams');
  const deliveryPolicyId =
    typeof platformParams.deliveryPolicyId === 'string' ? platformParams.deliveryPolicyId : '';
  const currency = form.watch('currency');

  // Default the currency to PLN on mount if unset (host default), and clear a
  // stale policy id if the connection changed to one without that policy.
  useEffect(() => {
    if (!form.getValues('currency')) {
      form.setValue('currency', 'PLN', { shouldDirty: false });
    }
  }, [form]);

  useEffect(() => {
    if (deliveryPolicyId && !deliveryPolicies.some((p) => p.id === deliveryPolicyId)) {
      form.setValue(
        'platformParams',
        { ...form.getValues('platformParams'), deliveryPolicyId: '' },
        { shouldDirty: true },
      );
    }
  }, [deliveryPolicyId, deliveryPolicies, form]);

  return (
    <div
      className="bulk-config__platform-section"
      style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--space-3)' }}
    >
      <FormField name="bulk-config-shipping" label="Shipping rate package">
        {policiesQuery.isLoading ? (
          <Input disabled value="Loading policies…" />
        ) : policiesQuery.error ? (
          <Alert tone="error">Could not load shipping policies for this connection.</Alert>
        ) : (
          <Select
            value={deliveryPolicyId}
            onChange={(e) =>
              form.setValue(
                'platformParams',
                { ...form.getValues('platformParams'), deliveryPolicyId: e.target.value },
                { shouldDirty: true },
              )
            }
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
      <FormField name="bulk-config-currency" label="Currency">
        <Select
          value={currency}
          onChange={(e) => form.setValue('currency', e.target.value, { shouldDirty: true })}
        >
          {CURRENCY_OPTIONS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      </FormField>
    </div>
  );
}

/** Pure completeness predicate the host ANDs into its `canProceed` gate. */
export function allegroBulkConfigIsComplete(values: {
  platformParams: Record<string, unknown>;
}): boolean {
  return (
    typeof values.platformParams.deliveryPolicyId === 'string' &&
    values.platformParams.deliveryPolicyId !== ''
  );
}
