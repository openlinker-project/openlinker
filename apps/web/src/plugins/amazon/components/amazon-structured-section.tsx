/**
 * Amazon Structured Section (#4186)
 *
 * Plugin-owned inputs rendered inside `EditConnectionForm` for Amazon
 * connections: the environment and the region the connection was created for
 * (shown, not editable), the marketplaces of that region, the merchant token
 * when offers are enabled, the order-notification queue when orders are, and
 * the rates of the account's product tax codes when the catalogue or offers
 * are (#4182): Amazon carries a tax code, never a rate.
 *
 * The region is fixed because another region is another Amazon seller account
 * with its own refresh token and merchant token; the API refuses the change.
 * In a region without a unified account (Far East) the picker takes one
 * marketplace.
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
  AmazonMarketplacePicker,
  findMarketplace,
  isAmazonRegion,
  isSingleMarketplaceRegion,
  marketplacesForRegion,
} from '../../../features/amazon';
import { usePermission } from '../../../shared/auth/use-permission';
import { interpolate } from '../../../shared/i18n';
import type { StructuredConfigSectionProps } from '../../../shared/plugins';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import {
  formatTaxCodeRows,
  parseTaxCodeRows,
  splitMarketplaceIds,
  type AmazonTaxCodeRow,
} from '../amazon-connection-config';
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
  const region = isAmazonRegion(config.region) ? config.region : 'eu';
  const singleMarketplace = isSingleMarketplaceRegion(region);
  const environment = config.environment === 'sandbox' ? 'sandbox' : 'production';
  const ordersEnabled = connection.enabledCapabilities.includes('OrderSource');
  const offersEnabled = connection.enabledCapabilities.includes('OfferManager');
  const catalogueEnabled = connection.enabledCapabilities.includes('ProductMaster');

  const taxRows = parseTaxCodeRows(form.watch('amazonTaxCodeRates') ?? '');
  const writeTaxRows = (rows: readonly AmazonTaxCodeRow[]): void =>
    syncStructuredToJson('amazonTaxCodeRates', formatTaxCodeRows(rows));
  const editTaxRow = (index: number, change: Partial<AmazonTaxCodeRow>): void =>
    writeTaxRows(taxRows.map((row, at) => (at === index ? { ...row, ...change } : row)));

  const selected = splitMarketplaceIds(form.watch('amazonMarketplaceIds') ?? '');
  const offered = marketplacesForRegion(region);
  // A stored id outside the offered list (a marketplace this browser does not
  // know, or one of another region) stays visible so it can be unticked.
  const unlisted = selected.filter((id) => !offered.some((marketplace) => marketplace.id === id));

  const countryName = (country: string): string =>
    countries[country as keyof typeof countries] ?? country;

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
        <Input value={messages.setup.regions[region]} disabled />
      </FormField>
      {environment === 'sandbox' ? (
        <Alert tone="warning" density="compact">
          {messages.setup.sandboxNotice}
        </Alert>
      ) : null}

      <FormField
        label={copy.marketplaces.label}
        name="amazonMarketplaceIds"
        description={`${singleMarketplace ? copy.marketplaces.descriptionSingle : copy.marketplaces.description} ${copy.marketplaces.addedNote}`}
        error={errors.amazonMarketplaceIds?.message}
      >
        <AmazonMarketplacePicker
          marketplaces={offered}
          selected={selected}
          extra={unlisted.map((id) => ({ id, label: unlistedLabel(id) }))}
          onChange={(ids) => syncStructuredToJson('amazonMarketplaceIds', ids.join(','))}
          labelOf={(marketplace) =>
            interpolate(messages.setup.marketplaceOption, {
              country: countryName(marketplace.country),
              currency: marketplace.currency,
            })
          }
          placeholder={copy.marketplaces.placeholder}
          disabled={disabled}
          invalid={Boolean(errors.amazonMarketplaceIds)}
          single={singleMarketplace}
        />
      </FormField>

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

      {catalogueEnabled || offersEnabled ? (
        <fieldset className="form-field amazon-tax-codes">
          <legend className="form-field__label">{copy.taxCodes.label}</legend>
          <p className="form-field__description">{copy.taxCodes.description}</p>
          {taxRows.length === 0 ? <p className="form-field__description">{copy.taxCodes.empty}</p> : null}
          {taxRows.map((row, index) => (
            <div key={index} className="amazon-tax-codes__row">
              <Input
                className="mono-text"
                aria-label={copy.taxCodes.code}
                value={row.code}
                onChange={(event) => editTaxRow(index, { code: event.target.value.toUpperCase() })}
                placeholder="A_GEN_STANDARD"
                disabled={disabled}
              />
              <Input
                aria-label={copy.taxCodes.rate}
                value={row.rate}
                onChange={(event) => editTaxRow(index, { rate: event.target.value })}
                placeholder="23"
                disabled={disabled}
                className="amazon-tax-codes__rate"
              />
              <Button
                type="button"
                tone="ghost"
                onClick={() => writeTaxRows(taxRows.filter((_, at) => at !== index))}
                disabled={disabled}
                aria-label={interpolate(copy.taxCodes.remove, { code: row.code })}
              >
                ×
              </Button>
            </div>
          ))}
          <Button
            type="button"
            tone="secondary"
            onClick={() => writeTaxRows([...taxRows, { code: '', rate: '' }])}
            disabled={disabled}
          >
            {copy.taxCodes.add}
          </Button>
          {errors.amazonTaxCodeRates ? (
            <p className="form-field__error" role="alert">
              {errors.amazonTaxCodeRates.message}
            </p>
          ) : null}
        </fieldset>
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
