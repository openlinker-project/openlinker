/**
 * PrestaShop Structured Section
 *
 * Plugin-owned structured-config inputs rendered inside `EditConnectionForm`
 * when the connection's `platformType` is `'prestashop'`. Carries:
 *
 *   - Shop URL
 *   - Storefront URL (split-host override)
 *   - Shop ID (multi-shop)
 *   - OL callback URL (used by the webhook auto-install flow, #168)
 *   - Fallback carrier picker (PS-only; #517)
 *
 * @module plugins/prestashop/components
 */
import { type ReactElement } from 'react';
import { Alert } from '../../../shared/ui/alert';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import { useMappingOptions } from '../../../features/mappings/hooks/use-mapping-options';
import type { MappingOption } from '../../../features/mappings/api/mappings.types';
import type { StructuredConfigSectionProps } from '../../../shared/plugins';

function carrierOptionLabel(option: MappingOption): string {
  return option.kind === 'dynamic' ? `${option.label} — exact Allegro cost` : option.label;
}

export function PrestashopStructuredSection({
  connection,
  form,
  configIsParseable,
  syncStructuredToJson,
}: StructuredConfigSectionProps): ReactElement {
  return (
    <>
      <FormField
        label="Shop URL"
        name="baseUrl"
        error={form.formState.errors.baseUrl?.message}
        description="The public URL of the PrestaShop storefront."
      >
        <Input
          value={form.watch('baseUrl') ?? ''}
          onChange={(event) => syncStructuredToJson('baseUrl', event.target.value)}
          placeholder="https://shop.example.com"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.baseUrl)}
        />
      </FormField>

      <FormField
        label="Storefront URL (optional)"
        name="storefrontBaseUrl"
        error={form.formState.errors.storefrontBaseUrl?.message}
        description="Override only if your public storefront URL is different from the webservice URL. Leave blank if they're the same — defaults to Shop URL."
      >
        <Input
          value={form.watch('storefrontBaseUrl') ?? ''}
          onChange={(event) => syncStructuredToJson('storefrontBaseUrl', event.target.value)}
          placeholder="https://shop.example.com"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.storefrontBaseUrl)}
        />
      </FormField>

      <FormField
        label="Shop ID (optional)"
        name="shopId"
        error={form.formState.errors.shopId?.message}
        description="Only needed for multi-shop PrestaShop installations."
      >
        <Input
          value={form.watch('shopId') ?? ''}
          onChange={(event) => syncStructuredToJson('shopId', event.target.value)}
          placeholder="1"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.shopId)}
        />
      </FormField>

      <FormField
        label="OL callback URL"
        name="openlinkerCallbackBaseUrl"
        error={form.formState.errors.openlinkerCallbackBaseUrl?.message}
        description="OpenLinker's URL from PrestaShop's perspective — used by the PS module to POST webhooks back to OL. Pre-filled from your browser; override for Docker dev (e.g. http://host.docker.internal:3000) or unusual deploys. Required to use the 'Configure webhooks' action."
      >
        <Input
          value={form.watch('openlinkerCallbackBaseUrl') ?? ''}
          onChange={(event) =>
            syncStructuredToJson('openlinkerCallbackBaseUrl', event.target.value)
          }
          placeholder="https://api.openlinker.example"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.openlinkerCallbackBaseUrl)}
        />
      </FormField>

      <PrestashopFallbackCarrierField
        connectionId={connection.id}
        value={form.watch('defaultCarrierId') ?? ''}
        errorMessage={form.formState.errors.defaultCarrierId?.message}
        disabled={!configIsParseable}
        onChange={(value) => syncStructuredToJson('defaultCarrierId', value)}
      />
    </>
  );
}

interface PrestashopFallbackCarrierFieldProps {
  connectionId: string;
  value: string;
  errorMessage: string | undefined;
  disabled: boolean;
  onChange: (value: string) => void;
}

/**
 * Fallback-carrier picker for PrestaShop connections (#517).
 *
 * Backed by the same `getMappingOptions(connectionId, 'destination', 'carriers')`
 * endpoint as the per-method mapping page, so the option set (and its
 * dynamic-kind decoration) stays in lockstep. The field is allowed to
 * stay blank: when unset, the BE adapter (#516) falls back to the
 * OpenLinker Dynamic carrier at order-create time. A save-time warning
 * banner fires only when (a) the field is blank, (b) the OL Dynamic
 * carrier is NOT among the loaded options (operator hasn't installed
 * the OL PS module on this connection) — i.e. the connection is in a
 * state where any unmapped Allegro shipping method WILL fail at sync.
 */
function PrestashopFallbackCarrierField({
  connectionId,
  value,
  errorMessage,
  disabled,
  onChange,
}: PrestashopFallbackCarrierFieldProps): ReactElement {
  const { options, isLoading, errors } = useMappingOptions(connectionId);
  const carriersError = errors.prestashopCarriers ?? null;
  const carriers = options.prestashopCarriers;
  const hasDynamicOption = carriers.some((c) => c.kind === 'dynamic');
  const showNoFallbackWarning =
    value === '' && carriersError === null && !isLoading && !hasDynamicOption;

  return (
    <>
      <FormField
        label="Fallback carrier (optional)"
        name="defaultCarrierId"
        error={errorMessage}
        description="Used when an Allegro shipping method has no carrier mapping. Leave unset to use the OpenLinker Dynamic carrier (exact Allegro shipping cost) at sync time — works only when the OL PrestaShop module is installed."
      >
        {isLoading ? (
          <Select disabled>
            <option>Loading carriers…</option>
          </Select>
        ) : carriersError ? (
          <Select disabled>
            <option>Failed to load carriers</option>
          </Select>
        ) : (
          <Select
            value={value}
            onChange={(event) => onChange(event.target.value)}
            disabled={disabled}
            invalid={Boolean(errorMessage)}
          >
            <option value="">None — use OpenLinker Dynamic at runtime</option>
            {carriers.map((c) => (
              <option key={c.value} value={c.value}>
                {carrierOptionLabel(c)}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      {showNoFallbackWarning ? (
        <Alert tone="warning" className="edit-connection__fallback-warning">
          No fallback carrier is set and the OpenLinker PrestaShop module isn't installed on this
          connection. Sync will fail for any Allegro shipping method without a carrier mapping
          until you pick a fallback or install the OL PS module.
        </Alert>
      ) : null}
    </>
  );
}
