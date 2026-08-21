import type { ReactElement, ReactNode } from 'react';

/**
 * `conflict` (#2253) is for two sources disagreeing about the same fact - a
 * state that needs attention but is not an error, because the document still
 * issued. Its family has no `-fg` member, so the CSS rule reads
 * `--status-conflict-strong`.
 */
export type StatusBadgeTone =
  | 'conflict'
  | 'error'
  | 'info'
  | 'neutral'
  | 'review'
  | 'success'
  | 'warning';

interface StatusBadgeProps {
  children: ReactNode;
  className?: string;
  compact?: boolean;
  /** When true the badge background flips to inverted (high-emphasis label). */
  solid?: boolean;
  tone?: StatusBadgeTone;
  /** Pulses the leading dot — for live / syncing states. Forces `withDot`. */
  pulse?: boolean;
  withDot?: boolean;
}

export function StatusBadge({
  children,
  className = '',
  compact = false,
  solid = false,
  tone = 'neutral',
  pulse = false,
  withDot = false,
}: StatusBadgeProps): ReactElement {
  const showDot = withDot || pulse;
  const classes = [
    'status-badge',
    `status-badge--${tone}`,
    compact ? 'status-badge--compact' : '',
    solid ? 'status-badge--solid' : '',
    pulse ? 'status-badge--pulse' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span className={classes}>
      {showDot ? <span className="status-badge__dot" aria-hidden="true" /> : null}
      <span>{children}</span>
    </span>
  );
}
