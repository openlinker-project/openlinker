/**
 * QueryErrorState
 *
 * Picks the right state for a failed read, so a page swaps one block instead
 * of re-deriving the branch (#3096):
 *
 * | Error            | Renders                                   |
 * |------------------|-------------------------------------------|
 * | 403 (not consent)| `AccessDeniedState` — no Retry            |
 * | 404, with copy   | `EmptyState` — a fact about the address   |
 * | anything else    | `ErrorState` with a Retry                 |
 *
 * A 403 must never offer a Retry: the same request is refused the same way
 * every time, so the button only teaches an operator that the product is
 * broken. A 404 is offered as not-found only when the caller supplies copy for
 * it — a list read has no "not found", and guessing one would be wrong.
 *
 * @module shared/ui
 */
import type { ReactElement, ReactNode } from 'react';

import { isAccessDeniedError } from '../api/access-denied-error';
import { ApiError } from '../api/api-error';
import { Button } from './button';
import { AccessDeniedState, EmptyState, ErrorState } from './feedback-state';

export interface QueryErrorStateCopy {
  error: { title: ReactNode; message: ReactNode; retry: ReactNode };
  notFound?: { title: ReactNode; message: ReactNode };
  denied?: { title?: ReactNode; message?: ReactNode; action?: ReactNode };
}

export interface QueryErrorStateProps {
  error: unknown;
  onRetry: () => void;
  copy: QueryErrorStateCopy;
}

export function QueryErrorState({ error, onRetry, copy }: QueryErrorStateProps): ReactElement {
  if (isAccessDeniedError(error)) {
    return (
      <AccessDeniedState
        title={copy.denied?.title}
        message={copy.denied?.message}
        action={copy.denied?.action}
      />
    );
  }

  if (copy.notFound && error instanceof ApiError && error.isNotFound()) {
    return (
      <EmptyState liveRegion="off" title={copy.notFound.title} message={copy.notFound.message} />
    );
  }

  return (
    <ErrorState
      title={copy.error.title}
      message={copy.error.message}
      action={<Button onClick={onRetry}>{copy.error.retry}</Button>}
    />
  );
}
