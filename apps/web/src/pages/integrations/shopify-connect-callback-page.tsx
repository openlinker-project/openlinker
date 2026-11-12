/**
 * Shopify OAuth Callback Page
 *
 * Where Shopify sends the operator after they approve the app (#3974). The
 * redirect query is handed to the API, which verifies Shopify's `hmac` and the
 * `shop` before the code is exchanged.
 */
import { useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useHandleShopifyCallback } from '../../features/shopify';
import { ApiError } from '../../shared/api/api-error';
import { describeApiError } from '../../shared/api/describe-api-error';
import { interpolate, useMessages } from '../../shared/i18n';
import { ErrorState, LoadingState } from '../../shared/ui/feedback-state';
import { PageLayout } from '../../shared/ui/page-layout';

function errorCode(error: unknown): string | null {
  return error instanceof ApiError ? (error.code ?? null) : null;
}

/** The query to forward, or null when the redirect lacks the code or the state. */
function readRedirectQuery(): string | null {
  const search = window.location.search;
  const params = new URLSearchParams(search);
  return params.get('code') && params.get('state') ? search : null;
}

export function ShopifyConnectCallbackPage(): ReactElement {
  const copy = useMessages('shopify').callback;
  const [rawQuery] = useState(readRedirectQuery);
  const state = useHandleShopifyCallback(rawQuery);

  function renderContent(): ReactElement {
    const startOver = (
      <Link className="button" to="/connections/new/shopify">
        {copy.startOver}
      </Link>
    );
    if (rawQuery === null) {
      return <ErrorState title={copy.missingTitle} message={copy.missing} action={startOver} />;
    }
    switch (state.status) {
      case 'idle':
      case 'pending':
        return <LoadingState title={copy.loadingTitle} message={copy.loading} />;
      case 'error': {
        const code = errorCode(state.error);
        if (code === 'OAUTH_STATE_INVALID') {
          return (
            <ErrorState
              title={copy.alreadyUsedTitle}
              message={copy.alreadyUsed}
              action={
                <Link className="button" to="/connections">
                  {copy.viewAll}
                </Link>
              }
            />
          );
        }
        const message =
          code === 'OAUTH_CALLBACK_UNVERIFIED'
            ? copy.unverified
            : interpolate(copy.failedPrefix, {
                message: describeApiError(state.error, 'shopify'),
              });
        return <ErrorState title={copy.failedTitle} message={message} action={startOver} />;
      }
      case 'success':
        return (
          <article className="panel panel--dense">
            <div className="panel__header">
              <h3 className="section-title">{copy.successTitle}</h3>
            </div>
            <dl className="definition-list">
              <div>
                <dt>{copy.name}</dt>
                <dd>{state.data.connectionName}</dd>
              </div>
            </dl>
            <div className="form-actions">
              <Link className="button" to={`/connections/${state.data.connectionId}`}>
                {copy.goToConnection}
              </Link>
              <Link className="button button--secondary" to="/connections">
                {copy.viewAll}
              </Link>
            </div>
          </article>
        );
    }
  }

  return (
    <PageLayout eyebrow="Shopify" title={copy.title} description={copy.description}>
      {renderContent()}
    </PageLayout>
  );
}
