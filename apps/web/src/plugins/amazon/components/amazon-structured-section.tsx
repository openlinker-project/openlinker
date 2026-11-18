/**
 * Amazon Structured Section (#4186)
 *
 * Plugin-owned inputs rendered inside `EditConnectionForm` for Amazon
 * connections: the environment the connection was created for (shown, not
 * editable), the region, the marketplaces of that region, the merchant token
 * when offers are enabled and the order-notification queue when orders are.
 *
 * Every section follows `enabledCapabilities`, never `platformType`. A
 * session without `connections:write` sees the values with the inputs
 * disabled.
 *
 * A stored marketplace this browser does not list (Amazon adds marketplaces)
 * stays selected and is shown by its id, instead of disappearing on save.
 *
 * @module plugins/amazon/components
 */
import type { ReactElement } from 'react';
import {
  AmazonRegionValues,
  findMarketplace,
  isAmazonRegion,
  marketplacesForRegion,
} from '../../../features/amazon';
import { usePermission } from '../../../shared/auth/use-permission';
import { interpolate } from '../../../shared/i18n';
import type { StructuredConfigSectionProps } from '../../../shared/plugins';
import { Alert } from '../../../shared/ui/alert';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import { splitMarketplaceIds } from '../amazon-connection-config';
import { useAmazonMessages } from '../messages';

export function AmazonStructuredSection({
  connection,
  form,
  configIsParseable,
  syncStructuredToJson,
}: StructuredConfigSectionProps): ReactElement {
  const messages = useAmazonMessages();
  const copy = messages.edit;
  const countries = messages.setup.countries;
  const canWrite = usePermission('connections:write');
  const disabled = !configIsParseable || !canWrite;
  const errors = form.formState.errors;

  const config = connection.config;
  const savedRegion = isAmazonRegion(config.region) ? config.region : 'eu';
  const watchedRegion = form.watch('amazonRegion');
  const region = isAmazonRegion(watchedRegion) ? watchedRegion : savedRegion;
  const environment = config.environment === 'sandbox' ? 'sandbox' : 'production';
  const ordersEnabled = connection.enabledCapabilities.includes('OrderSource');
  const offersEnabled = connection.enabledCapabilities.includes('OfferManager');

  const selected = splitMarketplaceIds(form.watch('amazonMarketplaceIds') ?? '');
  const offered = marketplacesForRegion(region);
  // A stored id outside the offered list (a marketplace this browser does not
  // know, or one of another region) stays visible so it can be unticked.
  const unlisted = selected.filter((id) => !offered.some((marketplace) => marketplace.id === id));

  const toggle = (id: string, checked: boolean): void => {
    const next = checked ? [...selected, id] : selected.filter((entry) => entry !== id);
    syncStructuredToJson('amazonMarketplaceIds', next.join(','));
  };

  const countryName = (country: string): string =>
    countries[country as keyof typeof countries] ?? country;

  // Another region is another Amazon server: the old region's marketplaces
  // would be refused there, so they are dropped with the change.
  const changeRegion = (next: string): void => {
    if (!isAmazonRegion(next)) return;
    syncStructuredToJson('amazonRegion', next);
    const kept = selected.filter((id) => findMarketplace(id)?.region === next);
    syncStructuredToJson('amazonMarketplaceIds', kept.join(','));
  };

  const unlistedLabel = (id: string): string => {
    const known = findMarketplace(id);
    return known === undefined
      ? interpolate(copy.marketplaces.unlisted, { id })
      : interpolate(messages.setup.marketplaceOption, { country: countryName(known.country), currency: known.currency });
  };

  return (
    <>
      <FormField label={copy.account.label} name="amazonAccount" description={copy.account.description}>
        <Input value={messages.setup.environments[environment]} disabled />
      </FormField>
      <FormField label={copy.region.label} name="amazonRegion" description={copy.region.description}>
        <Select value={region} onChange={(event) => changeRegion(event.target.value)} disabled={disabled}>
          {AmazonRegionValues.map((value) => (
            <option key={value} value={value}>
              {messages.setup.regions[value]}
            </option>
          ))}
        </Select>
      </FormField>
      {region !== savedRegion ? (
        <Alert tone="warning" density="compact">
          {copy.region.changed}
        </Alert>
      ) : null}
      {environment === 'sandbox' ? (
        <Alert tone="warning" density="compact">
          {messages.setup.sandboxNotice}
        </Alert>
      ) : null}

      <fieldset className="form-field">
        <legend className="form-field__label">{copy.marketplaces.label}</legend>
        <p className="form-field__description">{copy.marketplaces.description}</p>
        {offered.map((marketplace) => (
          <label key={marketplace.id} className="checkbox-row">
            <input
              type="checkbox"
              checked={selected.includes(marketplace.id)}
              disabled={disabled}
              onChange={(event) => toggle(marketplace.id, event.target.checked)}
            />
            <span>
              {interpolate(messages.setup.marketplaceOption, {
                country: countryName(marketplace.country),
                currency: marketplace.currency,
              })}
              <small className="text-muted mono-text" style={{ display: 'block' }}>
                {marketplace.id}
              </small>
            </span>
          </label>
        ))}
        {unlisted.map((id) => (
          <label key={id} className="checkbox-row">
            <input type="checkbox" checked disabled={disabled} onChange={() => toggle(id, false)} />
            <span>
              {unlistedLabel(id)}
              <small className="text-muted mono-text" style={{ display: 'block' }}>
                {id}
              </small>
            </span>
          </label>
        ))}
        {errors.amazonMarketplaceIds ? (
          <p className="form-field__error" role="alert">
            {errors.amazonMarketplaceIds.message}
          </p>
        ) : null}
      </fieldset>

      {offersEnabled ? (
        <FormField
          label={messages.setup.sellerId}
          name="amazonSellerId"
          error={errors.amazonSellerId?.message}
          description={messages.setup.sellerIdHintRequired}
        >
          <Input
            className="mono-text"
            value={form.watch('amazonSellerId') ?? ''}
            onChange={(event) => syncStructuredToJson('amazonSellerId', event.target.value)}
            placeholder="A2EXAMPLE12345"
            disabled={disabled}
            invalid={Boolean(errors.amazonSellerId)}
          />
        </FormField>
      ) : null}
      {offersEnabled && (form.watch('amazonSellerId') ?? '').trim() === '' ? (
        <Alert tone="warning" density="compact">
          {copy.sellerIdMissing}
        </Alert>
      ) : null}

      {ordersEnabled ? (
        <FormField
          label={messages.setup.queueUrl}
          name="amazonNotificationQueueUrl"
          error={errors.amazonNotificationQueueUrl?.message}
          description={copy.queueUrlDescription}
        >
          <Input
            className="mono-text"
            value={form.watch('amazonNotificationQueueUrl') ?? ''}
            onChange={(event) => syncStructuredToJson('amazonNotificationQueueUrl', event.target.value)}
            placeholder="https://sqs.eu-west-1.amazonaws.com/123456789012/amazon-notifications"
            disabled={disabled}
            invalid={Boolean(errors.amazonNotificationQueueUrl)}
          />
        </FormField>
      ) : null}
    </>
  );
}
