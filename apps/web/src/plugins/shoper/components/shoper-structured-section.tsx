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
import { ShoperOrderDefaultsSection } from './shoper-order-defaults-section';

export function ShoperStructuredSection({
  connection,
  form,
  configIsParseable,
  syncStructuredToJson,
}: StructuredConfigSectionProps): ReactElement {
  const orderSourceEnabled = connection.enabledCapabilities.includes('OrderSource');

  return (
    <>
      <FormField
        label="OL callback URL"
        name="openlinkerCallbackBaseUrl"
        error={form.formState.errors.openlinkerCallbackBaseUrl?.message}
        description="OpenLinker's public URL as Shoper can reach it. Shoper calls it when an order changes. Pre-filled from your browser; it must be reachable from the internet. Required for the 'Configure webhooks' action."
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
      {orderSourceEnabled ? null : (
        <Alert tone="warning" title="Order source is off">
          Webhooks only deliver orders when the Order source capability is enabled on this
          connection. Enable it first, then configure webhooks.
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
