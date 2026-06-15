/**
 * WooCommerce Structured Section
 *
 * Plugin-owned structured-config inputs rendered inside `EditConnectionForm`
 * when the connection's `platformType` is `'woocommerce'`. Carries:
 *
 *   - Site URL (editable, propagated to config via syncStructuredToJson)
 *   - Unmanaged stock quantity (#969 §7.3) — `config.inventory.unmanagedStockQuantity`,
 *     the quantity reported for products with stock management disabled but in stock
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
    <>
      <FormField
        label="Site URL"
        name="siteUrl"
        error={form.formState.errors.siteUrl?.message}
        description="The root URL of the WooCommerce store. Must use HTTPS."
      >
        <Input
          value={form.watch('siteUrl') ?? ''}
          onChange={(event) => syncStructuredToJson('siteUrl', event.target.value)}
          placeholder="https://shop.example.com"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.siteUrl)}
        />
      </FormField>
      <FormField
        label="Unmanaged stock quantity"
        name="unmanagedStockQuantity"
        error={form.formState.errors.unmanagedStockQuantity?.message}
        description="Quantity reported for products with stock management disabled but in stock. Leave empty for the default (1000)."
      >
        <Input
          value={form.watch('unmanagedStockQuantity') ?? ''}
          onChange={(event) => syncStructuredToJson('unmanagedStockQuantity', event.target.value)}
          placeholder="1000"
          inputMode="numeric"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.unmanagedStockQuantity)}
        />
      </FormField>
    </>
  );
}
