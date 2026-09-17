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
  /**
   * For test introspection (the `Combobox` convention). Lands on the alert
   * root so a spec can name ONE notice without a wrapper element - an alert
   * is routinely a flex/grid child, so a spare `<div>` around it would change
   * where it sits rather than only what it is called.
   *
   * This is the third shared primitive to carry this prop (after `Combobox`
   * and `StatusBadge`). If a fourth needs it, write the convention down
   * explicitly (docs/frontend-architecture.md or a component-conventions
   * note) rather than adding a fourth precedent silently.
   */
  'data-testid'?: string;
}

export function Alert({
  action,
  children,
  className = '',
  title,
  tone = 'info',
  'data-testid': dataTestId,
}: AlertProps): ReactElement {
  const classes = ['alert', `alert--${tone}`, className].filter(Boolean).join(' ');

  return (
    <div className={classes} role={tone === 'error' ? 'alert' : 'status'} data-testid={dataTestId}>
      <div className="alert__content">
        {title ? <strong className="alert__title">{title}</strong> : null}
        <div className="alert__description">{children}</div>
      </div>
      {action ? <div className="alert__actions">{action}</div> : null}
    </div>
  );
}
