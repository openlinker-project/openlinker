/**
 * KSeF Structured Section
 *
 * Plugin-owned structured-config inputs rendered inside `EditConnectionForm`
 * when the connection's `platformType` is `'ksef'`. Carries:
 *
 *   - Environment (`config.env`) — the C2 config-validator-gated field
 *   - Seller profile (`config.seller.{nip,name,address}`, #1223) — NIP,
 *     legal name, and postal address the adapter's `resolveSeller` reads.
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
        description="10-digit Polish tax identifier of the issuing seller. Required to issue invoices."
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
        label="Seller legal name"
        name="sellerName"
        error={form.formState.errors.sellerName?.message}
        description="Registered company name (Podmiot1) printed on the invoice. Required to issue."
      >
        <Input
          value={form.watch('sellerName') ?? ''}
          onChange={(event) => syncStructuredToJson('sellerName', event.target.value)}
          placeholder="ACME Sp. z o.o."
          autoComplete="off"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.sellerName)}
        />
      </FormField>
      <FormField
        label="Address line 1"
        name="sellerAddressLine1"
        error={form.formState.errors.sellerAddressLine1?.message}
        description="Street and building number. Required to issue."
      >
        <Input
          value={form.watch('sellerAddressLine1') ?? ''}
          onChange={(event) => syncStructuredToJson('sellerAddressLine1', event.target.value)}
          placeholder="ul. Przykładowa 1"
          autoComplete="off"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.sellerAddressLine1)}
        />
      </FormField>
      <FormField
        label="Address line 2"
        name="sellerAddressLine2"
        error={form.formState.errors.sellerAddressLine2?.message}
        description="Apartment, suite, or unit. Optional."
      >
        <Input
          value={form.watch('sellerAddressLine2') ?? ''}
          onChange={(event) => syncStructuredToJson('sellerAddressLine2', event.target.value)}
          placeholder="(optional)"
          autoComplete="off"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.sellerAddressLine2)}
        />
      </FormField>
      <FormField
        label="City"
        name="sellerCity"
        error={form.formState.errors.sellerCity?.message}
        description="Required to issue."
      >
        <Input
          value={form.watch('sellerCity') ?? ''}
          onChange={(event) => syncStructuredToJson('sellerCity', event.target.value)}
          placeholder="Warszawa"
          autoComplete="off"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.sellerCity)}
        />
      </FormField>
      <FormField
        label="Postal code"
        name="sellerPostalCode"
        error={form.formState.errors.sellerPostalCode?.message}
        description="Required to issue."
      >
        <Input
          value={form.watch('sellerPostalCode') ?? ''}
          onChange={(event) => syncStructuredToJson('sellerPostalCode', event.target.value)}
          placeholder="00-001"
          autoComplete="off"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.sellerPostalCode)}
        />
      </FormField>
      <FormField
        label="Country"
        name="sellerCountryIso2"
        error={form.formState.errors.sellerCountryIso2?.message}
        description="ISO 3166-1 alpha-2 code. Defaults to PL."
      >
        <Input
          value={form.watch('sellerCountryIso2') ?? ''}
          onChange={(event) => syncStructuredToJson('sellerCountryIso2', event.target.value)}
          placeholder="PL"
          autoComplete="off"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.sellerCountryIso2)}
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
