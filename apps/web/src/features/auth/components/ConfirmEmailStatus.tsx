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
 * @module features/auth/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useConfirmEmail } from '../hooks/use-confirm-email';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';

interface ConfirmEmailStatusProps {
  token: string;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

export function ConfirmEmailStatus({ token }: ConfirmEmailStatusProps): ReactElement {
  const { state, retry } = useConfirmEmail(token);

  if (state.status === 'success') {
    return (
      <div className="guest-page__success">
        <p>Your email is confirmed and your account is now active.</p>
        <Link to="/login">Sign in now</Link>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="guest-form__demo-callout">
        <Alert tone="error" title="Confirmation failed">
          {getErrorMessage(state.error)}
        </Alert>
        <Button type="button" tone="secondary" onClick={retry}>
          Try again
        </Button>
        <p className="guest-form__footer-link">
          <Link to="/login">Back to sign in</Link>
        </p>
      </div>
    );
  }

  return <p>Confirming your email…</p>;
}
