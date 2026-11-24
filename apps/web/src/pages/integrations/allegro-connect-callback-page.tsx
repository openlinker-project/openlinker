import type { ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useHandleAllegroCallback } from '../../features/allegro/hooks/use-handle-allegro-callback';
import { ApiError } from '../../shared/api/api-error';
import { ErrorState, LoadingState } from '../../shared/ui/feedback-state';
import { PageLayout } from '../../shared/ui/page-layout';
import { useMessages } from '../../shared/i18n';
import { describeApiError } from '../../shared/api/describe-api-error';

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
  const copy = useMessages('allegro-core').allegroConnectCallbackPage;

  function renderContent(): ReactElement {
    if (oauthError) {
      return (
        <ErrorState
          title={copy.denied.title}
          message={copy.denied.message}
          action={
            <Link className="button" to="/connections/new/allegro">
              {copy.denied.startOver}
            </Link>
          }
        />
      );
    }

    if (callbackState.status === 'idle' && (!code || !state)) {
      return (
        <ErrorState
          title={copy.invalid.title}
          message={copy.invalid.message}
          action={
            <Link className="button" to="/connections/new/allegro">
              {copy.invalid.startSetup}
            </Link>
          }
        />
      );
    }

    if (callbackState.status === 'idle' || callbackState.status === 'pending') {
      return <LoadingState title={copy.pending.title} message={copy.pending.message} />;
    }

    if (callbackState.status === 'error') {
      if (isOAuthStateInvalidError(callbackState.error)) {
        return (
          <ErrorState
            title={copy.alreadyCompleted.title}
            message={copy.alreadyCompleted.message}
            action={
              <Link className="button" to="/connections">
                {copy.alreadyCompleted.viewConnections}
              </Link>
            }
          />
        );
      }
      return (
        <ErrorState
          title={copy.failed.title}
          message={describeApiError(callbackState.error, 'allegro-core')}
          action={
            <Link className="button" to="/connections/new/allegro">
              {copy.failed.tryAgain}
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
            <p className="eyebrow">{copy.success.eyebrow}</p>
            <h3 className="section-title">{copy.success.title}</h3>
          </div>
          <span className="panel__meta">{copy.success.active}</span>
        </div>
        <dl className="definition-list">
          <div>
            <dt>{copy.success.name}</dt>
            <dd>{connectionName}</dd>
          </div>
          <div>
            <dt>{copy.success.connectionId}</dt>
            <dd className="mono-text">{connectionId}</dd>
          </div>
        </dl>
        <div className="form-actions">
          <Link className="button" to={`/connections/${connectionId}`}>
            {copy.success.goToConnection}
          </Link>
          <Link className="button button--secondary" to="/connections">
            {copy.success.viewAll}
          </Link>
        </div>
      </article>
    );
  }

  return (
    <PageLayout
      eyebrow={copy.eyebrow}
      title={copy.title}
      description={copy.description}
      summary={
        <div className="toolbar__group">
          <span className="toolbar-chip">{copy.oauthChip}</span>
          <span className="toolbar-chip">{copy.apiChip}</span>
        </div>
      }
    >
      {renderContent()}
    </PageLayout>
  );
}
