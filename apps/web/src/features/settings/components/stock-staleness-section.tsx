/**
 * Stock Staleness Section (#3621)
 *
 * The one knob behind the stock view's "Stale" flag: how many hours a stock
 * observation may age before the view says the figure may have drifted. A
 * hygiene setting like job retention, so it is a self-contained panel with its
 * own save rather than part of the sweep-pacing form.
 *
 * @module apps/web/src/features/settings/components
 */
import { useEffect, useState, type ReactElement } from 'react';
import { Button } from '../../../shared/ui/button';
import { useToast } from '../../../shared/ui/toast-provider';
import type { OperationalSettingsView } from '../api/operational-settings.types';
import { useUpdateOperationalSettingsMutation } from '../hooks/use-update-operational-settings-mutation';
import {
  mapOperationalSettingsErrors,
  NO_OPERATIONAL_SETTINGS_ERRORS,
} from '../lib/map-operational-settings-errors';
import { limitsFor } from '../lib/resolve-value-limits';
import { PacingValueField } from './pacing-value-field';
import { useMessages } from '../../../shared/i18n';

interface StockStalenessSectionProps {
  view: OperationalSettingsView;
}

export function StockStalenessSection({ view }: StockStalenessSectionProps): ReactElement {
  const mutation = useUpdateOperationalSettingsMutation();
  const { showToast } = useToast();
  const saved = view.stockStaleSyncThresholdHours;
  const [value, setValue] = useState<number>(saved.value);
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    setValue(saved.value);
  }, [saved.value, saved.source]);

  const errors = mutation.error
    ? mapOperationalSettingsErrors(mutation.error)
    : NO_OPERATIONAL_SETTINGS_ERRORS;
  const limits = limitsFor(view, 'stockStaleSyncThresholdHours');
  const changed = value !== saved.value;
  const copy = useMessages('settings').stockStalenessSection;

  return (
    <section
      className="panel pacing-card"
      id="pacing-stock-staleness"
      aria-labelledby="pacing-stock-staleness-title"
    >
      <header className="pacing-card__header">
        <div>
          <p className="eyebrow">{copy.eyebrow}</p>
          <h3 className="section-title" id="pacing-stock-staleness-title">
            {copy.title}          </h3>
        </div>
        <span className="panel__meta">{copy.savedOnItsOwn}</span>
      </header>

      <div className="pacing-card__fields">
        <PacingValueField
          label={copy.field.label}
          ariaLabel={copy.field.ariaLabel}
          description={copy.field.description}
          value={value}
          limits={limits}
          step={1}
          unit={copy.unitHours}
          savedValue={saved.value}
          savedSource={saved.source}
          savedAboveRecommended={saved.aboveRecommended === true}
          acknowledged={acknowledged}
          onAcknowledgedChange={setAcknowledged}
          error={errors.fieldErrors.stockStaleSyncThresholdHours}
          onChange={setValue}
        />
      </div>

      {errors.formErrors.length > 0 ? (
        <p className="form-field__error" role="alert">
          {errors.formErrors.join(' ')}
        </p>
      ) : null}

      {changed ? (
        <div className="pacing-save">
          <Button tone="secondary" onClick={() => setValue(saved.value)}>
            {copy.reset}          </Button>
          <Button
            disabled={mutation.isPending}
            onClick={() => {
              mutation.mutate(
                {
                  stockStaleSyncThresholdHours: value,
                  ...(acknowledged ? { acknowledgeAboveRecommended: true } : {}),
                },
                {
                  onSuccess: () => {
                    showToast({
                      tone: 'success',
                      title: copy.savedToast.title,
                      description: copy.savedToast.description,
                    });
                  },
                }
              );
            }}
          >
            {copy.save}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
