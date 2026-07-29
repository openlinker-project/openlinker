/**
 * Product Events Section
 *
 * The "Product events" block inside `PosthogSettingsDialog`: a master toggle
 * independent of autocapture, an Event-groups panel whose toggles are
 * derived from `DemoEventCatalog` (never hand-maintained — a new group in
 * code appears here with zero edits to this file), and a read-only catalog
 * view for marketing/ops visibility into what each event measures.
 *
 * @module apps/web/src/features/posthog-settings/components
 */
import type { ReactElement } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { DemoEventCatalog, type DemoEventGroup } from '../../demo';
import { Alert } from '../../../shared/ui/alert';
import { deriveEventGroups } from '../lib/derive-event-groups';
import type { PosthogSettingsFormValues } from './posthog-settings-form.schema';

interface ProductEventsSectionProps {
  form: UseFormReturn<PosthogSettingsFormValues>;
  /** True when the PostHog master toggle or the Product-events master toggle is off. */
  disabled: boolean;
}

const EVENT_GROUPS = deriveEventGroups(DemoEventCatalog);

export function ProductEventsSection({ form, disabled }: ProductEventsSectionProps): ReactElement {
  const enabledEventGroups = form.watch('enabledEventGroups');

  const toggleGroup = (group: DemoEventGroup, checked: boolean): void => {
    const next = checked
      ? [...enabledEventGroups, group]
      : enabledEventGroups.filter((value) => value !== group);
    form.setValue('enabledEventGroups', next, { shouldDirty: true });
  };

  return (
    <div className="posthog-settings-product-events">
      <label className="posthog-settings-checkbox">
        <input type="checkbox" {...form.register('productEventsEnabled')} />
        <span>Product events</span>
      </label>
      <p className="muted-text posthog-settings-hint">
        Runs independently of autocapture — named business events for cleaner marketing funnels.
      </p>

      <Alert tone="info" title="Separate from the marketing site">
        openlinker.io uses its own PostHog project — this panel only controls in-app demo events.
      </Alert>

      <div
        className="posthog-settings-event-groups"
        aria-disabled={disabled}
        data-disabled={disabled ? 'true' : undefined}
      >
        <h4 className="posthog-settings-event-groups__title">Event groups</h4>
        {EVENT_GROUPS.length === 0 ? (
          <p className="muted-text">No event groups are defined yet.</p>
        ) : (
          EVENT_GROUPS.map((group) => (
            <label key={group} className="posthog-settings-checkbox">
              <input
                type="checkbox"
                disabled={disabled}
                checked={enabledEventGroups.includes(group)}
                onChange={(event) => toggleGroup(group, event.target.checked)}
              />
              <span>{group}</span>
            </label>
          ))
        )}
      </div>

      <div className="posthog-settings-event-catalog">
        <h4 className="posthog-settings-event-catalog__title">Event catalog (read-only)</h4>
        {Object.entries(DemoEventCatalog).map(([name, entry]) => (
          <div key={name} className="posthog-settings-event-catalog__row">
            <span className="mono-text posthog-settings-event-catalog__name">{name}</span>
            <span className="context-chip context-chip--neutral">{entry.group}</span>
            <p className="muted-text posthog-settings-event-catalog__description">
              {entry.description}
            </p>
            <span className="mono-text posthog-settings-event-catalog__props">
              props: {Object.keys(entry.props).join(', ') || '(none)'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
