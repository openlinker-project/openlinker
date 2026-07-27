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
import { useTranslation } from '../../../shared/i18n';
import type { StructuredConfigSectionProps } from '../../../shared/plugins';

export function InpostStructuredSection({
  form,
  configIsParseable,
  syncStructuredToJson,
  syncInpostSenderAddressToJson,
}: StructuredConfigSectionProps): ReactElement {
  const { t } = useTranslation();

  // Re-serialize the whole sender address after writing a single nested field.
  // Gated on the host serializer being threaded in (always is, today) and on
  // `configIsParseable` (the host serializer also early-returns when false).
  function onSenderAddressChange(): void {
    syncInpostSenderAddressToJson?.();
  }

  return (
    <>
      <FormField
        label={t('inpost.settings.environment.label', 'Environment')}
        name="inpostEnvironment"
        error={form.formState.errors.inpostEnvironment?.message}
        description={t(
          'inpost.settings.environment.description',
          'ShipX target environment. Use Sandbox to verify before switching to Production.',
        )}
      >
        <Select
          value={form.watch('inpostEnvironment') ?? ''}
          onChange={(event) => syncStructuredToJson('inpostEnvironment', event.target.value)}
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.inpostEnvironment)}
        >
          <option value="">{t('inpost.settings.environment.unset', '— not set —')}</option>
          <option value="sandbox">{t('inpost.settings.environment.sandbox', 'Sandbox')}</option>
          <option value="production">
            {t('inpost.settings.environment.production', 'Production')}
          </option>
        </Select>
      </FormField>

      <FormField
        label={t('inpost.settings.organizationId.label', 'Organization ID')}
        name="inpostOrganizationId"
        error={form.formState.errors.inpostOrganizationId?.message}
        description={t(
          'inpost.settings.organizationId.description',
          'ShipX organization id — a URL path parameter on every shipment endpoint.',
        )}
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
        label={t('inpost.settings.apiBaseUrl.label', 'OpenLinker public API base URL (optional)')}
        name="openlinkerCallbackBaseUrl"
        error={form.formState.errors.openlinkerCallbackBaseUrl?.message}
        description={t(
          'inpost.settings.apiBaseUrl.description',
          "OpenLinker's public API URL that serves inbound webhooks (POST /webhooks) — this is where InPost delivers tracking events, so it must be the API host, not this admin UI. Leave blank only when the API and this UI share one origin (e.g. behind a single reverse proxy); otherwise set the API's public base URL. Drives the webhook URL shown in the setup runbook below.",
        )}
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

      <FormField
        label={t('inpost.settings.sender.name.label', 'Sender name (optional)')}
        name="inpostSenderAddress.name"
        error={form.formState.errors.inpostSenderAddress?.name?.message}
      >
        <Input
          {...form.register('inpostSenderAddress.name')}
          onChange={(event) => {
            form.setValue('inpostSenderAddress.name', event.target.value, { shouldDirty: true });
            onSenderAddressChange();
          }}
          placeholder="Sklep ACME"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.inpostSenderAddress?.name)}
        />
      </FormField>

      <FormField
        label={t('inpost.settings.sender.email.label', 'Sender email')}
        name="inpostSenderAddress.email"
        error={form.formState.errors.inpostSenderAddress?.email?.message}
      >
        <Input
          {...form.register('inpostSenderAddress.email')}
          onChange={(event) => {
            form.setValue('inpostSenderAddress.email', event.target.value, { shouldDirty: true });
            onSenderAddressChange();
          }}
          placeholder="magazyn@acme.pl"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.inpostSenderAddress?.email)}
        />
      </FormField>

      <FormField
        label={t('inpost.settings.sender.phone.label', 'Sender phone')}
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
        label={t('inpost.settings.sender.street.label', 'Street')}
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
          placeholder="ul. Magazynowa"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.inpostSenderAddress?.address?.street)}
        />
      </FormField>

      <FormField
        label={t('inpost.settings.sender.buildingNumber.label', 'Building number')}
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
        label={t('inpost.settings.sender.city.label', 'City')}
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
          placeholder="Warszawa"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.inpostSenderAddress?.address?.city)}
        />
      </FormField>

      <FormField
        label={t('inpost.settings.sender.postCode.label', 'Postcode')}
        name="inpostSenderAddress.address.postCode"
        error={form.formState.errors.inpostSenderAddress?.address?.postCode?.message}
        description={t('inpost.settings.sender.postCode.description', 'PL format NN-NNN (e.g. 00-001).')}
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
        label={t('inpost.settings.sender.countryCode.label', 'Country')}
        name="inpostSenderAddress.address.countryCode"
        error={form.formState.errors.inpostSenderAddress?.address?.countryCode?.message}
        description={t('inpost.settings.sender.countryCode.description', 'ISO 3166-1 alpha-2 (e.g. PL).')}
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
