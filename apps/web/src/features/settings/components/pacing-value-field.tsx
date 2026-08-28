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
 * its own accessible name.
 *
 * The `source` text is rendered from what the server said, never from
 * comparing the value against a hardcoded default. A client-side comparison
 * is a second copy of the default and it is wrong the day the default moves.
 *
 * **The slider runs to the ABSOLUTE ceiling, not the recommended one.** The
 * recommendation is OpenLinker's judgement and an operator may exceed it on
 * their own hardware; a control that stopped at it would make the raised
 * ceiling unreachable, which is exactly what the two-ceiling shape exists to
 * allow. The recommendation is drawn on the track instead, so the operator
 * can see where they are crossing rather than discovering it on save.
 *
 * Past the recommendation the field shows the API's OWN reason and requires an
 * explicit acknowledgement. Two rules there are load-bearing: the sentence is
 * never copy written here (the page and the API would drift), and the
 * acknowledgement is never inferred from the value being high — inferring it
 * would turn the gate into a formality and there would be no point having it.
 *
 * The description is visible text rather than a tooltip on purpose: an
 * operator who needs the tooltip does not know to hover.
 *
 * @module apps/web/src/features/settings/components
 */
import { useId, type ReactElement } from 'react';
import { Alert } from '../../../shared/ui/alert';
import { Input } from '../../../shared/ui/input';
import type { OperationalSettingSource } from '../api/operational-settings.types';
import { isAboveRecommended, type ValueLimits } from '../lib/resolve-value-limits';

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
  limits: ValueLimits;
  step?: number;
  /** The saved value, for the changed-from marker. */
  savedValue: number;
  /** The rung the SAVED value came from, as the server reported it. */
  savedSource: OperationalSettingSource;
  /** The server's own `aboveRecommended` for the SAVED value. */
  savedAboveRecommended: boolean;
  error?: string;
  /** The operator has explicitly accepted going past the recommendation. */
  acknowledged: boolean;
  onAcknowledgedChange: (acknowledged: boolean) => void;
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
  limits,
  step = 50,
  savedValue,
  savedSource,
  savedAboveRecommended,
  error,
  acknowledged,
  onAcknowledgedChange,
  onChange,
}: PacingValueFieldProps): ReactElement {
  const id = useId();
  const sliderId = `${id}-slider`;
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;
  const ackId = `${id}-ack`;
  const changed = value !== savedValue;
  const overRecommended = isAboveRecommended(value, limits);

  // Where our advice sits on the track the operator is dragging along.
  const markerPercent =
    limits.recommendedMax !== null && limits.absoluteMax > limits.min
      ? ((limits.recommendedMax - limits.min) / (limits.absoluteMax - limits.min)) * 100
      : null;

  const handle = (raw: string): void => {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      onChange(Math.round(parsed));
    }
  };

  // The saved value's own provenance, and — when the server said so — that it
  // already sits past our advice, so reopening the page never presents a
  // deliberate override as an ordinary setting.
  const savedSuffix = savedAboveRecommended
    ? `${SOURCE_SUFFIX[savedSource]}, above our recommendation`
    : SOURCE_SUFFIX[savedSource];

  return (
    <div className="form-field">
      <label className="form-field__label form-field__label--split" htmlFor={sliderId}>
        {label}
        <span
          className="form-field__source"
          data-source={changed ? 'setting' : savedSource}
          data-above-recommended={String(changed ? overRecommended : savedAboveRecommended)}
        >
          {changed
            ? `${String(value)} (not saved yet)`
            : `${String(savedValue)} (${savedSuffix})`}
        </span>
      </label>

      <div className="field-row">
        <div className="field-row__track">
          <input
            className="field-row__slider"
            id={sliderId}
            type="range"
            min={limits.min}
            max={limits.absoluteMax}
            step={step}
            value={value}
            aria-label={ariaLabel}
            aria-describedby={error ? `${descriptionId} ${errorId}` : descriptionId}
            onChange={(event) => {
              handle(event.target.value);
            }}
          />
          {markerPercent !== null ? (
            <span
              className="field-row__recommended-marker"
              style={{ left: `${markerPercent.toFixed(2)}%` }}
              aria-hidden="true"
              title={`Recommended maximum ${String(limits.recommendedMax)}`}
            />
          ) : null}
        </div>
        <Input
          className="control--narrow"
          type="number"
          min={limits.min}
          max={limits.absoluteMax}
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

      {markerPercent !== null ? (
        <p className="field-row__scale">
          <span>{limits.min}</span>
          <span>we suggest up to {limits.recommendedMax}</span>
          <span>{limits.absoluteMax}</span>
        </p>
      ) : null}

      <p className="form-field__description" id={descriptionId}>
        {description}
      </p>

      {changed ? <span className="field-changed">changed from {savedValue}</span> : null}

      {overRecommended ? (
        <Alert tone="warning" title="Past what we suggest">
          {/* The API's own sentence. Copy written here would drift from it. */}
          {limits.recommendedReason ?? 'This is above the maximum OpenLinker suggests.'}
          <label className="ack-row ack-row--inline" htmlFor={ackId}>
            <input
              id={ackId}
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => {
                onAcknowledgedChange(event.target.checked);
              }}
            />
            <span>
              I understand, and I want {value} anyway. My server can take it.
            </span>
          </label>
        </Alert>
      ) : null}

      {error ? (
        <p className="form-field__error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
