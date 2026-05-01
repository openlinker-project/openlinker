/**
 * ListingMarketplaceOfferSection — live marketplace offer details (#464).
 *
 * Embedded state machine on the listing detail page. Fails soft so the rest
 * of the page (raw mapping fields + OfferCreation panel) keeps rendering:
 *
 *   - 404 — never expected here (the page already loaded the mapping); if it
 *     happens we treat it as the soft fallback so we don't double-error.
 *   - 422 — adapter doesn't implement OfferReader. Show the soft fallback.
 *   - 5xx / network / unknown — show ErrorState with retry; raw mapping below
 *     stays visible because this is a section, not a page-level state.
 *   - Loading — inline LoadingState.
 *   - Data — thumbnail + title + status badge + price + qty + category +
 *     description preview (collapsed, expandable).
 */
import type { ReactElement } from 'react';
import { Button } from '../../../shared/ui/button';
import { ErrorState, LoadingState } from '../../../shared/ui/feedback-state';
import { KeyValueList } from '../../../shared/ui/key-value-list';
import { ProductThumbnail } from '../../../shared/ui/product-thumbnail';
import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui/status-badge';
import { TimeDisplay } from '../../../shared/ui/time-display';
import { ApiError } from '../../../shared/api/api-error';
import { useListingMarketplaceOfferQuery } from '../hooks/use-listing-marketplace-offer-query';

interface ListingMarketplaceOfferSectionProps {
  mappingId: string;
  /** When the parent mapping isn't an offer the section is a no-op — page renders nothing extra. */
  enabled: boolean;
}

/**
 * Map marketplace-native status strings to our restrained badge palette.
 * Unknown statuses render with the neutral tone (no exception thrown — the
 * status field is intentionally a string passthrough).
 */
function statusTone(status: string): StatusBadgeTone {
  const normalised = status.trim().toUpperCase();
  if (normalised === 'ACTIVE' || normalised === 'BIDDING') return 'success';
  if (normalised === 'ENDED' || normalised === 'INACTIVE') return 'warning';
  return 'neutral';
}

export function ListingMarketplaceOfferSection({
  enabled,
  mappingId,
}: ListingMarketplaceOfferSectionProps): ReactElement | null {
  const query = useListingMarketplaceOfferQuery(mappingId, { enabled });

  if (!enabled) {
    return null;
  }

  if (query.isLoading) {
    return (
      <section className="detail-section">
        <h3 className="detail-section__title">Listing details</h3>
        <LoadingState
          liveRegion="off"
          title="Loading listing details"
          message="Fetching live marketplace state…"
        />
      </section>
    );
  }

  if (query.error) {
    // 422 → adapter doesn't implement OfferReader; render the soft fallback
    // rather than the error UI. 404 (defensive — shouldn't happen since the
    // page already loaded the mapping) gets the same soft treatment.
    if (query.error instanceof ApiError && (query.error.status === 422 || query.error.status === 404)) {
      return (
        <section className="detail-section">
          <h3 className="detail-section__title">Listing details</h3>
          <p className="detail-section__muted">
            Live data unavailable for this adapter.
          </p>
        </section>
      );
    }

    return (
      <section className="detail-section">
        <h3 className="detail-section__title">Listing details</h3>
        <ErrorState
          title="Unable to load listing details"
          message={query.error.message}
          action={
            <Button onClick={(): void => { void query.refetch(); }}>
              Retry
            </Button>
          }
        />
      </section>
    );
  }

  const offer = query.data;
  if (!offer) {
    return null;
  }

  const formattedPrice = `${offer.price.amount} ${offer.price.currency}`;

  return (
    <section className="detail-section listing-marketplace-offer">
      <div className="listing-marketplace-offer__header">
        <ProductThumbnail size="md" name={offer.title} src={offer.imageUrl} />
        <div className="listing-marketplace-offer__heading">
          <h3 className="listing-marketplace-offer__title">{offer.title}</h3>
          <StatusBadge tone={statusTone(offer.status)}>{offer.status}</StatusBadge>
        </div>
      </div>
      <KeyValueList
        items={[
          {
            id: 'externalId',
            label: 'External ID',
            value: offer.externalId,
            mono: true,
          },
          { id: 'price', label: 'Price', value: formattedPrice, mono: true },
          {
            id: 'availableQuantity',
            label: 'Available quantity',
            value: String(offer.availableQuantity),
            mono: true,
          },
          ...(offer.category
            ? [
                {
                  id: 'category',
                  label: 'Category',
                  value: offer.category.name ?? offer.category.id,
                  mono: !offer.category.name,
                },
              ]
            : []),
          ...(offer.marketplaceUrl
            ? [
                {
                  id: 'marketplaceUrl',
                  label: 'Marketplace',
                  value: (
                    <a
                      href={offer.marketplaceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open on marketplace ↗
                    </a>
                  ),
                },
              ]
            : []),
          ...(offer.updatedAt
            ? [
                {
                  id: 'updatedAt',
                  label: 'Marketplace-side updated',
                  value: <TimeDisplay iso={offer.updatedAt} />,
                },
              ]
            : []),
        ]}
      />
      {offer.description ? (
        <details className="listing-marketplace-offer__description">
          <summary>Description preview</summary>
          <p className="listing-marketplace-offer__description-body">{offer.description}</p>
        </details>
      ) : null}
    </section>
  );
}
