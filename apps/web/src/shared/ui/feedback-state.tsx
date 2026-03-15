import type { ReactElement, ReactNode } from 'react';

interface BaseStateProps {
  action?: ReactNode;
  eyebrow?: string;
  message: ReactNode;
  title: ReactNode;
}

export function LoadingState({
  eyebrow = 'Loading',
  message,
  title,
}: Omit<BaseStateProps, 'action'>): ReactElement {
  return (
    <div className="state-card state-card--loading" role="status" aria-live="polite">
      <div className="state-card__header">
        <p className="eyebrow">{eyebrow}</p>
        <h2 className="state-card__title">{title}</h2>
      </div>
      <p className="state-card__message">{message}</p>
    </div>
  );
}

export function EmptyState({ action, eyebrow = 'Empty state', message, title }: BaseStateProps): ReactElement {
  return (
    <div className="state-card empty-state" role="status">
      <div className="state-card__header">
        <p className="eyebrow">{eyebrow}</p>
        <h2 className="state-card__title">{title}</h2>
      </div>
      <p className="state-card__message">{message}</p>
      {action ? <div className="state-card__actions">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ action, eyebrow = 'Error', message, title }: BaseStateProps): ReactElement {
  return (
    <div className="state-card state-card--error" role="alert">
      <div className="state-card__header">
        <p className="eyebrow">{eyebrow}</p>
        <h2 className="state-card__title">{title}</h2>
      </div>
      <p className="state-card__message">{message}</p>
      {action ? <div className="state-card__actions">{action}</div> : null}
    </div>
  );
}
