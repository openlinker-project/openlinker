/**
 * RangeNumberInput
 *
 * A bounded whole number edited two ways at once: a range slider and a compact
 * number box beside it, kept in step in both directions.
 *
 * - Dragging the slider updates the box live, snapped to a `step` grid that is
 *   anchored at ZERO rather than at `min`. The native `step` stays 1: HTML puts
 *   a range's reachable values at `min + n·step`, so with `min = 1, step = 50`
 *   the round numbers an operator actually wants (100, 500, 2000) would be
 *   unreachable by dragging and `stepMismatch` when typed (#2660 review).
 * - The keyboard moves the slider along the same grid (arrows, PageUp /
 *   PageDown for ten steps, Home / End for the ends). Handled here rather than
 *   left to the browser because a native step of 1 snapped back onto a grid of
 *   50 would never move.
 * - Typing moves the slider as soon as the text is a number inside the range.
 *   Empty, non-numeric or out-of-range text shows a message and leaves the
 *   value alone, so the slider never jumps to a half-typed number. Blur or
 *   Enter settles the text: an out-of-range number is clamped to the nearest
 *   end, and an empty box goes back to the value in force.
 *
 * An optional marker draws a tick on the track (e.g. "we suggest up to N"),
 * and the fill past it switches to the warning tone, so crossing it is visible
 * while dragging rather than discovered on save.
 *
 * The component owns no label: callers point their `<label htmlFor>` at
 * `id` (the slider) and pass `ariaLabel`, which both controls carry, because a
 * page may legitimately show the same visible label twice.
 *
 * @module apps/web/src/shared/ui
 */
import {
  forwardRef,
  useId,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import { Input } from './input';

export interface RangeNumberMarker {
  readonly value: number;
  /** Short text shown under the tick, e.g. "suggested ≤ 2000". */
  readonly label: string;
}

export interface RangeNumberInputProps {
  /** Id of the slider, for an external `<label htmlFor>`. */
  id?: string;
  value: number;
  min: number;
  max: number;
  /** Slider granularity, anchored at zero. Typing is never snapped. */
  step?: number;
  marker?: RangeNumberMarker | null;
  /** Accessible name shared by the slider and the number box. */
  ariaLabel: string;
  /** Ids of description / error elements owned by the caller. */
  describedBy?: string;
  /** The caller's own error (e.g. a server refusal) is showing. */
  invalid?: boolean;
  /** Unit shown after the number box, e.g. "days". */
  unit?: string;
  onChange: (value: number) => void;
}

type RangeStyle = CSSProperties & Record<`--${string}`, string>;

const PAGE_STEPS = 10;

function parseWhole(raw: string): number | null {
  if (raw.trim() === '') {
    return null;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function fraction(value: number, min: number, max: number): number {
  if (max <= min) {
    return 1;
  }
  return Math.min(Math.max((value - min) / (max - min), 0), 1);
}

export const RangeNumberInput = forwardRef<HTMLInputElement, RangeNumberInputProps>(
  function RangeNumberInput(
    {
      id,
      value,
      min,
      max,
      step = 1,
      marker = null,
      ariaLabel,
      describedBy,
      invalid = false,
      unit,
      onChange,
    }: RangeNumberInputProps,
    ref
  ): ReactElement {
    const generatedId = useId();
    const sliderId = id ?? `${generatedId}-slider`;
    const textErrorId = `${generatedId}-text-error`;
    const markerId = `${generatedId}-marker`;
    const grid = step > 0 ? step : 1;

    const [text, setText] = useState(String(value));
    const [textError, setTextError] = useState<string | null>(null);
    const [syncedValue, setSyncedValue] = useState(value);

    // The value moved from outside (slider, undo, a fresh server read):
    // adopt it, unless the box already says the same number in its own way.
    // Adjusted during render rather than in an effect so the box never paints
    // one frame behind the slider.
    if (value !== syncedValue) {
      setSyncedValue(value);
      if (parseWhole(text) !== value) {
        setText(String(value));
      }
      setTextError(null);
    }

    const clamp = (next: number): number => Math.min(Math.max(next, min), max);

    const rangeMessage = `Enter a whole number from ${String(min)} to ${String(max)}.`;

    const commit = (next: number): void => {
      setText(String(next));
      setTextError(null);
      if (next !== value) {
        onChange(next);
      }
    };

    const handleTyped = (raw: string): void => {
      setText(raw);
      const parsed = parseWhole(raw);
      if (parsed === null) {
        setTextError(rangeMessage);
        return;
      }
      if (parsed < min || parsed > max) {
        setTextError(`${rangeMessage} Leaving the field sets it to ${String(clamp(parsed))}.`);
        return;
      }
      setTextError(null);
      if (parsed !== value) {
        onChange(parsed);
      }
    };

    const settleText = (): void => {
      const parsed = parseWhole(text);
      commit(parsed === null ? value : clamp(parsed));
    };

    const handleDragged = (raw: string): void => {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) {
        commit(clamp(Math.round(parsed / grid) * grid));
      }
    };

    const handleSliderKey = (event: KeyboardEvent<HTMLInputElement>): void => {
      const below = Math.ceil(value / grid) * grid;
      const above = Math.floor(value / grid) * grid;
      let next: number | null = null;
      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowUp':
          next = above + grid;
          break;
        case 'ArrowLeft':
        case 'ArrowDown':
          next = below - grid;
          break;
        case 'PageUp':
          next = above + grid * PAGE_STEPS;
          break;
        case 'PageDown':
          next = below - grid * PAGE_STEPS;
          break;
        case 'Home':
          next = min;
          break;
        case 'End':
          next = max;
          break;
        default:
          return;
      }
      event.preventDefault();
      commit(clamp(next));
    };

    const markerShown = marker !== null && marker.value > min && marker.value < max;
    const valueFraction = fraction(value, min, max);
    const markerFraction = markerShown ? fraction(marker.value, min, max) : 1;
    const sliderStyle: RangeStyle = {
      '--range-p': valueFraction.toFixed(4),
      '--range-a': Math.min(valueFraction, markerFraction).toFixed(4),
    };
    const wrapStyle: RangeStyle = { '--range-mark': markerFraction.toFixed(4) };
    // Anchor the marker's caption so it never runs off either end of the track.
    const markerAlign = markerFraction < 0.2 ? 'start' : markerFraction > 0.8 ? 'end' : 'center';

    const describedByIds = [
      describedBy,
      markerShown ? markerId : null,
      textError ? textErrorId : null,
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <div className="range-number">
        <div className="range-number__row">
          <div className="range-number__track" style={wrapStyle}>
            {markerShown ? <span className="range-number__tick" aria-hidden="true" /> : null}
            <input
              className="range-number__slider"
              id={sliderId}
              type="range"
              min={min}
              max={max}
              step={1}
              value={value}
              style={sliderStyle}
              aria-label={ariaLabel}
              aria-describedby={describedByIds || undefined}
              onChange={(event) => {
                handleDragged(event.target.value);
              }}
              onKeyDown={handleSliderKey}
            />
            <div className="range-number__scale">
              <span aria-hidden="true">{min}</span>
              {markerShown ? (
                <span className="range-number__marker-label" data-align={markerAlign} id={markerId}>
                  {marker.label}
                </span>
              ) : null}
              <span aria-hidden="true">{max}</span>
            </div>
          </div>
          <div className="range-number__box">
            <Input
              ref={ref}
              className="range-number__input"
              type="number"
              inputMode="numeric"
              min={min}
              max={max}
              step={1}
              value={text}
              invalid={invalid || textError !== null}
              aria-invalid={invalid || textError !== null ? true : undefined}
              aria-label={ariaLabel}
              aria-describedby={describedByIds || undefined}
              onChange={(event) => {
                handleTyped(event.target.value);
              }}
              onBlur={settleText}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  settleText();
                }
              }}
            />
            {unit ? <span className="range-number__unit">{unit}</span> : null}
          </div>
        </div>
        {textError ? (
          <p className="form-field__error range-number__error" id={textErrorId} role="alert">
            {textError}
          </p>
        ) : null}
      </div>
    );
  }
);
