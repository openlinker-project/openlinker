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
          <p className="eyebrow">Housekeeping</p>
          <h3 className="section-title" id="pacing-inventory-history-title">
            Stock history retention
          </h3>
        </div>
        <span className="panel__meta">saved on its own</span>
      </header>

      <div className="pacing-card__fields">
        <PacingValueField
          label="Stock history kept for"
          ariaLabel="Days stock movement history is kept"
          description="How long a stock movement (a sale, a return restock, a correction, a change found at a sync) stays in the history. Older rows are deleted in small batches."
          value={retention.days}
          limits={limitsFor(view, 'inventoryMovementRetentionDays')}
          step={RETENTION_STEP_DAYS}
          unit="days"
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

      {retention.changed ? (
        <div className="pacing-save pacing-save--inline" data-dirty="true">
          <div className="pacing-save__text">
            <p className="pacing-save__count">Stock history retention changed</p>
            <p className="pacing-save__status">Saves on its own, no confirmation.</p>
          </div>
          <div className="pacing-save__actions">
            <Button tone="secondary" onClick={retention.reset}>
              Undo
            </Button>
            <Button
              disabled={retention.saving || retention.needsAcknowledgement}
              onClick={retention.save}
            >
              Save history retention
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
