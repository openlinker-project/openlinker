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
import { OfferCreationStatusBadge } from '../../features/listings/components/OfferCreationStatusBadge';
import { OfferCreationErrorList } from '../../features/listings/components/OfferCreationErrorList';
import { ConnectionEntityLabel } from '../../features/connections/components/ConnectionEntityLabel';
import {
  KNOWN_MAPPING_ENTITY_TYPES,
  type KnownMappingEntityType,
} from '../../features/listings/api/listings.types';

const ENTITY_TYPE_ROUTES: Record<KnownMappingEntityType, (id: string) => string> = {
  Product: (id) => `/products/${id}`,
  ProductVariant: (id) => `/products/${id}`,
  InventoryItem: (id) => `/inventory/${id}`,
};

function isKnownEntityType(value: string): value is KnownMappingEntityType {
  return (KNOWN_MAPPING_ENTITY_TYPES as readonly string[]).includes(value);
}

function renderInternalIdValue(entityType: string, internalId: string): ReactNode {
  if (!isKnownEntityType(entityType)) return internalId;
  const to = ENTITY_TYPE_ROUTES[entityType](internalId);
  return (
    <Link to={to} className="mono-text">
      {internalId}
    </Link>
  );
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

      {mapping.offerCreation ? (
        <section className="detail-section">
          <div className="listing-detail-offer-creation__header">
            <h3 className="listing-detail-offer-creation__title">Offer creation</h3>
            <OfferCreationStatusBadge status={mapping.offerCreation.status} />
          </div>
          <KeyValueList
            items={[
              {
                id: 'offerCreationId',
                label: 'Record ID',
                value: mapping.offerCreation.id,
                mono: true,
              },
              {
                id: 'externalOfferId',
                label: 'External Offer ID',
                value: mapping.offerCreation.externalOfferId ?? '—',
                mono: true,
              },
              {
                id: 'offerCreationCreatedAt',
                label: 'Created',
                value: <TimeDisplay iso={mapping.offerCreation.createdAt} />,
              },
              {
                id: 'offerCreationUpdatedAt',
                label: 'Updated',
                value: <TimeDisplay iso={mapping.offerCreation.updatedAt} />,
              },
            ]}
          />
          {mapping.offerCreation.status === 'failed' ? (
            <OfferCreationErrorList errors={mapping.offerCreation.errors} />
          ) : null}
        </section>
      ) : null}

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
