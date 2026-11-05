import { type ReactElement, type ReactNode, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { LoadingState, ErrorState } from '../../shared/ui/feedback-state';
import { Button } from '../../shared/ui/button';
import { KeyValueList } from '../../shared/ui/key-value-list';
import { RawPayloadPanel } from '../../shared/ui/raw-payload-panel';
import { TimeDisplay } from '../../shared/ui/time-display';
import { usePlatform } from '../../shared/plugins';
import { interpolate, type Messages, type ResolvedCopy, useMessages } from '../../shared/i18n';
import { useListingQuery } from '../../features/listings/hooks/use-listing-query';
import { EditOfferDrawer } from '../../features/listings/components/edit-offer-drawer';
import { ListingMarketplaceOfferSection } from '../../features/listings/components/listing-marketplace-offer-section';
import { OfferCreationStatusBadge } from '../../features/listings/components/offer-creation-status-badge';
import { OfferCreationErrorList } from '../../features/listings/components/offer-creation-error-list';
import { ConnectionEntityLabel } from '../../features/connections/components/ConnectionEntityLabel';
import { useVariantQuery } from '../../features/products/hooks/use-variant-query';
import type { ProductVariantSummary } from '../../features/products/api/products.types';
import {
  KNOWN_MAPPING_ENTITY_TYPES,
  type KnownMappingEntityType,
} from '../../features/listings/api/listings.types';
import { serverErrorText } from '../../features/listings/lib/server-error-text';

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

/**
 * `InventoryItem` has no entry: its `internalId` is the inventory item's own
 * id, not a product id, and the standalone `/inventory/:id` page it used to
 * link to no longer exists (folded into Product detail's per-variant stock
 * table). No cheap synchronous id to route to, so it renders as plain text.
 */
const ENTITY_TYPE_ROUTES: Partial<Record<KnownMappingEntityType, (id: string) => string>> = {
  Product: (id) => `/products/${id}`,
  ProductVariant: (id) => `/products/${id}`,
};

function isKnownEntityType(value: string): value is KnownMappingEntityType {
  return (KNOWN_MAPPING_ENTITY_TYPES as readonly string[]).includes(value);
}

type ListingDetailCopy = ResolvedCopy<Messages['listings']>['listingDetailPage'];

function renderInternalIdValue(
  entityType: string,
  internalId: string,
  variant: ProductVariantSummary | undefined,
  copy: ListingDetailCopy,
): ReactNode {
  // SKU/EAN enrichment renders inline next to the linked id when the variant
  // query has resolved (#464). Errors / 404s render quietly — the bare ID is
  // still useful by itself.
  const enrichment = variant ? (
    <span className="listing-detail-variant-tags">
      {variant.sku ? (
        <span className="mono-text">{interpolate(copy.skuTag, { sku: variant.sku })}</span>
      ) : null}
      {variant.ean ? (
        <span className="mono-text">{interpolate(copy.eanTag, { ean: variant.ean })}</span>
      ) : null}
    </span>
  ) : null;

  const routeBuilder = isKnownEntityType(entityType) ? ENTITY_TYPE_ROUTES[entityType] : undefined;
  if (!routeBuilder) {
    return (
      <>
        <span className="mono-text">{internalId}</span>
        {enrichment}
      </>
    );
  }
  const to = routeBuilder(internalId);
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
  const copy = useMessages('listings').listingDetailPage;
  const common = useMessages('listings').common;
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
      <PageLayout eyebrow={copy.eyebrow} title={copy.title}>
        <LoadingState liveRegion="off" title={copy.loadingTitle} message={copy.loadingMessage} />
      </PageLayout>
    );
  }

  if (query.error || !query.data) {
    return (
      <PageLayout eyebrow={copy.eyebrow} title={copy.title}>
        <ErrorState
          title={copy.errorTitle}
          message={serverErrorText(common.serverSaid, query.error?.message, copy.notFound)}
          action={<Button onClick={() => { void query.refetch(); }}>{copy.retry}</Button>}
        />
      </PageLayout>
    );
  }

  const mapping = query.data;
  // Mapping `platformType` is the BE-denormalized copy of the connection's
  // `platformType` (architecture-overview §IdentifierMappingService) — always
  // canonical-cased, so direct lookup is safe.
  const mappingPlugin = usePlatform(mapping.platformType);

  return (
    <PageLayout
      backTo={{ to: '/listings', label: copy.eyebrow }}
      eyebrow={copy.eyebrow}
      title={interpolate(copy.mappingTitle, { externalId: mapping.externalId })}
      actions={
        mappingPlugin?.supportsListingEdit ? (
          <Button onClick={() => setIsEditDrawerOpen(true)}>{copy.editOffer}</Button>
        ) : undefined
      }
    >
      <section className="detail-section">
        <KeyValueList
          items={[
            { id: 'mappingId', label: copy.fields.mappingId, value: mapping.id, mono: true },
            { id: 'entityType', label: copy.fields.entityType, value: mapping.entityType, mono: true },
            { id: 'externalId', label: copy.fields.externalId, value: mapping.externalId, mono: true },
            {
              id: 'internalId',
              label: copy.fields.internalId,
              value: renderInternalIdValue(
                mapping.entityType,
                mapping.internalId,
                variantQuery.data,
                copy,
              ),
              mono: true,
            },
            { id: 'platform', label: copy.fields.platformType, value: mapping.platformType, mono: true },
            {
              id: 'connection',
              label: copy.fields.connection,
              value: <ConnectionEntityLabel connectionId={mapping.connectionId} />,
            },
            { id: 'createdAt', label: copy.fields.created, value: <TimeDisplay iso={mapping.createdAt} /> },
            { id: 'updatedAt', label: copy.fields.updated, value: <TimeDisplay iso={mapping.updatedAt} /> },
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
            <h3 className="listing-detail-offer-creation__title">{copy.offerCreation}</h3>
            <OfferCreationStatusBadge status={mapping.offerCreation.status} />
          </div>
          <KeyValueList
            items={[
              {
                id: 'offerCreationId',
                label: copy.fields.recordId,
                value: mapping.offerCreation.id,
                mono: true,
              },
              {
                id: 'externalOfferId',
                label: copy.fields.externalOfferId,
                value: mapping.offerCreation.externalOfferId ?? '—',
                mono: true,
              },
              {
                id: 'offerCreationCreatedAt',
                label: copy.fields.created,
                value: <TimeDisplay iso={mapping.offerCreation.createdAt} />,
              },
              {
                id: 'offerCreationUpdatedAt',
                label: copy.fields.updated,
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
          <RawPayloadPanel title={copy.contextTitle} payload={mapping.context} />
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
