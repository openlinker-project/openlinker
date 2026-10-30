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

  return (
    <section
      className="panel pacing-card"
      id="pacing-stock-staleness"
      aria-labelledby="pacing-stock-staleness-title"
    >
      <header className="pacing-card__header">
        <div>
          <p className="eyebrow">Stock view</p>
          <h3 className="section-title" id="pacing-stock-staleness-title">
            Stale stock warning
          </h3>
        </div>
        <span className="panel__meta">saved on its own</span>
      </header>

      <div className="pacing-card__fields">
        <PacingValueField
          label="Flag stock as stale after"
          ariaLabel="Hours before a stock figure is flagged as stale"
          description="How long a stock figure may go without a fresh read from the master before the stock view marks it stale."
          value={value}
          limits={limits}
          step={1}
          unit="hours"
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
            Reset
          </Button>
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
                      title: 'Stale stock warning saved',
                      description: 'The stock view uses the new threshold straight away.',
                    });
                  },
                }
              );
            }}
          >
            Save threshold
          </Button>
        </div>
      ) : null}
    </section>
  );
}
