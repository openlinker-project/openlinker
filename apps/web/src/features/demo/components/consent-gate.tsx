/**
 * Consent Gate
 *
 * Body of the `/consent` page (#1938): the one place an existing demo account
 * can agree to session recording, or leave. Deliberately a page rather than a
 * modal — a modal can be removed from the DOM and clicked past, and the API
 * would then answer 403 to everything the account tried.
 *
 * Two outcomes only. "Agree and continue" persists consent, re-mints the access
 * token so the new claim reaches `AnalyticsConsentGuard`, and returns to the
 * path the visitor was originally heading for. "Sign out" clears the session.
 *
 * @module features/demo/components
 */
import type { ReactElement } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useSession } from '../../../shared/auth/use-session';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { useUpdateAnalyticsConsentMutation } from '../../auth/hooks/use-update-analytics-consent-mutation';
import { SessionRecordingBullets } from './session-recording-bullets';

/**
 * Only a same-origin absolute path is honoured, so a crafted
 * `?next=https://evil.example` cannot turn the consent page into an open
 * redirect. A protocol-relative `//host` is rejected for the same reason.
 */
export function resolveNextPath(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) {
    return '/';
  }
  return raw;
}

export function ConsentGate(): ReactElement {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { clearSession } = useSession();
  const mutation = useUpdateAnalyticsConsentMutation();
  const nextPath = resolveNextPath(searchParams.get('next'));

  const handleAgree = async (): Promise<void> => {
    try {
      await mutation.mutateAsync({ analyticsConsent: true });
      void navigate(nextPath, { replace: true });
    } catch {
      // Surfaced by the Alert below — the account stays on this page.
    }
  };

  const handleSignOut = async (): Promise<void> => {
    await clearSession();
    void navigate('/login', { replace: true });
  };

  return (
    <div className="demo-consent">
      <h1 className="demo-consent__title">We record demo sessions now</h1>
      <p className="demo-consent__copy">
        Session recording became part of the demo since your last visit. We watch how the demo gets
        used to see where the product gets confusing. Passwords are never recorded, and the demo only
        holds made-up data.
      </p>

      {mutation.error ? (
        <Alert tone="error" title="Could not save your choice">
          {mutation.error.message}
        </Alert>
      ) : null}

      <details className="demo-consent__disclosure">
        <summary>What we record</summary>
        <div className="demo-consent__disclosure-body">
          <SessionRecordingBullets />
        </div>
      </details>

      <div className="demo-consent__actions">
        <Button tone="ghost" onClick={() => void handleSignOut()} disabled={mutation.isPending}>
          Sign out
        </Button>
        <Button tone="primary" onClick={() => void handleAgree()} disabled={mutation.isPending}>
          {mutation.isPending ? 'Saving…' : 'Agree and continue'}
        </Button>
      </div>

      <p className="demo-consent__fineprint">Nothing is recorded until you agree.</p>
    </div>
  );
}
