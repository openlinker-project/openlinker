import type { ReactElement } from 'react';
import { useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useHandleAllegroCallbackMutation } from '../../features/allegro/hooks/use-handle-allegro-callback-mutation';
import { ErrorState, LoadingState } from '../../shared/ui/feedback-state';
import { PageLayout } from '../../shared/ui/page-layout';

export function AllegroConnectCallbackPage(): ReactElement {
  const [searchParams] = useSearchParams();
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const oauthError = searchParams.get('error');

  const callbackMutation = useHandleAllegroCallbackMutation();
  const hasCalledRef = useRef(false);

  useEffect(() => {
    if (!hasCalledRef.current && code && state) {
      hasCalledRef.current = true;
      // Strip ?code&state from the URL *before* firing the mutation so that
      // a StrictMode double-mount or HMR remount sees a clean URL and does not
      // dispatch a duplicate request (which would race against the in-flight one
      // and hit the backend before the completed-state marker is written).
      window.history.replaceState({}, '', window.location.pathname);
      callbackMutation.mutate({ code, state });
    }
  }, [code, state, callbackMutation.mutate]);

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

    if (!code || !state) {
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

    if (callbackMutation.isPending) {
      return <LoadingState title="Completing authorization" message="Exchanging authorization code with Allegro…" />;
    }

    if (callbackMutation.error) {
      const isAlreadyUsed = callbackMutation.error.message.includes('Invalid or expired OAuth state');
      if (isAlreadyUsed) {
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
      return (
        <ErrorState
          title="Authorization failed"
          message={callbackMutation.error.message}
          action={
            <Link className="button" to="/connections/new/allegro">
              Try again
            </Link>
          }
        />
      );
    }

    if (callbackMutation.data) {
      const { connectionId, connectionName } = callbackMutation.data;
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

    return <LoadingState title="Completing authorization" message="Exchanging authorization code with Allegro…" />;
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
