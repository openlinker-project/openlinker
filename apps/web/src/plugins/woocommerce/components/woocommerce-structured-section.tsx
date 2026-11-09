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
import { useWoocommerceMessages } from '../messages';

export function WoocommerceStructuredSection({
  form,
  configIsParseable,
  syncStructuredToJson,
}: StructuredConfigSectionProps): ReactElement {
  const copy = useWoocommerceMessages().woocommerceStructuredSection;
  return (
    <>
      <FormField
        label={copy.siteUrl.label}
        name="siteUrl"
        error={form.formState.errors.siteUrl?.message}
        description={copy.siteUrl.description}
      >
        <Input
          value={form.watch('siteUrl') ?? ''}
          onChange={(event) => syncStructuredToJson('siteUrl', event.target.value)}
          placeholder={copy.siteUrl.placeholder}
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.siteUrl)}
        />
      </FormField>
      <FormField
        label={copy.unmanagedStockQuantity.label}
        name="unmanagedStockQuantity"
        error={form.formState.errors.unmanagedStockQuantity?.message}
        description={copy.unmanagedStockQuantity.description}
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
