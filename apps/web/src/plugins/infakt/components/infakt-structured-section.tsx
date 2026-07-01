/**
 * Infakt Structured Section
 *
 * Plugin-owned structured-config input rendered inside `EditConnectionForm`
 * when the connection's `platformType` is `'infakt'`. Carries the optional
 * `baseUrl` override (config.baseUrl) — used to point an existing connection
 * at inFakt's sandbox environment instead of production. Credentials (the
 * API key) are NOT edited here — they live in the write-only
 * `InfaktCredentialsPanel`. Mirrors `WoocommerceStructuredSection`'s
 * single-field shape.
 *
 * @module plugins/infakt/components
 */
import type { ReactElement } from 'react';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import type { StructuredConfigSectionProps } from '../../../shared/plugins';

export function InfaktStructuredSection({
  form,
  configIsParseable,
  syncStructuredToJson,
}: StructuredConfigSectionProps): ReactElement {
  return (
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
  );
}
