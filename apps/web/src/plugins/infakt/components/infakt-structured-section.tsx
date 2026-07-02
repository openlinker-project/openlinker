/**
 * Infakt Structured Section
 *
 * Plugin-owned structured-config inputs rendered inside `EditConnectionForm`
 * when the connection's `platformType` is `'infakt'`. Carries:
 *
 *   - Base URL (`config.baseUrl`) — used to point an existing connection at
 *     inFakt's sandbox environment instead of production.
 *   - Default payment method (`config.defaultPaymentMethod`, #1303) — sent
 *     on every issued invoice/correction. Empty selection means "no
 *     override", the adapter falls back to `'cash'`. Tucked behind an
 *     `InlineDisclosure` — most operators never touch it, so it reads as an
 *     inline fact ("Payment method for invoice: Cash") rather than a
 *     permanently-open control competing with Base URL for attention.
 *
 * Credentials (the API key) are NOT edited here — they live in the
 * write-only `InfaktCredentialsPanel`.
 *
 * @module plugins/infakt/components
 */
import type { ReactElement } from 'react';
import { FormField } from '../../../shared/ui/form-field';
import { InlineDisclosure } from '../../../shared/ui/inline-disclosure';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import type { StructuredConfigSectionProps } from '../../../shared/plugins';

const PAYMENT_METHOD_LABELS: Record<'cash' | 'transfer', string> = {
  cash: 'Cash',
  transfer: 'Transfer',
};

export function InfaktStructuredSection({
  form,
  configIsParseable,
  syncStructuredToJson,
}: StructuredConfigSectionProps): ReactElement {
  const paymentMethod = form.watch('infaktPaymentMethod') ?? '';
  // Mirrors the adapter's own fallback (`config.defaultPaymentMethod ?? 'cash'`)
  // so the collapsed summary always reflects what will actually be sent.
  const effectiveLabel = PAYMENT_METHOD_LABELS[paymentMethod === 'transfer' ? 'transfer' : 'cash'];

  return (
    <>
      <FormField
        label="Base URL (optional)"
        name="baseUrl"
        error={form.formState.errors.baseUrl?.message}
        description="Advanced — override the default inFakt API base URL for sandbox testing. Leave blank to use production."
      >
        <Input
          value={form.watch('baseUrl') ?? ''}
          onChange={(event) => syncStructuredToJson('baseUrl', event.target.value)}
          placeholder="https://api.infakt.pl"
          className="mono-text"
          autoComplete="off"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.baseUrl)}
        />
      </FormField>
      <InlineDisclosure label="Payment method for invoice:" value={effectiveLabel}>
        <FormField
          label="Default payment method"
          name="infaktPaymentMethod"
          error={form.formState.errors.infaktPaymentMethod?.message}
          description={
            '"Transfer" 422s on inFakt unless a bank account is configured on the seller’s ' +
            'inFakt account. Leave "Cash" unless you have confirmed that prerequisite.'
          }
        >
          <Select
            value={paymentMethod}
            onChange={(event) => syncStructuredToJson('infaktPaymentMethod', event.target.value)}
            disabled={!configIsParseable}
            invalid={Boolean(form.formState.errors.infaktPaymentMethod)}
          >
            <option value="cash">{PAYMENT_METHOD_LABELS.cash}</option>
            <option value="transfer">{PAYMENT_METHOD_LABELS.transfer}</option>
          </Select>
        </FormField>
      </InlineDisclosure>
    </>
  );
}
