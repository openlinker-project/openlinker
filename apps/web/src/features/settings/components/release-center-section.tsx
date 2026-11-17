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
import { Toggle } from '../../../shared/ui/toggle';
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
      className="panel pacing-card"
      id="release-center-toggle"
      aria-labelledby="release-center-toggle-title"
    >
      <header className="pacing-card__header">
        <div>
          <p className="eyebrow">{copy.eyebrow}</p>
          <h3 className="section-title" id="release-center-toggle-title">
            {copy.title}
          </h3>
        </div>
        <span className="panel__meta">{copy.savedOnItsOwn}</span>
      </header>

      <div className="pacing-card__fields">
        <div className="pacing-field">
          <div className="pacing-field__head">
            <span className="form-field__label">{copy.field.label}</span>
            <Toggle
              checked={value}
              onChange={setValue}
              aria-label={copy.field.ariaLabel}
              data-testid="release-center-toggle"
            />
          </div>
          <p className="form-field__hint">{copy.field.description}</p>
          <p className="form-field__hint" data-testid="release-center-source">
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
        </div>
      </div>

      {mutation.error ? (
        <p className="form-field__error" role="alert">
          {copy.saveFailed}
        </p>
      ) : null}

      {changed ? (
        <div className="pacing-save">
          <Button tone="secondary" onClick={() => setValue(saved.value)}>
            {copy.reset}
          </Button>
          <Button disabled={mutation.isPending} onClick={() => save(value)}>
            {copy.save}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
