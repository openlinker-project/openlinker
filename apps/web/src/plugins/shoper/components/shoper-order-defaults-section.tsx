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

const FIELD_COPY = {
  shoperShippingId: {
    label: 'Default delivery method',
    description:
      'Used when an order\'s delivery method has no mapping. Shoper requires one to create the order.',
  },
  shoperPaymentId: {
    label: 'Default payment method',
    description:
      'Shoper requires a payment method and OpenLinker has no payment mapping, so this is the one used for every order.',
  },
  shoperStatusId: {
    label: 'Default order status',
    description:
      "Used when the order's status has no mapping. Pick the status new orders should start in.",
  },
  shoperParcelShippingId: {
    label: 'Delivery method for shipments',
    description:
      'Recorded on the parcel when OpenLinker marks an order as shipped. Shoper refuses parcels for ' +
      'carrier-integrated methods (InPost, DPD, ...), so pick a plain one. Not set: the order\'s own method ' +
      'if Shoper accepts it, otherwise the first plain method in the shop.',
  },
  shoperCancelledStatusId: {
    label: 'Status for cancelled orders',
    description:
      'The status an order moves to when OpenLinker cancels it in the shop. Not set: the first active ' +
      'cancelled-type status.',
  },
  shoperInProgressStatusId: {
    label: 'Status for orders in progress',
    description:
      'The status an order moves to when OpenLinker reports it in progress. Not set: the first active ' +
      'in-progress status.',
  },
} as const;

export function ShoperOrderDefaultsSection({
  connection,
  form,
  configIsParseable,
  syncStructuredToJson,
}: StructuredConfigSectionProps): ReactElement {
  const receivesOrders = connection.enabledCapabilities.includes('OrderProcessorManager');
  const { options, isLoading, errors } = useMappingOptions(
    receivesOrders ? connection.id : '',
    ENABLED_KEYS,
  );

  if (!receivesOrders) {
    return (
      <Alert tone="info" title="Order defaults">
        Delivery, payment and status defaults are needed only when this shop receives orders.
        Enable the Order processor capability to set them.
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
        const copy = FIELD_COPY[field];

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
                <option>Loading from Shoper…</option>
              </Select>
            ) : loadError ? (
              <Select disabled>
                <option>Could not load the list from Shoper</option>
              </Select>
            ) : (
              <Select
                value={value}
                onChange={(event) => syncStructuredToJson(field, event.target.value)}
                disabled={!configIsParseable}
                invalid={Boolean(errorMessage)}
              >
                <option value="">Not set</option>
                {stored ? <option value={value}>{`Saved id ${value} (not in the shop's list)`}</option> : null}
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
