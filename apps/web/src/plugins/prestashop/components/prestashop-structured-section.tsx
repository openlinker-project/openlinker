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
import type { ReactElement } from 'react';
import { Alert } from '../../../shared/ui/alert';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import { useMappingOptions } from '../../../features/mappings';
import type { MappingOption } from '../../../features/mappings';
import type { StructuredConfigSectionProps } from '../../../shared/plugins';
import { interpolate } from '../../../shared/i18n';
import { usePrestashopMessages } from '../messages';

function carrierOptionLabel(option: MappingOption, dynamicTemplate: string): string {
  return option.kind === 'dynamic'
    ? interpolate(dynamicTemplate, { label: option.label })
    : option.label;
}

export function PrestashopStructuredSection({
  connection,
  form,
  configIsParseable,
  syncStructuredToJson,
}: StructuredConfigSectionProps): ReactElement {
  const copy = usePrestashopMessages().prestashopStructuredSection;
  return (
    <>
      <FormField
        label={copy.shopUrl.label}
        name="baseUrl"
        error={form.formState.errors.baseUrl?.message}
        description={copy.shopUrl.description}
      >
        <Input
          value={form.watch('baseUrl') ?? ''}
          onChange={(event) => syncStructuredToJson('baseUrl', event.target.value)}
          placeholder={copy.shopUrl.placeholder}
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.baseUrl)}
        />
      </FormField>

      <FormField
        label={copy.storefrontUrl.label}
        name="storefrontBaseUrl"
        error={form.formState.errors.storefrontBaseUrl?.message}
        description={copy.storefrontUrl.description}
      >
        <Input
          value={form.watch('storefrontBaseUrl') ?? ''}
          onChange={(event) => syncStructuredToJson('storefrontBaseUrl', event.target.value)}
          placeholder={copy.storefrontUrl.placeholder}
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.storefrontBaseUrl)}
        />
      </FormField>

      <FormField
        label={copy.shopId.label}
        name="shopId"
        error={form.formState.errors.shopId?.message}
        description={copy.shopId.description}
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
        label={copy.callbackUrl.label}
        name="openlinkerCallbackBaseUrl"
        error={form.formState.errors.openlinkerCallbackBaseUrl?.message}
        description={copy.callbackUrl.description}
      >
        <Input
          value={form.watch('openlinkerCallbackBaseUrl') ?? ''}
          onChange={(event) =>
            syncStructuredToJson('openlinkerCallbackBaseUrl', event.target.value)
          }
          placeholder={copy.callbackUrl.placeholder}
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

      <FormField
        label={copy.inpostModuleType.label}
        name="inpostPsModuleType"
        error={form.formState.errors.inpostPsModuleType?.message}
        description={copy.inpostModuleType.description}
      >
        <Select
          value={form.watch('inpostPsModuleType') ?? ''}
          onChange={(event) => syncStructuredToJson('inpostPsModuleType', event.target.value)}
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.inpostPsModuleType)}
        >
          <option value="">{copy.inpostModuleType.none}</option>
          <option value="official_inpost">{copy.inpostModuleType.officialInpost}</option>
        </Select>
      </FormField>
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
  const copy = usePrestashopMessages().prestashopStructuredSection.fallbackCarrier;
  const { options, isLoading, errors } = useMappingOptions(connectionId);
  const carriersError = errors.prestashopCarriers ?? null;
  const carriers = options.prestashopCarriers;
  const hasDynamicOption = carriers.some((c) => c.kind === 'dynamic');
  const showNoFallbackWarning =
    value === '' && carriersError === null && !isLoading && !hasDynamicOption;

  return (
    <>
      <FormField
        label={copy.label}
        name="defaultCarrierId"
        error={errorMessage}
        description={copy.description}
      >
        {isLoading ? (
          <Select disabled>
            <option>{copy.loading}</option>
          </Select>
        ) : carriersError ? (
          <Select disabled>
            <option>{copy.failed}</option>
          </Select>
        ) : (
          <Select
            value={value}
            onChange={(event) => onChange(event.target.value)}
            disabled={disabled}
            invalid={Boolean(errorMessage)}
          >
            <option value="">{copy.none}</option>
            {carriers.map((c) => (
              <option key={c.value} value={c.value}>
                {carrierOptionLabel(c, copy.dynamicOption)}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      {showNoFallbackWarning ? (
        <Alert tone="warning" className="edit-connection__fallback-warning">
          {copy.noFallbackWarning}
        </Alert>
      ) : null}
    </>
  );
}
