/**
 * OfferCreationTracker
 *
 * Inline card on the listings list page that polls an OfferCreationRecord
 * until terminal status. On `active` it shows the external offer id and
 * the `listings` cache has already been invalidated by the create-offer
 * mutation. On `failed` it renders the structured error list.
 *
 * Lives only for the session — the list page stores the active tracker
 * in URL search params (`offerCreationRecordId`, `connectionId`) so it
 * survives accidental drawer close / client-side navigation. Refreshing
 * the page clears the tracker; the record itself is persisted server
 * side and can be re-tracked when a "Recent creations" view is added.
 *
 * @module apps/web/src/features/listings/components
 */
import { type ReactElement } from 'react';
import { Button } from '../../../shared/ui/button';
import { useOfferCreationStatusQuery } from '../hooks/use-offer-creation-status-query';
import { TERMINAL_OFFER_CREATION_STATUSES } from '../api/listings.types';
import { OfferCreationStatusBadge } from './OfferCreationStatusBadge';
import { OfferCreationErrorList } from './OfferCreationErrorList';

interface OfferCreationTrackerProps {
  connectionId: string;
  offerCreationRecordId: string;
  onDismiss: () => void;
}

export function OfferCreationTracker({
  connectionId,
  offerCreationRecordId,
  onDismiss,
}: OfferCreationTrackerProps): ReactElement {
  const query = useOfferCreationStatusQuery(connectionId, offerCreationRecordId);

  if (query.isLoading) {
    return (
      <section className="offer-creation-tracker" aria-live="polite">
        <div className="offer-creation-tracker__header">
          <span className="offer-creation-tracker__label">Offer creation</span>
          <span className="mono-text offer-creation-tracker__id" title={offerCreationRecordId}>
            {offerCreationRecordId}
          </span>
        </div>
        <p className="offer-creation-tracker__body">Loading status…</p>
      </section>
    );
  }

  if (query.error) {
    return (
      <section className="offer-creation-tracker offer-creation-tracker--error" aria-live="polite">
        <div className="offer-creation-tracker__header">
          <span className="offer-creation-tracker__label">Offer creation</span>
          <Button tone="ghost" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
        <p className="offer-creation-tracker__body">
          Unable to load status: {query.error.message}
        </p>
      </section>
    );
  }

  const record = query.data;
  if (!record) {
    return <></>;
  }

  const isTerminal = TERMINAL_OFFER_CREATION_STATUSES.includes(record.status);

  return (
    <section
      className={`offer-creation-tracker offer-creation-tracker--${record.status}`}
      aria-live="polite"
    >
      <div className="offer-creation-tracker__header">
        <span className="offer-creation-tracker__label">Offer creation</span>
        <OfferCreationStatusBadge status={record.status} />
        <span className="mono-text offer-creation-tracker__id" title={record.id}>
          {record.id}
        </span>
        {isTerminal ? (
          <Button tone="ghost" onClick={onDismiss}>
            Dismiss
          </Button>
        ) : null}
      </div>

      {!isTerminal ? (
        <p className="offer-creation-tracker__body">
          Still processing — the status will update automatically.
        </p>
      ) : null}

      {record.status === 'active' ? (
        <p className="offer-creation-tracker__body">
          Offer is live
          {record.externalOfferId ? (
            <>
              {' '}· external id{' '}
              <span className="mono-text">{record.externalOfferId}</span>
            </>
          ) : null}
          .
        </p>
      ) : null}

      {record.status === 'failed' ? (
        <>
          <p className="offer-creation-tracker__body">
            Offer creation failed. Review the errors below and submit a new offer with
            the corrected values.
          </p>
          <OfferCreationErrorList errors={record.errors} />
        </>
      ) : null}
    </section>
  );
}
