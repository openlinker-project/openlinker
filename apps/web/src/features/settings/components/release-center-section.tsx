/**
 * Release Center Section (#4143)
 *
 * The on/off switch for the release center. A boolean with no bounds, so it
 * is its own panel with its own save rather than a numeric pacing field. The
 * panel reports which rung produced the value and offers the way back to
 * `.env` or the default only while a stored setting is what is in force.
 *
 * @module apps/web/src/features/settings/components
 */
import { useEffect, useState, type ReactElement } from 'react';
import { Button } from '../../../shared/ui/button';
import { useToast } from '../../../shared/ui/toast-provider';
import { useMessages } from '../../../shared/i18n';
import type { OperationalSettingsView } from '../api/operational-settings.types';
import { useUpdateOperationalSettingsMutation } from '../hooks/use-update-operational-settings-mutation';

interface ReleaseCenterSectionProps {
  view: OperationalSettingsView;
}

export function ReleaseCenterSection({ view }: ReleaseCenterSectionProps): ReactElement | null {
  const mutation = useUpdateOperationalSettingsMutation();
  const { showToast } = useToast();
  const copy = useMessages('settings').releaseCenterSection;
  const saved = view.releaseCenterEnabled;
  const [value, setValue] = useState<boolean>(saved?.value ?? true);

  useEffect(() => {
    if (saved) {
      setValue(saved.value);
    }
  }, [saved?.value, saved?.source]);

  if (!saved) {
    return null;
  }

  const changed = value !== saved.value;
  const save = (next: boolean | null): void => {
    mutation.mutate(
      { releaseCenterEnabled: next },
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
  };

  return (
    <section
      className="panel pacing-card release-settings"
      id="release-center-toggle"
      aria-labelledby="release-center-toggle-title"
    >
      <header className="release-settings__head">
        <h3 className="release-settings__title" id="release-center-toggle-title">
          {copy.title}
        </h3>
        <span className="release-chip release-chip--accent">{copy.newChip}</span>
      </header>
      <p className="release-settings__lead">{copy.lead}</p>

      <label className="check-row release-settings__check">
        <input
          type="checkbox"
          checked={value}
          onChange={(event) => setValue(event.target.checked)}
          aria-label={copy.field.ariaLabel}
          data-testid="release-center-toggle"
        />
        <span>
          {copy.field.label}
          <small>{copy.field.description}</small>
        </span>
      </label>
      <p className="release-settings__source" data-testid="release-center-source">
        {copy.sourceLine[saved.source]}
      </p>
      {saved.source === 'setting' ? (
        <button
          type="button"
          className="link-button"
          disabled={mutation.isPending}
          onClick={() => save(null)}
        >
          {copy.backToEnv}
        </button>
      ) : null}

      {mutation.error ? (
        <p className="form-field__error" role="alert">
          {copy.saveFailed}
        </p>
      ) : null}

      <div className="release-settings__actions">
        <Button disabled={!changed || mutation.isPending} onClick={() => save(value)}>
          {copy.save}
        </Button>
        {changed ? (
          <Button tone="secondary" onClick={() => setValue(saved.value)}>
            {copy.reset}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
