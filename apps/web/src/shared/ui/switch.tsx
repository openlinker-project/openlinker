/**
 * Switch (#4289)
 *
 * A real on/off switch: `role="switch"` on a button, so a screen reader says
 * "on" and "off" rather than "checked", and Space/Enter flip it. It carries its
 * own visible label because the settings it sits on explain themselves in the
 * words beside it; the track and knob are styled with tokens only.
 *
 * Not `Toggle`, which is a checkbox restyled for table cells that have no text
 * beside them.
 *
 * @module shared/ui
 */
import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react';

export interface SwitchProps extends Omit<ComponentPropsWithoutRef<'button'>, 'onChange' | 'role'> {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  /** Visible label beside the track; clicking it flips the switch. */
  label?: ReactNode;
}

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { checked, onCheckedChange, label, className = '', disabled, onClick, ...props },
  ref
) {
  const classes = ['ol-switch', checked ? 'ol-switch--on' : '', className]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={classes}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) onCheckedChange(!checked);
      }}
      {...props}
    >
      <span className="ol-switch__track" aria-hidden="true">
        <span className="ol-switch__knob" />
      </span>
      {label !== undefined ? <span className="ol-switch__label">{label}</span> : null}
    </button>
  );
});
