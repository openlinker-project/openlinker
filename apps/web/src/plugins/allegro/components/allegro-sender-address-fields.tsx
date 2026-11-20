/**
 * Allegro Sender Address Fields
 *
 * Structured inputs for `config.senderAddress`, the ship-from contact Allegro
 * Delivery requires on every create-command. Reuses the host's whole-object
 * `inpostSenderAddress` form field (same shape, same `config.senderAddress`
 * key) and its serializer seam, so no second merge path exists; the field name
 * is InPost-prefixed for historical reasons only.
 *
 * @module plugins/allegro/components
 */
import type { ReactElement } from 'react';
import type { UseFormReturn } from 'react-hook-form';

import type { EditConnectionFormValues } from '../../../features/connections';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { useAllegroMessages } from '../messages';

type SenderPath =
  | 'company'
  | 'name'
  | 'email'
  | 'phone'
  | 'address.street'
  | 'address.buildingNumber'
  | 'address.city'
  | 'address.postCode'
  | 'address.countryCode';

interface AllegroSenderAddressFieldsProps {
  form: UseFormReturn<EditConnectionFormValues>;
  configIsParseable: boolean;
  onChange?: () => void;
}

export function AllegroSenderAddressFields({
  form,
  configIsParseable,
  onChange,
}: AllegroSenderAddressFieldsProps): ReactElement {
  const copy = useAllegroMessages().allegroExtraSection.sender;
  const errors = form.formState.errors.inpostSenderAddress;

  const fields: Array<{
    path: SenderPath;
    label: string;
    placeholder?: string;
    description?: string;
    error?: string;
    mono?: boolean;
    maxLength?: number;
  }> = [
    { path: 'company', label: copy.company.label, error: errors?.company?.message },
    { path: 'name', label: copy.name.label, placeholder: copy.name.placeholder, error: errors?.name?.message },
    { path: 'email', label: copy.email.label, placeholder: copy.email.placeholder, error: errors?.email?.message },
    { path: 'phone', label: copy.phone.label, placeholder: copy.phone.placeholder, error: errors?.phone?.message },
    { path: 'address.street', label: copy.street.label, placeholder: copy.street.placeholder, error: errors?.address?.street?.message },
    { path: 'address.buildingNumber', label: copy.buildingNumber.label, error: errors?.address?.buildingNumber?.message },
    { path: 'address.city', label: copy.city.label, placeholder: copy.city.placeholder, error: errors?.address?.city?.message },
    { path: 'address.postCode', label: copy.postCode.label, description: copy.postCode.description, placeholder: '00-001', error: errors?.address?.postCode?.message, mono: true },
    { path: 'address.countryCode', label: copy.countryCode.label, description: copy.countryCode.description, placeholder: 'PL', error: errors?.address?.countryCode?.message, mono: true, maxLength: 2 },
  ];

  return (
    <section aria-labelledby="allegro-sender-address-heading">
      <h3 id="allegro-sender-address-heading" className="detail-section__title">
        {copy.title}
      </h3>
      <p>{copy.description}</p>
      {fields.map((field) => {
        const name = `inpostSenderAddress.${field.path}` as const;
        return (
          <FormField
            key={field.path}
            label={field.label}
            name={name}
            error={field.error}
            description={field.description}
          >
            <Input
              {...form.register(name)}
              className={field.mono ? 'mono-text' : undefined}
              maxLength={field.maxLength}
              onChange={(event) => {
                form.setValue(name, event.target.value, { shouldDirty: true });
                onChange?.();
              }}
              placeholder={field.placeholder}
              disabled={!configIsParseable}
              invalid={Boolean(field.error)}
            />
          </FormField>
        );
      })}
    </section>
  );
}
