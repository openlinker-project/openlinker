/**
 * Shopify Structured Section
 *
 * Plugin-owned structured-config inputs rendered inside `EditConnectionForm`
 * for Shopify connections (#3982): the OpenLinker callback URL the webhook
 * install registers with the store (the host-level `openlinkerCallbackBaseUrl`
 * field, as Shoper and PrestaShop use it), the location OpenLinker reads and
 * writes stock at, the quantity reported for untracked stock, the sales
 * country of the tax-rate read, and the opt-in that sends refunds to Shopify.
 *
 * LOCATION: picked from the store's own list. When the store cannot be read
 * the field falls back to typing the id, so a wrong id can still be fixed.
 * A stored id that is not one of the store's active locations stays selectable
 * and is named as such, instead of disappearing from the picker.
 *
 * @module plugins/shopify/components
 */
import type { ReactElement } from 'react';
import { useShopifyLocationsQuery } from '../../../features/shopify';
import { interpolate } from '../../../shared/i18n';
import type { StructuredConfigSectionProps } from '../../../shared/plugins';
import { Alert } from '../../../shared/ui/alert';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import { useShopifyMessages } from '../messages';

export function ShopifyStructuredSection({
  connection,
  form,
  configIsParseable,
  syncStructuredToJson,
}: StructuredConfigSectionProps): ReactElement {
  const copy = useShopifyMessages().edit;
  const locationsQuery = useShopifyLocationsQuery(connection.id);
  const errors = form.formState.errors;

  const webhookCapabilityEnabled =
    connection.enabledCapabilities.includes('OrderSource') ||
    connection.enabledCapabilities.includes('ProductMaster');
  const locationId = form.watch('shopifyLocationId') ?? '';
  const refundsOn = form.watch('shopifyRefundsThroughShopify') === 'true';

  const locations = locationsQuery.data ?? [];
  const primary = locations.find((location) => location.isPrimary);
  const storedIsUnknown =
    locationsQuery.isSuccess && locationId !== '' && !locations.some((l) => l.id === locationId);

  function renderLocationControl(): ReactElement {
    if (locationsQuery.isError) {
      return (
        <Input
          value={locationId}
          onChange={(event) => syncStructuredToJson('shopifyLocationId', event.target.value)}
          placeholder="12345678"
          inputMode="numeric"
          disabled={!configIsParseable}
          invalid={Boolean(errors.shopifyLocationId)}
        />
      );
    }
    return (
      <Select
        value={locationId}
        onChange={(event) => syncStructuredToJson('shopifyLocationId', event.target.value)}
        disabled={!configIsParseable || locationsQuery.isLoading}
        aria-busy={locationsQuery.isLoading}
      >
        <option value="">
          {locationsQuery.isLoading
            ? copy.location.loading
            : primary
              ? interpolate(copy.location.primaryOption, { name: primary.name })
              : copy.location.primaryUnnamed}
        </option>
        {storedIsUnknown ? (
          <option value={locationId}>
            {interpolate(copy.location.unknownOption, { id: locationId })}
          </option>
        ) : null}
        {locations.map((location) => (
          <option key={location.id} value={location.id}>
            {location.name}
          </option>
        ))}
      </Select>
    );
  }

  return (
    <>
      <FormField
        label={copy.callbackUrl.label}
        name="openlinkerCallbackBaseUrl"
        error={errors.openlinkerCallbackBaseUrl?.message}
        description={copy.callbackUrl.description}
      >
        <Input
          value={form.watch('openlinkerCallbackBaseUrl') ?? ''}
          onChange={(event) => syncStructuredToJson('openlinkerCallbackBaseUrl', event.target.value)}
          placeholder="https://api.openlinker.example"
          disabled={!configIsParseable}
          invalid={Boolean(errors.openlinkerCallbackBaseUrl)}
        />
      </FormField>
      {webhookCapabilityEnabled ? null : (
        <Alert tone="warning" title={copy.noWebhookCapability.title}>
          {copy.noWebhookCapability.body}
        </Alert>
      )}

      <FormField
        label={copy.location.label}
        name="shopifyLocationId"
        error={errors.shopifyLocationId?.message}
        description={copy.location.description}
      >
        {renderLocationControl()}
      </FormField>
      {locationsQuery.isError ? (
        <Alert tone="warning" density="compact">
          {copy.location.loadFailed}
        </Alert>
      ) : null}
      {storedIsUnknown ? (
        <Alert tone="warning" density="compact">
          {copy.location.unknownWarning}
        </Alert>
      ) : null}

      <FormField
        label={copy.unmanagedStock.label}
        name="shopifyUnmanagedStockQuantity"
        error={errors.shopifyUnmanagedStockQuantity?.message}
        description={copy.unmanagedStock.description}
      >
        <Input
          value={form.watch('shopifyUnmanagedStockQuantity') ?? ''}
          onChange={(event) =>
            syncStructuredToJson('shopifyUnmanagedStockQuantity', event.target.value)
          }
          placeholder="1000"
          inputMode="numeric"
          disabled={!configIsParseable}
          invalid={Boolean(errors.shopifyUnmanagedStockQuantity)}
        />
      </FormField>

      <FormField
        label={copy.salesCountry.label}
        name="shopifySalesCountryIso2"
        error={errors.shopifySalesCountryIso2?.message}
        description={copy.salesCountry.description}
      >
        <Input
          value={form.watch('shopifySalesCountryIso2') ?? ''}
          onChange={(event) => syncStructuredToJson('shopifySalesCountryIso2', event.target.value)}
          placeholder="PL"
          maxLength={2}
          disabled={!configIsParseable}
          invalid={Boolean(errors.shopifySalesCountryIso2)}
        />
      </FormField>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={refundsOn}
          disabled={!configIsParseable}
          onChange={(event) =>
            syncStructuredToJson('shopifyRefundsThroughShopify', event.target.checked ? 'true' : '')
          }
        />
        <span>
          {copy.refunds.label}
          <small className="text-muted" style={{ display: 'block' }}>
            {copy.refunds.description}
          </small>
        </span>
      </label>
      {refundsOn ? (
        <Alert tone="warning" density="compact">
          {copy.refunds.warning}
        </Alert>
      ) : null}
    </>
  );
}
