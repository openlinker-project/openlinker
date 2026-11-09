/**
 * Inventory Movement Retention Section (#3565)
 *
 * How long stock movement history is kept - housekeeping, so a separate panel
 * beside the job-retention one and saved on its own. Presentational: the draft
 * and its save live in `useInventoryMovementRetentionDraft`, owned by the page.
 *
 * @module apps/web/src/features/settings/components
 */
import type { ReactElement } from 'react';
import { Button } from '../../../shared/ui/button';
import type { OperationalSettingsView } from '../api/operational-settings.types';
import type { InventoryMovementRetentionDraft } from '../hooks/use-inventory-movement-retention-draft';
import { limitsFor } from '../lib/resolve-value-limits';
import { PacingValueField } from './pacing-value-field';
import { useMessages } from '../../../shared/i18n';

/** Days are dragged in fives; any whole day can still be typed. */
const RETENTION_STEP_DAYS = 5;

interface InventoryMovementRetentionSectionProps {
  view: OperationalSettingsView;
  retention: InventoryMovementRetentionDraft;
}

export function InventoryMovementRetentionSection({
  view,
  retention,
}: InventoryMovementRetentionSectionProps): ReactElement | null {
  const copy = useMessages('settings').inventoryMovementRetentionSection;
  const setting = view.inventoryMovementRetentionDays;
  if (setting === undefined || retention.days === null) {
    return null;
  }

  return (
    <section
      className="panel pacing-card"
      id="pacing-inventory-history"
      aria-labelledby="pacing-inventory-history-title"
    >
      <header className="pacing-card__header">
        <div>
          <p className="eyebrow">{copy.eyebrow}</p>
          <h3 className="section-title" id="pacing-inventory-history-title">
            {copy.title}          </h3>
        </div>
        <span className="panel__meta">{copy.savedOnItsOwn}</span>
      </header>

      <div className="pacing-card__fields">
        <PacingValueField
          label={copy.field.label}
          ariaLabel={copy.field.ariaLabel}
          description={copy.field.description}
          value={retention.days}
          limits={limitsFor(view, 'inventoryMovementRetentionDays')}
          step={RETENTION_STEP_DAYS}
          unit={copy.unitDays}
          savedValue={setting.value}
          savedSource={setting.source}
          savedAboveRecommended={setting.aboveRecommended === true}
          acknowledged={retention.acknowledged}
          onAcknowledgedChange={retention.setAcknowledged}
          error={retention.errors.fieldErrors.inventoryMovementRetentionDays}
          onChange={retention.setDays}
        />
      </div>

      {retention.errors.formErrors.length > 0 ? (
        <p className="form-field__error" role="alert">
          {retention.errors.formErrors.join(' ')}
        </p>
      ) : null}

      {setting.source === 'setting' ? (
        <div className="pacing-save__actions">
          <Button tone="secondary" disabled={retention.saving} onClick={retention.clear}>
            {copy.useDefault}
          </Button>
        </div>
      ) : null}

      {retention.changed ? (
        <div className="pacing-save pacing-save--inline" data-dirty="true">
          <div className="pacing-save__text">
            <p className="pacing-save__count">{copy.changed}</p>
            <p className="pacing-save__status">{copy.savesOnItsOwn}</p>
          </div>
          <div className="pacing-save__actions">
            <Button tone="secondary" onClick={retention.reset}>
              {copy.undo}            </Button>
            <Button
              disabled={retention.saving || retention.needsAcknowledgement}
              onClick={retention.save}
            >
              {copy.save}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
