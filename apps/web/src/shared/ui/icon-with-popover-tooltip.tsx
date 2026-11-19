/**
 * IconWithOnHoverPopoverTooltip
 *
 * A small icon button that explains itself in a `PopoverOnHover` panel. The
 * icon is a prop, so one component serves every mark: pass `<WarningIcon />`
 * with `tone="warning"` for a caution, `<InfoIcon />` for a definition. The
 * ready-made `WarningPopoverTooltip` is this with the warning icon filled in.
 *
 * The button opts out of the global button box (`button--bare`) and carries
 * the accessible name, because the glyph alone says nothing to a screen reader.
 *
 * @module shared/ui
 */
import type { ReactElement, ReactNode } from 'react';
import { PopoverOnHover } from './popover-on-hover';
import type { PopoverAlign, PopoverPlacement } from './motion-popover';

export type IconTooltipTone = 'warning' | 'error' | 'info' | 'neutral';

export interface IconWithOnHoverPopoverTooltipProps {
  /** The glyph, e.g. `<WarningIcon />`. */
  icon: ReactElement;
  /** Accessible name of the button: what the panel is about. */
  label: string;
  /** Muted heading above the panel content. */
  title?: ReactNode;
  tone?: IconTooltipTone;
  width?: number;
  placement?: PopoverPlacement;
  align?: PopoverAlign;
  className?: string;
  children: ReactNode;
}

export function IconWithOnHoverPopoverTooltip({
  icon,
  label,
  title,
  tone = 'neutral',
  width,
  placement,
  align,
  className,
  children,
}: IconWithOnHoverPopoverTooltipProps): ReactElement {
  const classes = ['button--bare', 'icon-tip', `icon-tip--${tone}`, className]
    .filter(Boolean)
    .join(' ');
  return (
    <PopoverOnHover
      title={title}
      ariaLabel={label}
      width={width}
      placement={placement}
      align={align}
      className={`popover-on-hover--${tone}`}
      trigger={(triggerProps) => (
        <button type="button" className={classes} aria-label={label} {...triggerProps}>
          {icon}
        </button>
      )}
    >
      {children}
    </PopoverOnHover>
  );
}
