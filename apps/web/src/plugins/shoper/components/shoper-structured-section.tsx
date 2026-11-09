/**
 * Shoper Structured Section
 *
 * Plugin-owned structured-config inputs rendered inside `EditConnectionForm`
 * for Shoper connections: the OL callback URL the webhook install flow
 * (#3644) registers with the shop (reusing the host-level
 * `openlinkerCallbackBaseUrl` field, exactly as PrestaShop does), followed by
 * the order defaults section (#3702).
 *
 * @module plugins/shoper/components
 */
import type { ReactElement } from 'react';
import { Alert } from '../../../shared/ui/alert';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import type { StructuredConfigSectionProps } from '../../../shared/plugins';
import { useShoperMessages } from '../messages';
import { ShoperOrderDefaultsSection } from './shoper-order-defaults-section';

export function ShoperStructuredSection({
  connection,
  form,
  configIsParseable,
  syncStructuredToJson,
}: StructuredConfigSectionProps): ReactElement {
  const copy = useShoperMessages().shoperStructuredSection;
  const webhookCapabilityEnabled =
    connection.enabledCapabilities.includes('OrderSource') ||
    connection.enabledCapabilities.includes('ProductMaster');

  return (
    <>
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
          placeholder="https://api.openlinker.example"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.openlinkerCallbackBaseUrl)}
        />
      </FormField>
      {webhookCapabilityEnabled ? null : (
        <Alert tone="warning" title={copy.noWebhookCapability.title}>
          {copy.noWebhookCapability.body}
        </Alert>
      )}
      <ShoperOrderDefaultsSection
        connection={connection}
        form={form}
        configIsParseable={configIsParseable}
        syncStructuredToJson={syncStructuredToJson}
      />
    </>
  );
}
