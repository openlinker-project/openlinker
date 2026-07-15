/**
 * Confirm Email Status
 *
 * Renders the outcome of consuming a single-use email confirmation token
 * (#1624). Fires the confirmation request once on mount — there's no user
 * input to collect, unlike ResetPasswordForm — and shows a pending / success
 * / failure state.
 *
 * @module features/auth/components
 */
import type { ReactElement } from 'react';
import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useConfirmEmail } from '../hooks/use-confirm-email';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';

interface ConfirmEmailStatusProps {
  token: string;
}

export function ConfirmEmailStatus({ token }: ConfirmEmailStatusProps): ReactElement {
  const mutation = useConfirmEmail();
  const requested = useRef(false);

  useEffect(() => {
    if (requested.current) {
      return;
    }
    requested.current = true;
    mutation.mutate({ token });
    // Fire once per mount — `mutation` is intentionally omitted from deps.
  }, [token]);

  if (mutation.isSuccess) {
    return (
      <div className="guest-page__success">
        <p>Your email is confirmed and your account is now active.</p>
        <Link to="/login">Sign in now</Link>
      </div>
    );
  }

  if (mutation.isError) {
    return (
      <div className="guest-form__demo-callout">
        <Alert tone="error" title="Confirmation failed">
          {mutation.error.message}
        </Alert>
        <Button type="button" tone="secondary" onClick={() => mutation.mutate({ token })}>
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
