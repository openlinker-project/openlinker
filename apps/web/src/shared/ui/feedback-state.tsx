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

export function EmptyState({ action, eyebrow, liveRegion = 'polite', message, title }: EmptyStateProps): ReactElement {
  return (
    <div className="state-card empty-state" role="status" aria-live={liveRegion}>
      <div className="state-card__header">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h2 className="state-card__title">{title}</h2>
      </div>
      <p className="state-card__message">{message}</p>
      {action ? <div className="state-card__actions">{action}</div> : null}
    </div>
  );
}

/**
 * The defaults `AccessDeniedState` speaks with when a caller has nothing more
 * specific to say. Generic on purpose: `shared` may not know which screen it
 * is rendered on.
 */
export const ACCESS_DENIED_DEFAULT_COPY = {
  eyebrow: 'No access',
  title: "You don't have access to this",
  message: "Your account's role doesn't include this screen. Ask an administrator if you need it.",
} as const;

interface AccessDeniedStateProps {
  /** Optional way out — a link to somewhere this session may go. Never a Retry. */
  action?: ReactNode;
  eyebrow?: string;
  message?: ReactNode;
  title?: ReactNode;
}

/**
 * A 403, stated as a fact rather than a failure (#3096).
 *
 * `ErrorState` offers a Retry, which is a lie on a 403: the same request will
 * be refused the same way however often it is sent. So this state carries no
 * retry, and it is `role="status"` rather than `role="alert"` — the session is
 * not broken, it simply may not see this.
 */
export function AccessDeniedState({
  action,
  eyebrow = ACCESS_DENIED_DEFAULT_COPY.eyebrow,
  message = ACCESS_DENIED_DEFAULT_COPY.message,
  title = ACCESS_DENIED_DEFAULT_COPY.title,
}: AccessDeniedStateProps): ReactElement {
  return (
    <div className="state-card state-card--denied" role="status" aria-live="off">
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
