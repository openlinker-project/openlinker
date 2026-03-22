import type { ReactElement, ReactNode } from 'react';

export type StatusBadgeTone = 'error' | 'info' | 'neutral' | 'review' | 'success' | 'warning';

interface StatusBadgeProps {
  children: ReactNode;
  className?: string;
  compact?: boolean;
  tone?: StatusBadgeTone;
  withDot?: boolean;
}

export function StatusBadge({
  children,
  className = '',
  compact = false,
  tone = 'neutral',
  withDot = false,
}: StatusBadgeProps): ReactElement {
  const classes = ['status-badge', `status-badge--${tone}`, compact ? 'status-badge--compact' : '', className]
    .filter(Boolean)
    .join(' ');

  return (
    <span className={classes}>
      {withDot ? <span className="status-badge__dot" aria-hidden="true" /> : null}
      <span>{children}</span>
    </span>
  );
}
