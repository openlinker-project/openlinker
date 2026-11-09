/**
 * Confirm Email Status
 *
 * Renders the outcome of consuming a single-use email confirmation token
 * (#1624). Fires the confirmation request once on mount — there's no user
 * input to collect, unlike ResetPasswordForm — and shows a pending / success
 * / failure state.
 *
 * Uses `useConfirmEmail`'s plain-state hook rather than `useMutation`
 * directly, because this component is reached via a cold/fresh navigation
 * (the user clicking the confirmation link from their email client) — the
 * same scenario `useHandleAllegroCallback` documents as unreliable for
 * TanStack Query's mutation observer re-renders.
 *
 * Visual design (#1650): each state gets a small "seal" glyph (a filled
 * circle in the state's status color) as a fast, at-a-glance signal, on top
 * of the existing text. Success stays light-touch (no bordered box — a
 * confirmed account is good news, not something that needs a heavy
 * container); error stays boxed in an `Alert` with `role="alert"`, because
 * the error message is dynamic (server-supplied) and deserves the stronger,
 * accessible treatment. The action area (`.confirm-email__actions`) is a
 * plain vertical stack so a future "Resend confirmation email" affordance
 * (pending #1649's backend endpoint) can slot in without a redesign.
 *
 * @module features/auth/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useConfirmEmail } from '../hooks/use-confirm-email';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { useMessages } from '../../../shared/i18n';

interface ConfirmEmailStatusProps {
  token: string;
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function ConfirmEmailStatus({ token }: ConfirmEmailStatusProps): ReactElement {
  const { state, retry } = useConfirmEmail(token);
  const auth = useMessages('auth');
  const copy = auth.confirmEmail;

  if (state.status === 'success') {
    return (
      <div className="confirm-email" aria-live="polite">
        <span className="confirm-email__seal confirm-email__seal--success" aria-hidden="true">
          ✓
        </span>
        <h2 className="confirm-email__heading">{copy.successTitle}</h2>
        <p className="confirm-email__message">{copy.successMessage}</p>
        <div className="confirm-email__actions">
          <Link className="button" to="/login">
            {copy.continue}
          </Link>
        </div>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="confirm-email" aria-live="polite">
        <span className="confirm-email__seal confirm-email__seal--error" aria-hidden="true">
          ✕
        </span>
        <h2 className="confirm-email__heading">{copy.failed}</h2>
        <Alert tone="error">{getErrorMessage(state.error, copy.fallbackError)}</Alert>
        <div className="confirm-email__actions">
          <Link className="button" to="/login">
            {auth.common.backToSignIn}
          </Link>
          <Button type="button" tone="ghost" onClick={retry}>
            {auth.common.tryAgain}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="confirm-email confirm-email--pending" aria-live="polite">
      <StatusBadge tone="info" pulse>
        {copy.confirming}
      </StatusBadge>
      <p className="confirm-email__message">{copy.confirmingMessage}</p>
    </div>
  );
}
