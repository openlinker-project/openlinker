/**
 * Subiekt Structured Section (#759)
 *
 * Plugin-owned structured-config inputs rendered inside `EditConnectionForm`
 * when the connection's `platformType` is `'subiekt'`. Carries:
 *
 *   - Bridge URL  → flat `config.subiektBridgeUrl` (synced via syncStructuredToJson)
 *   - Trigger Model dropdown (AC-2) → NESTED `config.invoicing.triggerModel`
 *     (synced via syncStructuredToJson — the host's nested merge handler
 *     routes the `subiektTriggerModel` form field to the nested path)
 *   - Capability toggles → whole-object `config.capabilities` via
 *     `CapabilityTogglesSection` (adapter-provided labels, AC-8)
 *
 * Connection-test is NOT here — the generic `ConnectionActionsPanel` on the
 * detail page already exposes Test for every connection (Decision 8).
 *
 * @module plugins/subiekt/components
 */
import type { ReactElement } from 'react';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import { useTranslation } from '../../../shared/i18n';
import { usePlatform } from '../../../shared/plugins';
import { CapabilityTogglesSection } from '../../../features/connections';
import type { StructuredConfigSectionProps } from '../../../shared/plugins';
import {
  SUBIEKT_TRIGGER_MODELS,
  SUBIEKT_TRIGGER_MODEL_LABELS,
} from '../subiekt-capability-descriptors';

export function SubiektStructuredSection({
  connection,
  form,
  configIsParseable,
  syncStructuredToJson,
  syncObjectToJson,
}: StructuredConfigSectionProps): ReactElement {
  const { t } = useTranslation();
  const plugin = usePlatform(connection.platformType);
  const descriptors = plugin?.capabilityDescriptors ?? {};

  return (
    <>
      <FormField
        label={t('subiekt.settings.bridgeUrl.label', 'Bridge URL')}
        name="subiektBridgeUrl"
        error={form.formState.errors.subiektBridgeUrl?.message}
      >
        <Input
          value={form.watch('subiektBridgeUrl') ?? ''}
          onChange={(event) => syncStructuredToJson('subiektBridgeUrl', event.target.value)}
          placeholder="https://localhost:5005"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.subiektBridgeUrl)}
        />
      </FormField>

      <FormField
        label={t('subiekt.settings.triggerModel.label', 'Invoice trigger')}
        name="subiektTriggerModel"
        error={form.formState.errors.subiektTriggerModel?.message}
      >
        <Select
          value={form.watch('subiektTriggerModel') ?? ''}
          onChange={(event) => syncStructuredToJson('subiektTriggerModel', event.target.value)}
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.subiektTriggerModel)}
        >
          <option value="">{t('subiekt.settings.triggerModel.unset', 'Not set')}</option>
          {SUBIEKT_TRIGGER_MODELS.map((model) => (
            <option key={model} value={model}>
              {t(`subiekt.settings.triggerModel.${model}`, SUBIEKT_TRIGGER_MODEL_LABELS[model])}
            </option>
          ))}
        </Select>
      </FormField>

      <CapabilityTogglesSection
        descriptors={descriptors}
        form={form}
        configIsParseable={configIsParseable}
        syncObjectToJson={syncObjectToJson}
      />
    </>
  );
}
