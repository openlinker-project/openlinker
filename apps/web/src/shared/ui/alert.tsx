import type { ReactElement, ReactNode } from 'react';

export type AlertTone = 'error' | 'info' | 'success' | 'warning';

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
