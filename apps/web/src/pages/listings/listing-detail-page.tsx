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
import { ListingMarketplaceOfferSection } from '../../features/listings/components/listing-marketplace-offer-section';
import { OfferCreationStatusBadge } from '../../features/listings/components/OfferCreationStatusBadge';
import { OfferCreationErrorList } from '../../features/listings/components/OfferCreationErrorList';
import { ConnectionEntityLabel } from '../../features/connections/components/ConnectionEntityLabel';
import { useVariantQuery } from '../../features/products/hooks/use-variant-query';
import type { ProductVariantSummary } from '../../features/products/api/products.types';
import {
  KNOWN_MAPPING_ENTITY_TYPES,
  type KnownMappingEntityType,
} from '../../features/listings/api/listings.types';

/**
 * Both `entityType === 'ProductVariant'` and `entityType === 'Offer'` mappings
 * store the linked variant's id as `internalId` (verified in the BE
 * `OfferMappingSyncService.linkOffer` path). Other entity types (`Product`,
 * `InventoryItem`, plus forward-compat unknowns) don't link to a variant —
 * we skip the SKU/EAN enrichment for those.
 */
function isVariantLinkedEntityType(value: string): boolean {
  return value === 'ProductVariant' || value === 'Offer';
}

const ENTITY_TYPE_ROUTES: Record<KnownMappingEntityType, (id: string) => string> = {
  Product: (id) => `/products/${id}`,
  ProductVariant: (id) => `/products/${id}`,
  InventoryItem: (id) => `/inventory/${id}`,
};

function isKnownEntityType(value: string): value is KnownMappingEntityType {
  return (KNOWN_MAPPING_ENTITY_TYPES as readonly string[]).includes(value);
}

function renderInternalIdValue(
  entityType: string,
  internalId: string,
  variant: ProductVariantSummary | undefined,
): ReactNode {
  // SKU/EAN enrichment renders inline next to the linked id when the variant
  // query has resolved (#464). Errors / 404s render quietly — the bare ID is
  // still useful by itself.
  const enrichment = variant ? (
    <span className="listing-detail-variant-tags">
      {variant.sku ? <span className="mono-text">SKU {variant.sku}</span> : null}
      {variant.ean ? <span className="mono-text">EAN {variant.ean}</span> : null}
    </span>
  ) : null;

  if (!isKnownEntityType(entityType)) {
    return (
      <>
        <span className="mono-text">{internalId}</span>
        {enrichment}
      </>
    );
  }
  const to = ENTITY_TYPE_ROUTES[entityType](internalId);
  return (
    <>
      <Link to={to} className="mono-text">
        {internalId}
      </Link>
      {enrichment}
    </>
  );
}

export function ListingDetailPage(): ReactElement {
  const { id = '' } = useParams<{ id: string }>();
  const query = useListingQuery(id);
  const [isEditDrawerOpen, setIsEditDrawerOpen] = useState(false);

  // The mapping query has to resolve before we can decide whether to fetch
  // the linked variant — disabled until then. The `enabled` flag in
  // useVariantQuery means an unset id never fires.
  const linkedVariantId =
    query.data && isVariantLinkedEntityType(query.data.entityType)
      ? query.data.internalId
      : undefined;
  const variantQuery = useVariantQuery(linkedVariantId);

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
      backTo={{ to: '/listings', label: 'Listings' }}
      eyebrow="Listings"
      title={`Mapping — ${mapping.externalId}`}
      actions={
        mapping.platformType.toLowerCase() === 'allegro' ? (
          <Button onClick={() => setIsEditDrawerOpen(true)}>
            Edit offer
          </Button>
        ) : undefined
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
              value: renderInternalIdValue(
                mapping.entityType,
                mapping.internalId,
                variantQuery.data,
              ),
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

      <ListingMarketplaceOfferSection
        mappingId={mapping.id}
        enabled={mapping.entityType === 'Offer'}
      />

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
