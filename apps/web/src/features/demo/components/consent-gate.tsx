/**
 * Consent Gate
 *
 * Body of the `/consent` page (#1938): where an account created before session
 * recording became a condition of the demo accepts that condition, or leaves.
 * Deliberately a page rather than a modal — a modal can be removed from the DOM
 * and clicked past, and the API would then answer 403 to everything the account
 * tried.
 *
 * The copy states a condition rather than asking for consent, matching the
 * registration notice: recording is how the free demo pays for itself, and
 * declining means not using the demo. "Continue" records the acceptance,
 * re-mints the access token so the flag reaches `AnalyticsConsentGuard`, and
 * returns to the path the visitor was originally heading for. "Sign out" clears
 * the session.
 *
 * @module features/demo/components
 */
import type { ReactElement } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useSession } from '../../../shared/auth/use-session';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { useUpdateAnalyticsConsentMutation } from '../../auth';
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

  const handleAccept = async (): Promise<void> => {
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
      <h1 className="demo-consent__title">Demo sessions are recorded</h1>
      <p className="demo-consent__copy">
        Recording became part of the demo since your last visit. It is how we see where the product
        gets confusing, and it is a condition of using the demo — continuing accepts it. Passwords
        are never recorded, and the demo only holds made-up data.
      </p>

      {mutation.error ? (
        <Alert tone="error" title="Could not save that">
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
        <Button tone="primary" onClick={() => void handleAccept()} disabled={mutation.isPending}>
          {mutation.isPending ? 'Saving…' : 'Continue'}
        </Button>
      </div>

      <p className="demo-consent__fineprint">Recording starts when you continue.</p>
    </div>
  );
}
