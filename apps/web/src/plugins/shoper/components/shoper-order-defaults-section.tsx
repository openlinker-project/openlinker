/**
 * Shoper Order Defaults Section (#3702)
 *
 * Structured-config inputs for the three ids Shoper requires to create an
 * order: delivery method, payment method and status. They are fallbacks - a
 * mapping (Mappings page) wins for delivery and status - but payment has no
 * mapping, so `paymentId` is the only source and a shop receiving orders cannot
 * work without it. Below them, the three optional ids the lifecycle writeback
 * uses (parcel delivery method, cancelled and in-progress status); each has a
 * fallback the adapter picks itself, so leaving them unset is fine.
 *
 * Each list is read live from the shop (`destination/carriers`,
 * `destination/payment-methods`, `destination/order-statuses`), so the operator
 * picks a NAME and never has to look up a number in Shoper's admin. The lists
 * need an enabled `OrderProcessorManager`; without it the section says so
 * instead of rendering controls that would only error.
 *
 * Every control is disabled while the raw JSON is unparseable, because the host
 * serializer early-returns in that state and an enabled control would silently
 * discard the edit.
 *
 * @module plugins/shoper/components
 */
import type { ReactElement } from 'react';
import { Alert } from '../../../shared/ui/alert';
import { FormField } from '../../../shared/ui/form-field';
import { Select } from '../../../shared/ui/select';
import { useMappingOptions } from '../../../features/mappings';
import type { MappingOption } from '../../../features/mappings';
import type { StructuredConfigSectionProps } from '../../../shared/plugins';
import { interpolate } from '../../../shared/i18n';
import { useShoperMessages } from '../messages';
import { SHOPER_DEFAULT_FIELDS } from '../shoper-connection-config';

type MappingBundle = ReturnType<typeof useMappingOptions>['options'];

/**
 * The hook's bundle keys carry the name of the platform each list was first
 * built for; the underlying endpoints are platform-neutral
 * (`destination/<kind>`), which is why a Shoper connection can use them.
 */
const BUNDLE_KEY_BY_FIELD = {
  shoperShippingId: 'prestashopCarriers',
  shoperPaymentId: 'prestashopPaymentModules',
  shoperStatusId: 'prestashopOrderStatuses',
  shoperParcelShippingId: 'prestashopCarriers',
  shoperCancelledStatusId: 'prestashopOrderStatuses',
  shoperInProgressStatusId: 'prestashopOrderStatuses',
} as const satisfies Record<
  (typeof SHOPER_DEFAULT_FIELDS)[number]['field'],
  keyof MappingBundle
>;

const ENABLED_KEYS: ReadonlySet<keyof MappingBundle> = new Set(Object.values(BUNDLE_KEY_BY_FIELD));

export function ShoperOrderDefaultsSection({
  connection,
  form,
  configIsParseable,
  syncStructuredToJson,
}: StructuredConfigSectionProps): ReactElement {
  const sectionCopy = useShoperMessages().shoperOrderDefaultsSection;
  const receivesOrders = connection.enabledCapabilities.includes('OrderProcessorManager');
  const { options, isLoading, errors } = useMappingOptions(
    receivesOrders ? connection.id : '',
    ENABLED_KEYS,
  );

  if (!receivesOrders) {
    return (
      <Alert tone="info" title={sectionCopy.notReceivingOrders.title}>
        {sectionCopy.notReceivingOrders.body}
      </Alert>
    );
  }

  return (
    <>
      {SHOPER_DEFAULT_FIELDS.map(({ field }) => {
        const bundleKey = BUNDLE_KEY_BY_FIELD[field];
        const list: MappingOption[] = options[bundleKey];
        const loadError = errors[bundleKey];
        const value = form.watch(field) ?? '';
        const errorMessage = form.formState.errors[field]?.message;
        const stored = value !== '' && !list.some((option) => option.value === value);
        const copy = sectionCopy.fields[field];

        return (
          <FormField
            key={field}
            label={copy.label}
            name={field}
            error={errorMessage}
            description={copy.description}
          >
            {isLoading ? (
              <Select disabled>
                <option>{sectionCopy.loading}</option>
              </Select>
            ) : loadError ? (
              <Select disabled>
                <option>{sectionCopy.loadFailed}</option>
              </Select>
            ) : (
              <Select
                value={value}
                onChange={(event) => syncStructuredToJson(field, event.target.value)}
                disabled={!configIsParseable}
                invalid={Boolean(errorMessage)}
              >
                <option value="">{sectionCopy.notSet}</option>
                {stored ? (
                  <option value={value}>{interpolate(sectionCopy.storedId, { id: value })}</option>
                ) : null}
                {list.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
        );
      })}
    </>
  );
}
