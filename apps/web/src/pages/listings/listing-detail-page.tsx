import type { ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { LoadingState, ErrorState } from '../../shared/ui/feedback-state';
import { Button } from '../../shared/ui/button';
import { useListingQuery } from '../../features/listings/hooks/use-listing-query';

export function ListingDetailPage(): ReactElement {
  const { id = '' } = useParams<{ id: string }>();
  const query = useListingQuery(id);

  if (query.isLoading) {
    return (
      <PageLayout eyebrow="Listings" title="Offer mapping">
        <LoadingState liveRegion="off" title="Loading offer mapping" message="Fetching mapping details…" />
      </PageLayout>
    );
  }

  if (query.error || !query.data) {
    return (
      <PageLayout eyebrow="Listings" title="Offer mapping">
        <ErrorState
          title="Unable to load offer mapping"
          message={query.error?.message ?? 'Offer mapping not found'}
          action={<Button onClick={() => { void query.refetch(); }}>Retry</Button>}
        />
      </PageLayout>
    );
  }

  const mapping = query.data;

  return (
    <PageLayout
      eyebrow="Listings"
      title={`Mapping — ${mapping.externalId}`}
      actions={
        <Link to=".." relative="path" className="button button--ghost">
          ← Back to listings
        </Link>
      }
    >
      <section className="detail-section">
        <dl className="detail-list">
          <div className="detail-list__row">
            <dt>Mapping ID</dt>
            <dd><span className="mono-text">{mapping.id}</span></dd>
          </div>
          <div className="detail-list__row">
            <dt>Entity Type</dt>
            <dd><span className="mono-text">{mapping.entityType}</span></dd>
          </div>
          <div className="detail-list__row">
            <dt>External ID</dt>
            <dd><span className="mono-text">{mapping.externalId}</span></dd>
          </div>
          <div className="detail-list__row">
            <dt>Internal ID</dt>
            <dd><span className="mono-text">{mapping.internalId}</span></dd>
          </div>
          <div className="detail-list__row">
            <dt>Platform Type</dt>
            <dd><span className="mono-text">{mapping.platformType}</span></dd>
          </div>
          <div className="detail-list__row">
            <dt>Connection ID</dt>
            <dd><span className="mono-text">{mapping.connectionId}</span></dd>
          </div>
          <div className="detail-list__row">
            <dt>Created</dt>
            <dd>{new Date(mapping.createdAt).toLocaleString()}</dd>
          </div>
          <div className="detail-list__row">
            <dt>Updated</dt>
            <dd>{new Date(mapping.updatedAt).toLocaleString()}</dd>
          </div>
        </dl>
      </section>

      {mapping.context !== null ? (
        <section className="detail-section">
          <h2 className="detail-section__title">Context</h2>
          <pre className="mono-text" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {JSON.stringify(mapping.context, null, 2)}
          </pre>
        </section>
      ) : null}
    </PageLayout>
  );
}
