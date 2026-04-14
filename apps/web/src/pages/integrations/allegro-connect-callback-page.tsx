import type { ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useHandleAllegroCallback } from '../../features/allegro/hooks/use-handle-allegro-callback';
import { ApiError } from '../../shared/api/api-error';
import { ErrorState, LoadingState } from '../../shared/ui/feedback-state';
import { PageLayout } from '../../shared/ui/page-layout';

function isOAuthStateInvalidError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  const details = error.details;
  return (
    typeof details === 'object' &&
    details !== null &&
    'code' in details &&
    (details as { code?: unknown }).code === 'OAUTH_STATE_INVALID'
  );
}

export function AllegroConnectCallbackPage(): ReactElement {
  const [searchParams] = useSearchParams();
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const oauthError = searchParams.get('error');

  const callbackState = useHandleAllegroCallback(code, state);

  function renderContent(): ReactElement {
    if (oauthError) {
      return (
        <ErrorState
          title="Authorization denied"
          message="You did not authorize OpenLinker on Allegro. No connection was created."
          action={
            <Link className="button" to="/connections/new/allegro">
              Start over
            </Link>
          }
        />
      );
    }

    if (callbackState.status === 'idle' && (!code || !state)) {
      return (
        <ErrorState
          title="Invalid callback"
          message="The OAuth callback is missing required parameters. This may happen if you navigate here directly."
          action={
            <Link className="button" to="/connections/new/allegro">
              Start setup
            </Link>
          }
        />
      );
    }

    if (callbackState.status === 'idle' || callbackState.status === 'pending') {
      return <LoadingState title="Completing authorization" message="Exchanging authorization code with Allegro…" />;
    }

    if (callbackState.status === 'error') {
      if (isOAuthStateInvalidError(callbackState.error)) {
        return (
          <ErrorState
            title="Authorization already completed"
            message="This authorization link was already used. Your Allegro connection should be active."
            action={
              <Link className="button" to="/connections">
                View connections
              </Link>
            }
          />
        );
      }
      const message =
        callbackState.error instanceof Error ? callbackState.error.message : 'Unknown error';
      return (
        <ErrorState
          title="Authorization failed"
          message={message}
          action={
            <Link className="button" to="/connections/new/allegro">
              Try again
            </Link>
          }
        />
      );
    }

    const { connectionId, connectionName } = callbackState.data;
    return (
      <article className="panel panel--dense">
        <div className="panel__header">
          <div>
            <p className="eyebrow">Success</p>
            <h3 className="section-title">Connection created</h3>
          </div>
          <span className="panel__meta">Active</span>
        </div>
        <dl className="definition-list">
          <div>
            <dt>Name</dt>
            <dd>{connectionName}</dd>
          </div>
          <div>
            <dt>Connection ID</dt>
            <dd className="mono-text">{connectionId}</dd>
          </div>
        </dl>
        <div className="form-actions">
          <Link className="button" to={`/connections/${connectionId}`}>
            Go to connection
          </Link>
          <Link className="button button--secondary" to="/connections">
            View all connections
          </Link>
        </div>
      </article>
    );
  }

  return (
    <PageLayout
      eyebrow="OAuth callback"
      title="Allegro authorization"
      description="Processing the authorization response from Allegro."
      summary={
        <div className="toolbar__group">
          <span className="toolbar-chip">OAuth 2.0</span>
          <span className="toolbar-chip">Allegro API</span>
        </div>
      }
    >
      {renderContent()}
    </PageLayout>
  );
}
