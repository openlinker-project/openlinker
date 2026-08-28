/**
 * Pacing Value Field
 *
 * One numeric setting: a slider paired with a number box, the effective value
 * with the rung that produced it, a visible description, an inline
 * changed-from marker, and a per-field server error.
 *
 * It does not use the shared `FormField`, which clones a SINGLE control and
 * owns its `id` / `aria-describedby`. This field is two controls bound to one
 * value, so the accessibility wiring is done here instead — same class names,
 * same tokens, one label pointing at the slider and the number box carrying
 * its own `aria-label`.
 *
 * The `source` text is rendered from what the server said, never from
 * comparing the value against a hardcoded default. A client-side comparison
 * is a second copy of the default and it is wrong the day the default moves.
 *
 * The description is visible text rather than a tooltip on purpose: an
 * operator who needs the tooltip does not know to hover.
 *
 * @module apps/web/src/features/settings/components
 */
import { useId, type ReactElement } from 'react';
import { Input } from '../../../shared/ui/input';
import type { OperationalSettingSource } from '../api/operational-settings.types';

interface PacingValueFieldProps {
  label: string;
  /**
   * Accessible name for both controls. Two panels legitimately carry the same
   * visible label ("Products per run"), so the name a screen reader — and a
   * test — reaches for has to say which one.
   */
  ariaLabel: string;
  description: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** The saved value, for the changed-from marker. */
  savedValue: number;
  /** The rung the SAVED value came from, as the server reported it. */
  savedSource: OperationalSettingSource;
  error?: string;
  onChange: (value: number) => void;
}

const SOURCE_SUFFIX: Record<OperationalSettingSource, string> = {
  setting: 'you set this',
  env: 'from a server setting',
  default: 'default',
};

export function PacingValueField({
  label,
  ariaLabel,
  description,
  value,
  min,
  max,
  step = 50,
  savedValue,
  savedSource,
  error,
  onChange,
}: PacingValueFieldProps): ReactElement {
  const id = useId();
  const sliderId = `${id}-slider`;
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;
  const changed = value !== savedValue;

  const handle = (raw: string): void => {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      onChange(Math.round(parsed));
    }
  };

  return (
    <div className="form-field">
      <label className="form-field__label form-field__label--split" htmlFor={sliderId}>
        {label}
        <span className="form-field__source" data-source={changed ? 'setting' : savedSource}>
          {changed
            ? `${String(value)} (not saved yet)`
            : `${String(savedValue)} (${SOURCE_SUFFIX[savedSource]})`}
        </span>
      </label>

      <div className="field-row">
        <input
          className="field-row__slider"
          id={sliderId}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-label={ariaLabel}
          aria-describedby={error ? `${descriptionId} ${errorId}` : descriptionId}
          onChange={(event) => {
            handle(event.target.value);
          }}
        />
        <Input
          className="control--narrow"
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          invalid={Boolean(error)}
          aria-label={ariaLabel}
          aria-describedby={error ? `${descriptionId} ${errorId}` : descriptionId}
          onChange={(event) => {
            handle(event.target.value);
          }}
        />
      </div>

      <p className="form-field__description" id={descriptionId}>
        {description}
      </p>

      {changed ? (
        <span className="field-changed">changed from {savedValue}</span>
      ) : null}

      {error ? (
        <p className="form-field__error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
