import type { ReactElement, ReactNode } from 'react';

type AriaLive = 'assertive' | 'off' | 'polite';

interface BaseStateProps {
  action?: ReactNode;
  eyebrow?: string;
  message: ReactNode;
  title: ReactNode;
}

interface LoadingStateProps extends Omit<BaseStateProps, 'action'> {
  // Defaults to "polite". Set to "off" when the loading state is rendered on initial page
  // load (not as a transition from a prior loaded state) to avoid spurious announcements.
  liveRegion?: AriaLive;
}

interface EmptyStateProps extends BaseStateProps {
  // Defaults to "polite". Set to "off" when the empty state is rendered on initial page
  // load (not as a transition from a prior loaded state) to avoid spurious announcements.
  liveRegion?: AriaLive;
}

export function LoadingState({
  eyebrow = 'Loading',
  liveRegion = 'polite',
  message,
  title,
}: LoadingStateProps): ReactElement {
  return (
    <div className="state-card state-card--loading" role="status" aria-live={liveRegion}>
      <div className="state-card__header">
        <p className="eyebrow">{eyebrow}</p>
        <h2 className="state-card__title">{title}</h2>
      </div>
      <p className="state-card__message">{message}</p>
    </div>
  );
}

export function EmptyState({ action, eyebrow = 'Empty state', liveRegion = 'polite', message, title }: EmptyStateProps): ReactElement {
  return (
    <div className="state-card empty-state" role="status" aria-live={liveRegion}>
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
