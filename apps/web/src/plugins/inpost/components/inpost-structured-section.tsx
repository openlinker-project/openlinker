/**
 * InPost Structured Section (#771)
 *
 * Plugin-owned structured-config inputs rendered inside `EditConnectionForm`
 * when the connection's `platformType` is `'inpost'`. Carries:
 *
 *   - Environment (sandbox / production) → flat `config.environment`
 *   - Organization id → flat `config.organizationId`
 *   - OpenLinker public API base URL → flat `config.openlinkerCallbackBaseUrl`
 *     (the host-generic callback field; used by the webhook runbook to build the
 *     inbound webhook URL InPost delivers to, #1473)
 *   - Sender address (name?, email, phone, street, building number, city,
 *     postcode, country) → whole-object `config.senderAddress`
 *
 * The two flat scalars sync through the host's per-field `syncStructuredToJson`
 * (the merge clauses map `inpostEnvironment`/`inpostOrganizationId` to the real
 * config keys). The nested sender address re-serializes via the host's
 * `syncInpostSenderAddressToJson` whole-object seam after each `setValue`,
 * mirroring the Allegro seller-defaults pattern.
 *
 * Credentials (the ShipX `apiToken`) are NOT here — they live in the dedicated
 * `InpostCredentialsPanel`. Connection-test is the generic `ConnectionActions`
 * Test button on the detail page (backed by the InPost connection tester).
 *
 * @module plugins/inpost/components
 */
import type { ReactElement } from 'react';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import type { StructuredConfigSectionProps } from '../../../shared/plugins';
import { useInpostMessages } from '../messages';

export function InpostStructuredSection({
  form,
  configIsParseable,
  syncStructuredToJson,
  syncInpostSenderAddressToJson,
}: StructuredConfigSectionProps): ReactElement {
  const copy = useInpostMessages().settings;

  // Re-serialize the whole sender address after writing a single nested field.
  // Gated on the host serializer being threaded in (always is, today) and on
  // `configIsParseable` (the host serializer also early-returns when false).
  function onSenderAddressChange(): void {
    syncInpostSenderAddressToJson?.();
  }

  return (
    <>
      <FormField
        label={copy.environment.label}
        name="inpostEnvironment"
        error={form.formState.errors.inpostEnvironment?.message}
        description={copy.environment.description}
      >
        <Select
          value={form.watch('inpostEnvironment') ?? ''}
          onChange={(event) => syncStructuredToJson('inpostEnvironment', event.target.value)}
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.inpostEnvironment)}
        >
          <option value="">{copy.environment.unset}</option>
          <option value="sandbox">{copy.environment.sandbox}</option>
          <option value="production">{copy.environment.production}</option>
        </Select>
      </FormField>

      <FormField
        label={copy.organizationId.label}
        name="inpostOrganizationId"
        error={form.formState.errors.inpostOrganizationId?.message}
        description={copy.organizationId.description}
      >
        <Input
          className="mono-text"
          value={form.watch('inpostOrganizationId') ?? ''}
          onChange={(event) => syncStructuredToJson('inpostOrganizationId', event.target.value)}
          placeholder="123456"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.inpostOrganizationId)}
        />
      </FormField>

      <FormField
        label={copy.apiBaseUrl.label}
        name="openlinkerCallbackBaseUrl"
        error={form.formState.errors.openlinkerCallbackBaseUrl?.message}
        description={copy.apiBaseUrl.description}
      >
        <Input
          value={form.watch('openlinkerCallbackBaseUrl') ?? ''}
          onChange={(event) =>
            syncStructuredToJson('openlinkerCallbackBaseUrl', event.target.value)
          }
          placeholder={copy.apiBaseUrl.placeholder}
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.openlinkerCallbackBaseUrl)}
        />
      </FormField>

      <FormField
        label={copy.sender.name.label}
        name="inpostSenderAddress.name"
        error={form.formState.errors.inpostSenderAddress?.name?.message}
      >
        <Input
          {...form.register('inpostSenderAddress.name')}
          onChange={(event) => {
            form.setValue('inpostSenderAddress.name', event.target.value, { shouldDirty: true });
            onSenderAddressChange();
          }}
          placeholder={copy.sender.name.placeholder}
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.inpostSenderAddress?.name)}
        />
      </FormField>

      <FormField
        label={copy.sender.email.label}
        name="inpostSenderAddress.email"
        error={form.formState.errors.inpostSenderAddress?.email?.message}
      >
        <Input
          {...form.register('inpostSenderAddress.email')}
          onChange={(event) => {
            form.setValue('inpostSenderAddress.email', event.target.value, { shouldDirty: true });
            onSenderAddressChange();
          }}
          placeholder={copy.sender.email.placeholder}
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.inpostSenderAddress?.email)}
        />
      </FormField>

      <FormField
        label={copy.sender.phone.label}
        name="inpostSenderAddress.phone"
        error={form.formState.errors.inpostSenderAddress?.phone?.message}
      >
        <Input
          {...form.register('inpostSenderAddress.phone')}
          className="mono-text"
          onChange={(event) => {
            form.setValue('inpostSenderAddress.phone', event.target.value, { shouldDirty: true });
            onSenderAddressChange();
          }}
          placeholder="+48111222333"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.inpostSenderAddress?.phone)}
        />
      </FormField>

      <FormField
        label={copy.sender.street.label}
        name="inpostSenderAddress.address.street"
        error={form.formState.errors.inpostSenderAddress?.address?.street?.message}
      >
        <Input
          {...form.register('inpostSenderAddress.address.street')}
          onChange={(event) => {
            form.setValue('inpostSenderAddress.address.street', event.target.value, {
              shouldDirty: true,
            });
            onSenderAddressChange();
          }}
          placeholder={copy.sender.street.placeholder}
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.inpostSenderAddress?.address?.street)}
        />
      </FormField>

      <FormField
        label={copy.sender.buildingNumber.label}
        name="inpostSenderAddress.address.buildingNumber"
        error={form.formState.errors.inpostSenderAddress?.address?.buildingNumber?.message}
      >
        <Input
          {...form.register('inpostSenderAddress.address.buildingNumber')}
          className="mono-text"
          onChange={(event) => {
            form.setValue('inpostSenderAddress.address.buildingNumber', event.target.value, {
              shouldDirty: true,
            });
            onSenderAddressChange();
          }}
          placeholder="1"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.inpostSenderAddress?.address?.buildingNumber)}
        />
      </FormField>

      <FormField
        label={copy.sender.city.label}
        name="inpostSenderAddress.address.city"
        error={form.formState.errors.inpostSenderAddress?.address?.city?.message}
      >
        <Input
          {...form.register('inpostSenderAddress.address.city')}
          onChange={(event) => {
            form.setValue('inpostSenderAddress.address.city', event.target.value, {
              shouldDirty: true,
            });
            onSenderAddressChange();
          }}
          placeholder={copy.sender.city.placeholder}
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.inpostSenderAddress?.address?.city)}
        />
      </FormField>

      <FormField
        label={copy.sender.postCode.label}
        name="inpostSenderAddress.address.postCode"
        error={form.formState.errors.inpostSenderAddress?.address?.postCode?.message}
        description={copy.sender.postCode.description}
      >
        <Input
          {...form.register('inpostSenderAddress.address.postCode')}
          className="mono-text"
          onChange={(event) => {
            form.setValue('inpostSenderAddress.address.postCode', event.target.value, {
              shouldDirty: true,
            });
            onSenderAddressChange();
          }}
          placeholder="00-001"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.inpostSenderAddress?.address?.postCode)}
        />
      </FormField>

      <FormField
        label={copy.sender.countryCode.label}
        name="inpostSenderAddress.address.countryCode"
        error={form.formState.errors.inpostSenderAddress?.address?.countryCode?.message}
        description={copy.sender.countryCode.description}
      >
        <Input
          {...form.register('inpostSenderAddress.address.countryCode')}
          className="mono-text"
          maxLength={2}
          onChange={(event) => {
            form.setValue('inpostSenderAddress.address.countryCode', event.target.value, {
              shouldDirty: true,
            });
            onSenderAddressChange();
          }}
          placeholder="PL"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.inpostSenderAddress?.address?.countryCode)}
        />
      </FormField>
    </>
  );
}
