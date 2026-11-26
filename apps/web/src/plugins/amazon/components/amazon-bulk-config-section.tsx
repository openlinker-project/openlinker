/**
 * Amazon Bulk Config Section (#4186)
 *
 * The Amazon branch of the bulk offer wizard's settings step. Amazon lists an
 * offer on every marketplace of the connection that sells in the offer's
 * currency (`marketplacesForCurrency` on the API), so the batch currency is
 * the one choice this section owns: fixed when all marketplaces share one
 * currency, picked otherwise. It also says where the offers go and warns
 * when the merchant token offers need is missing.
 *
 * @module plugins/amazon/components
 */
import { useEffect, type ReactElement } from 'react';
import { findMarketplace } from '../../../features/amazon';
import { interpolate } from '../../../shared/i18n';
import type { BulkConfigFormValues, BulkOfferConfigSectionProps } from '../../../shared/plugins';
import { Alert } from '../../../shared/ui/alert';
import { FormField } from '../../../shared/ui/form-field';
import { Select } from '../../../shared/ui/select';
import { useAmazonMessages } from '../messages';

export function AmazonBulkConfigSection({ connection, form }: BulkOfferConfigSectionProps): ReactElement {
  const messages = useAmazonMessages();
  const copy = messages.bulk;
  const countries = messages.setup.countries;

  // The role-safe projection first: `config` is `{}` for every role but admin,
  // and an operator runs the bulk wizard too.
  const marketplaceIds = connection.publicConfig?.marketplaceIds ?? connection.config.marketplaceIds;
  const marketplaces = (Array.isArray(marketplaceIds) ? marketplaceIds : [])
    .filter((id): id is string => typeof id === 'string')
    .map((id) => findMarketplace(id))
    .filter((marketplace) => marketplace !== undefined);
  const currencies = [...new Set(marketplaces.map((marketplace) => marketplace.currency))];

  const watched = form.watch('currency');
  const currency = currencies.includes(watched) ? watched : (currencies[0] ?? '');

  // Seed the batch currency with the connection's; a currency no marketplace
  // of this connection sells in would list nothing.
  useEffect(() => {
    if (currency !== '' && form.getValues('currency') !== currency) {
      form.setValue('currency', currency, { shouldDirty: false });
    }
  }, [connection.id, currency, form]);

  const reached = marketplaces
    .filter((marketplace) => marketplace.currency === currency)
    .map((marketplace) => countries[marketplace.country as keyof typeof countries] ?? marketplace.country);
  const sellerIdValue = connection.publicConfig?.sellerId ?? connection.config.sellerId;
  const sellerId = typeof sellerIdValue === 'string' ? sellerIdValue.trim() : '';

  return (
    <div className="bulk-config__platform-section">
      {currencies.length > 1 ? (
        <FormField label={copy.currency.label} name="amazon-bulk-currency" description={copy.currency.description}>
          <Select
            value={currency}
            onChange={(event) => form.setValue('currency', event.target.value, { shouldDirty: true })}
          >
            {currencies.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </FormField>
      ) : null}
      {reached.length > 0 ? (
        <Alert tone="info" density="compact">
          {interpolate(copy.marketplaces, { countries: reached.join(', ') })}
        </Alert>
      ) : (
        <Alert tone="warning" density="compact">
          {copy.noMarketplace}
        </Alert>
      )}
      {sellerId === '' ? (
        <Alert tone="warning" density="compact">
          {messages.edit.sellerIdMissing}
        </Alert>
      ) : null}
    </div>
  );
}

/** Complete once a currency is set; the section seeds it from the connection. */
export function amazonBulkConfigIsComplete(values: BulkConfigFormValues): boolean {
  return values.currency.trim() !== '';
}
