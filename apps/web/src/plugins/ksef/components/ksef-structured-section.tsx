/**
 * KSeF Structured Section
 *
 * Plugin-owned structured-config inputs rendered inside `EditConnectionForm`
 * when the connection's `platformType` is `'ksef'`. Carries:
 *
 *   - Environment (`config.env`) — the C2 config-validator-gated field
 *   - Seller NIP (`config.sellerNip`) — FE-additive context field
 *   - Context identifier (`config.contextIdentifier`) — FE-additive context field
 *
 * Credentials (auth type + secret) are NOT edited here — they live in the
 * write-only `KsefCredentialsPanel`.
 *
 * @module plugins/ksef/components
 */
import type { ReactElement } from 'react';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import type { StructuredConfigSectionProps } from '../../../shared/plugins';
import { KSEF_ENVIRONMENT_VALUES } from '../../../features/connections';

const ENVIRONMENT_LABELS: Record<(typeof KSEF_ENVIRONMENT_VALUES)[number], string> = {
  test: 'Test (sandbox)',
  demo: 'Demo (pre-production)',
  prod: 'Production (live clearance)',
};

export function KsefStructuredSection({
  form,
  configIsParseable,
  syncStructuredToJson,
}: StructuredConfigSectionProps): ReactElement {
  return (
    <>
      <FormField
        label="Environment"
        name="ksefEnvironment"
        error={form.formState.errors.ksefEnvironment?.message}
        description="KSeF target environment (config.env). Production clears live invoices."
      >
        <Select
          value={form.watch('ksefEnvironment') ?? ''}
          onChange={(event) => syncStructuredToJson('ksefEnvironment', event.target.value)}
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.ksefEnvironment)}
        >
          <option value="" disabled>
            Select an environment…
          </option>
          {KSEF_ENVIRONMENT_VALUES.map((env) => (
            <option key={env} value={env}>
              {ENVIRONMENT_LABELS[env]}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField
        label="Seller NIP"
        name="sellerNip"
        error={form.formState.errors.sellerNip?.message}
        description="10-digit Polish tax identifier of the issuing seller. Optional."
      >
        <Input
          value={form.watch('sellerNip') ?? ''}
          onChange={(event) => syncStructuredToJson('sellerNip', event.target.value)}
          placeholder="1234567890"
          inputMode="numeric"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.sellerNip)}
        />
      </FormField>
      <FormField
        label="Context identifier"
        name="contextIdentifier"
        error={form.formState.errors.contextIdentifier?.message}
        description="Optional KSeF subject/context identifier when issuing on behalf of a sub-unit."
      >
        <Input
          value={form.watch('contextIdentifier') ?? ''}
          onChange={(event) => syncStructuredToJson('contextIdentifier', event.target.value)}
          placeholder="(optional)"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.contextIdentifier)}
        />
      </FormField>
    </>
  );
}
