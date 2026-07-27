/**
 * OfferPublicationStatusPanel
 *
 * Operator-facing live publication status of a product's offers (#1760), read
 * from persisted `offer_status_snapshots`. Turns the "is my offer actually
 * live?" question into a persistent surface: an offer Allegro activated after
 * the creation poller terminalised its record as `draft` shows `Active` here
 * (the snapshot is authoritative), with a last-synced time and a per-offer
 * manual refresh that force-reads the live marketplace status.
 *
 * @module apps/web/src/features/listings/components
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useApiClient } from '../../../app/api/api-client-provider';
import { Button } from '../../../shared/ui/button';
import { EmptyState, ErrorState, LoadingState } from '../../../shared/ui/feedback-state';
import { TimeDisplay } from '../../../shared/ui/time-display';
import { listingsQueryKeys } from '../api/listings.query-keys';
import type { OfferPublicationStatusResponse } from '../api/listings.types';
import { useOfferPublicationStatusQuery } from '../hooks/use-offer-publication-status-query';
import { OfferPublicationStatusBadge } from './OfferPublicationStatusBadge';

interface OfferPublicationStatusPanelProps {
  productId: string;
  /** Gate the fetch until the surface is visible (e.g. drawer expanded). */
  enabled?: boolean;
}

export function OfferPublicationStatusPanel({
  productId,
  enabled = true,
}: OfferPublicationStatusPanelProps): ReactElement | null {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const query = useOfferPublicationStatusQuery(productId, undefined, { enabled });

  const refresh = useMutation({
    mutationFn: (offer: OfferPublicationStatusResponse) =>
      apiClient.listings.refreshOfferPublicationStatus(
        offer.connectionId,
        offer.externalOfferId,
        offer.internalVariantId,
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: listingsQueryKeys.offerPublicationStatus(productId),
      });
    },
  });

  if (!enabled) {
    return null;
  }

  if (query.isLoading) {
    return <LoadingState title="Loading publication status" message="Fetching live offer status…" />;
  }

  if (query.error) {
    return (
      <ErrorState
        title="Unable to load publication status"
        message={query.error.message}
        action={<Button onClick={() => void query.refetch()}>Retry</Button>}
      />
    );
  }

  const offers = query.data ?? [];
  if (offers.length === 0) {
    return (
      <EmptyState
        title="No live status yet"
        message="This product's offers haven't been synced from the marketplace yet."
      />
    );
  }

  const pendingOfferId = refresh.isPending
    ? (refresh.variables as OfferPublicationStatusResponse | undefined)?.externalOfferId
    : undefined;

  return (
    <div className="offer-publication-status">
      <ul className="offer-publication-status__list">
        {offers.map((offer) => {
          const isRefreshing = pendingOfferId === offer.externalOfferId;
          return (
            <li key={`${offer.connectionId}:${offer.externalOfferId}`} className="offer-publication-status__row">
              <OfferPublicationStatusBadge status={offer.publicationStatus} compact />
              <span className="offer-publication-status__id mono-text">{offer.externalOfferId}</span>
              <span className="sync-freshness">
                <span className="sync-freshness__dot" aria-hidden="true" />
                Synced <TimeDisplay iso={offer.lastStatusSyncedAt} format="relative" />
              </span>
              <Button
                tone="ghost"
                disabled={refresh.isPending}
                onClick={() => refresh.mutate(offer)}
              >
                {isRefreshing ? 'Refreshing…' : 'Refresh'}
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
