import { type ReactElement, type ReactNode, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { LoadingState, ErrorState } from '../../shared/ui/feedback-state';
import { Button } from '../../shared/ui/button';
import { KeyValueList } from '../../shared/ui/key-value-list';
import { RawPayloadPanel } from '../../shared/ui/raw-payload-panel';
import { TimeDisplay } from '../../shared/ui/time-display';
import { useListingQuery } from '../../features/listings/hooks/use-listing-query';
import { EditOfferDrawer } from '../../features/listings/components/EditOfferDrawer';
import { ConnectionEntityLabel } from '../../features/connections/components/ConnectionEntityLabel';

function renderInternalIdValue(entityType: string, internalId: string): ReactNode {
  if (entityType === 'Product' || entityType === 'ProductVariant') {
    return (
      <Link to={`/products/${internalId}`} className="mono-text">
        {internalId}
      </Link>
    );
  }
  if (entityType === 'InventoryItem') {
    return (
      <Link to={`/inventory/${internalId}`} className="mono-text">
        {internalId}
      </Link>
    );
  }
  return internalId;
}

export function ListingDetailPage(): ReactElement {
  const { id = '' } = useParams<{ id: string }>();
  const query = useListingQuery(id);
  const [isEditDrawerOpen, setIsEditDrawerOpen] = useState(false);

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
        <>
          {mapping.platformType.toLowerCase() === 'allegro' ? (
            <Button onClick={() => setIsEditDrawerOpen(true)}>
              Edit offer
            </Button>
          ) : null}
          <Link to=".." relative="path" className="button button--ghost">
            ← Back to listings
          </Link>
        </>
      }
    >
      <section className="detail-section">
        <KeyValueList
          items={[
            { id: 'mappingId', label: 'Mapping ID', value: mapping.id, mono: true },
            { id: 'entityType', label: 'Entity Type', value: mapping.entityType, mono: true },
            { id: 'externalId', label: 'External ID', value: mapping.externalId, mono: true },
            {
              id: 'internalId',
              label: 'Internal ID',
              value: renderInternalIdValue(mapping.entityType, mapping.internalId),
              mono: true,
            },
            { id: 'platform', label: 'Platform Type', value: mapping.platformType, mono: true },
            {
              id: 'connection',
              label: 'Connection',
              value: <ConnectionEntityLabel connectionId={mapping.connectionId} />,
            },
            { id: 'createdAt', label: 'Created', value: <TimeDisplay iso={mapping.createdAt} /> },
            { id: 'updatedAt', label: 'Updated', value: <TimeDisplay iso={mapping.updatedAt} /> },
          ]}
        />
      </section>

      {mapping.context !== null ? (
        <section className="detail-section">
          <RawPayloadPanel title="Context" payload={mapping.context} />
        </section>
      ) : null}

      <EditOfferDrawer
        isOpen={isEditDrawerOpen}
        onClose={() => setIsEditDrawerOpen(false)}
        mapping={mapping}
      />
    </PageLayout>
  );
}
