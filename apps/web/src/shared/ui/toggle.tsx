/**
 * Toggle (#3935)
 *
 * An on/off switch for a row or a header: a native checkbox restyled as a track
 * and a knob, so keyboard, screen readers and form semantics come for free. The
 * visible label is optional; `aria-label` is always required, because most
 * toggles sit in a table cell with no text beside them.
 *
 * @module shared/ui
 */
import type { ChangeEvent, ReactElement } from 'react';

export interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  'aria-label': string;
  /** Text read by screen readers beside the control; hidden visually. */
  srLabel?: string;
  disabled?: boolean;
  title?: string;
  className?: string;
  'data-testid'?: string;
}

export function Toggle({
  checked,
  onChange,
  'aria-label': ariaLabel,
  srLabel,
  disabled = false,
  title,
  className,
  'data-testid': testId,
}: ToggleProps): ReactElement {
  return (
    <label className={['ol-toggle', className].filter(Boolean).join(' ')} title={title}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        data-testid={testId}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          onChange(event.target.checked);
        }}
      />
      {srLabel !== undefined ? <span className="sr-only">{srLabel}</span> : null}
    </label>
  );
}
