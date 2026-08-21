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
 * A mapped offer with no snapshot yet is listed too, as `Not synced yet` with a
 * `Check status` action (#2039) — previously it was excluded from the read, so
 * the panel fell through to an empty state and the manual refresh, which is
 * rendered per offer row, could not be reached for the offers that needed it.
 *
 * Where the `/listings` row has one line and shows one reason, this panel has
 * room for all of them (#2231) and is where the operator lands after clicking
 * through. Each reason renders twice over: the sentence for the seller, and the
 * channel's own `code` in mono for whoever has to check it against the channel's
 * documentation or quote it in a support ticket. An offer with nothing wrong adds
 * nothing, so the panel stays quiet where nothing is wrong.
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
import type {
  OfferPublicationStatusResponse,
  OfferValidationProblem,
} from '../api/listings.types';
import { useOfferPublicationStatusQuery } from '../hooks/use-offer-publication-status-query';
import { OfferPublicationStatusBadge } from './offer-publication-status-badge';

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
    // Now genuinely "no offers", not "no status": an offer that exists without
    // a snapshot comes back with a null status and renders a row below (#2039).
    return (
      <EmptyState
        title="No offers on marketplaces"
        message="This product isn't listed on any marketplace connection yet."
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
                {offer.lastStatusSyncedAt === null ? (
                  'Never synced'
                ) : (
                  <>
                    Synced <TimeDisplay iso={offer.lastStatusSyncedAt} format="relative" />
                  </>
                )}
              </span>
              <Button
                tone="ghost"
                disabled={refresh.isPending}
                onClick={() => refresh.mutate(offer)}
              >
                {isRefreshing
                  ? 'Refreshing…'
                  : offer.publicationStatus === null
                    ? 'Check status'
                    : 'Refresh'}
              </Button>
              <OfferProblemList offer={offer} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Every reason this offer cannot sell, sentence plus raw channel code.
 *
 * Falls back to the flat `validationMessages` for a snapshot written before
 * #2231 (and for an older API build), so the panel renders what it always did
 * rather than going blank. Shop-level reasons are NOT filtered out here: unlike
 * the list, this panel shows one product's offers and has no table to put a
 * connection-level notice above, so hiding them would leave the operator with an
 * `Invalid` offer and no reason at all.
 */
function OfferProblemList({
  offer,
}: {
  offer: OfferPublicationStatusResponse;
}): ReactElement | null {
  const problems: OfferValidationProblem[] =
    offer.validationProblems && offer.validationProblems.length > 0
      ? offer.validationProblems
      : (offer.validationMessages ?? []).map((message) => ({ code: '', message, scope: 'offer' }));

  if (problems.length === 0) {
    return null;
  }

  return (
    <ul className="offer-publication-status__problems">
      {problems.map((problem, index) => (
        <li className="problem-line" key={`${problem.code ?? problem.message}:${index}`}>
          <span className="problem-line__mark" aria-hidden="true">
            ●
          </span>
          <span className="problem-line__text">
            {problem.summary ? <b>{problem.summary}. </b> : null}
            {problem.message}
          </span>
          {problem.code !== undefined ? (
            <span className="problem-line__code mono-text">{problem.code}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
