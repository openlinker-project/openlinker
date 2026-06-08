/**
 * WooCommerce Structured Section
 *
 * Plugin-owned structured-config inputs rendered inside `EditConnectionForm`
 * when the connection's `platformType` is `'woocommerce'`. Carries:
 *
 *   - Site URL (editable, propagated to config via syncStructuredToJson)
 *
 * @module plugins/woocommerce/components
 */
import type { ReactElement } from 'react';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import type { StructuredConfigSectionProps } from '../../../shared/plugins';

export function WoocommerceStructuredSection({
  form,
  configIsParseable,
  syncStructuredToJson,
}: StructuredConfigSectionProps): ReactElement {
  return (
    <FormField
      label="Site URL"
      name="baseUrl"
      error={form.formState.errors.baseUrl?.message}
      description="The root URL of the WooCommerce store. Must use HTTPS."
    >
      <Input
        value={form.watch('baseUrl') ?? ''}
        onChange={(event) => syncStructuredToJson('baseUrl', event.target.value)}
        placeholder="https://shop.example.com"
        disabled={!configIsParseable}
        invalid={Boolean(form.formState.errors.baseUrl)}
      />
    </FormField>
  );
}
