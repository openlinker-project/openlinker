/**
 * Pacing Value Field
 *
 * One numeric setting: the shared `RangeNumberInput` (slider + number box kept
 * in step both ways), the effective value with the rung that produced it, a
 * visible description, an inline changed-from marker, and a per-field server
 * error.
 *
 * It does not use the shared `FormField`, which clones a SINGLE control and
 * owns its `id` / `aria-describedby`. This field is two controls bound to one
 * value, so the label points at the slider and both controls carry the same
 * accessible name.
 *
 * The `source` text is rendered from what the server said, never from
 * comparing the value against a hardcoded default. A client-side comparison
 * is a second copy of the default and it is wrong the day the default moves.
 *
 * **The slider runs to the ABSOLUTE ceiling, not the recommended one.** The
 * recommendation is OpenLinker's judgement and an operator may exceed it on
 * their own hardware; a control that stopped at it would make the raised
 * ceiling unreachable, which is exactly what the two-ceiling shape exists to
 * allow. The recommendation is drawn on the track as a tick instead, so the
 * operator can see where they are crossing rather than discovering it on save.
 *
 * Past the recommendation the field shows the API's OWN reason and requires an
 * explicit acknowledgement. Two rules there are load-bearing: the sentence is
 * never copy written here (the page and the API would drift), and the
 * acknowledgement is never inferred from the value being high — inferring it
 * would turn the gate into a formality and there would be no point having it.
 *
 * Granularity is the primitive's zero-anchored `step`, never an HTML `step` on
 * a `min`-anchored grid — see `RangeNumberInput` for why (#2660 review).
 *
 * The description is visible text rather than a tooltip on purpose: an
 * operator who needs the tooltip does not know to hover.
 *
 * @module apps/web/src/features/settings/components
 */
import { useId, type ReactElement } from 'react';
import { Alert } from '../../../shared/ui/alert';
import { RangeNumberInput } from '../../../shared/ui/range-number-input';
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
  /** Slider granularity, anchored at zero. Typing is never snapped. */
  step?: number;
  /** Unit shown after the number box, e.g. "days". */
  unit?: string;
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
  // Named precisely: this is an environment variable on the API process, and
  // the sweeps run in the worker, which reads its own (#2660 review). The page
  // carries the caveat once, above the panels.
  env: "from this server's environment",
  default: 'default',
};

export function PacingValueField({
  label,
  ariaLabel,
  description,
  value,
  limits,
  step = 50,
  unit,
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

  // The saved value's own provenance, and — when the server said so — that it
  // already sits past our advice, so reopening the page never presents a
  // deliberate override as an ordinary setting.
  const savedSuffix = savedAboveRecommended
    ? `${SOURCE_SUFFIX[savedSource]}, above our recommendation`
    : SOURCE_SUFFIX[savedSource];

  return (
    <div className="pacing-field">
      <div className="pacing-field__head">
        <label className="form-field__label" htmlFor={sliderId}>
          {label}
        </label>
        <span
          className="form-field__source pacing-field__source"
          data-source={changed ? 'setting' : savedSource}
          data-above-recommended={String(changed ? overRecommended : savedAboveRecommended)}
        >
          {changed
            ? `${String(value)} (not saved yet)`
            : `${String(savedValue)} (${savedSuffix})`}
        </span>
      </div>

      <RangeNumberInput
        id={sliderId}
        value={value}
        min={limits.min}
        max={limits.absoluteMax}
        step={step}
        unit={unit}
        marker={
          limits.recommendedMax === null
            ? null
            : { value: limits.recommendedMax, label: `suggested ≤ ${String(limits.recommendedMax)}` }
        }
        ariaLabel={ariaLabel}
        describedBy={error ? `${descriptionId} ${errorId}` : descriptionId}
        invalid={Boolean(error)}
        onChange={onChange}
      />

      <p className="form-field__description pacing-field__description" id={descriptionId}>
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
