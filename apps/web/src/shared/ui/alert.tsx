import type { ReactElement, ReactNode } from 'react';

/**
 * `conflict` (#2253) reports two sources disagreeing about the same fact. It
 * is deliberately **not** `error`: the work still completed, so the alert
 * lands on `role="status"` below rather than interrupting a screen reader
 * mid-task. That is the correct politeness level for a non-blocking advisory,
 * and it follows from the tone rather than being chosen per call site.
 */
export type AlertTone = 'conflict' | 'error' | 'info' | 'success' | 'warning';

interface AlertProps {
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  tone?: AlertTone;
}

export function Alert({
  action,
  children,
  className = '',
  title,
  tone = 'info',
}: AlertProps): ReactElement {
  const classes = ['alert', `alert--${tone}`, className].filter(Boolean).join(' ');

  return (
    <div className={classes} role={tone === 'error' ? 'alert' : 'status'}>
      <div className="alert__content">
        {title ? <strong className="alert__title">{title}</strong> : null}
        <div className="alert__description">{children}</div>
      </div>
      {action ? <div className="alert__actions">{action}</div> : null}
    </div>
  );
}
