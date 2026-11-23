/**
 * EmpikBulkConfigSection
 *
 * Empik's part of the bulk offer config step (#4278): the lead time and the
 * logistic class every new Empik offer needs. Both are seeded from the
 * connection's `offerDefaults` and written into the form's `platformParams`,
 * which the backend reads before falling back to the same defaults.
 *
 * Registered via the Empik plugin's `platform.bulkOfferConfigSection` slot.
 * Content-only (no Dialog).
 *
 * @module features/listings/components/empik
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';

import { interpolate, useMessages } from '../../../../shared/i18n';
import { usePlatforms, type BulkOfferConfigSectionProps } from '../../../../shared/plugins';
import { FormField } from '../../../../shared/ui/form-field';
import { Input } from '../../../../shared/ui/input';
import { resolvePlatformLabel } from '../../../mappings';
import {
  EMPIK_MAX_LEAD_TIME_DAYS,
  isValidEmpikLeadTime,
  readEmpikConnectionOfferDefaults,
  readEmpikOfferSettings,
} from './empik-offer-settings';

export function EmpikBulkConfigSection({
  connection,
  form,
}: BulkOfferConfigSectionProps): ReactElement {
  const copy = useMessages('listings').empikBulkConfigSection;
  const platformName = resolvePlatformLabel(usePlatforms(), connection);
  const defaults = useMemo(
    () => readEmpikConnectionOfferDefaults(connection.config),
    [connection.config]
  );
  const settings = readEmpikOfferSettings(form.watch('platformParams'));
  const [leadDraft, setLeadDraft] = useState<string | null>(null);

  // Seed the batch with the connection's defaults once per connection, without
  // overwriting a value the operator already chose.
  useEffect(() => {
    const current = form.getValues('platformParams');
    const existing = readEmpikOfferSettings(current);
    form.setValue(
      'platformParams',
      {
        ...current,
        ...(existing.leadTimeToShip === undefined &&
          defaults.leadTimeToShip !== undefined && { leadTimeToShip: defaults.leadTimeToShip }),
        ...(existing.logisticClass === undefined &&
          defaults.logisticClass !== undefined && { logisticClass: defaults.logisticClass }),
      },
      { shouldDirty: false }
    );
    if (form.getValues('currency') !== 'PLN') {
      form.setValue('currency', 'PLN', { shouldDirty: false });
    }
  }, [connection.id, defaults, form]);

  const write = (patch: Record<string, unknown>): void => {
    form.setValue(
      'platformParams',
      { ...form.getValues('platformParams'), ...patch },
      { shouldDirty: true }
    );
  };

  const leadValue = leadDraft ?? settings.leadTimeToShip?.toString() ?? '';
  const leadInvalid =
    leadDraft !== null && leadDraft.trim() !== '' && !isValidEmpikLeadTime(Number(leadDraft));

  return (
    <div className="bulk-config__platform-section">
      <FormField
        name="empik-lead-time"
        label={copy.leadTime.label}
        description={interpolate(copy.leadTime.description, {
          platform: platformName,
          max: EMPIK_MAX_LEAD_TIME_DAYS,
        })}
        error={
          leadInvalid
            ? interpolate(copy.leadTime.invalid, { max: EMPIK_MAX_LEAD_TIME_DAYS })
            : undefined
        }
      >
        <Input
          type="number"
          min={0}
          max={EMPIK_MAX_LEAD_TIME_DAYS}
          value={leadValue}
          onChange={(event) => {
            const raw = event.target.value;
            setLeadDraft(raw);
            const next = Number(raw);
            if (raw.trim() !== '' && isValidEmpikLeadTime(next)) {
              write({ leadTimeToShip: next });
            }
          }}
          onBlur={() => setLeadDraft(null)}
        />
      </FormField>
      <FormField
        name="empik-logistic-class"
        label={copy.logisticClass.label}
        description={interpolate(copy.logisticClass.description, { platform: platformName })}
      >
        <Input
          value={settings.logisticClass ?? ''}
          onChange={(event) => write({ logisticClass: event.target.value })}
        />
      </FormField>
      <p className="erli-config__note">
        {[
          interpolate(copy.note.existingCards, { platform: platformName }),
          copy.note.currency,
        ].join(' ')}
      </p>
    </div>
  );
}
