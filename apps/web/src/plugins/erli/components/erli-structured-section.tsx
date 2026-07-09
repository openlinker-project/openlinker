/**
 * Erli Structured Section
 *
 * Plugin-owned structured-config input rendered inside `EditConnectionForm`
 * when the connection's `platformType` is `'erli'`. Carries:
 *
 *   - Callback URL — `config.callbackBaseUrl`, the public OL URL Erli posts
 *     webhook events to (read by `ErliWebhookProvisioningAdapter`). Before
 *     this section existed, the field could only be set via the raw-JSON
 *     config block, which the "Configure webhooks" action's own hint text
 *     pointed operators at without a dedicated place to enter it (#1454
 *     follow-up UX gap, confirmed live during manual E2E testing of #1322).
 *
 * @module plugins/erli/components
 */
import type { ReactElement } from 'react';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import type { StructuredConfigSectionProps } from '../../../shared/plugins';

export function ErliStructuredSection({
  form,
  configIsParseable,
  syncStructuredToJson,
}: StructuredConfigSectionProps): ReactElement {
  return (
    <FormField
      label="Callback URL"
      name="callbackBaseUrl"
      error={form.formState.errors.callbackBaseUrl?.message}
      description="The public OpenLinker URL Erli posts webhook events to (e.g. https://api.example.com)."
    >
      <Input
        value={form.watch('callbackBaseUrl') ?? ''}
        onChange={(event) => syncStructuredToJson('callbackBaseUrl', event.target.value)}
        placeholder="https://api.example.com"
        disabled={!configIsParseable}
        invalid={Boolean(form.formState.errors.callbackBaseUrl)}
      />
    </FormField>
  );
}
