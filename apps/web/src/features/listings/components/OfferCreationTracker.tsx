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
import type { ReactElement } from 'react';
import { Button } from '../../../shared/ui/button';
import { useOfferCreationStatusQuery } from '../hooks/use-offer-creation-status-query';
import {
  TERMINAL_OFFER_CREATION_STATUSES,
  type OfferCreationStatusResponse,
} from '../api/listings.types';
import { buildAllegroSellerPanelUrl } from '../lib/allegro-seller-panel-url';
import { canReadCreateOfferRequestSnapshot } from './create-offer-request-to-form-values';
import { OfferCreationStatusBadge } from './OfferCreationStatusBadge';
import { OfferCreationErrorList } from './OfferCreationErrorList';

interface OfferCreationTrackerProps {
  connectionId: string;
  offerCreationRecordId: string;
  /** Platform type of the connection. When 'allegro' (and environment
   *  provided), the draft branch renders an "Open in Allegro seller
   *  panel" deep link. Optional so existing callers don't break. (#407) */
  marketplacePlatformType?: string;
  /** Connection environment ('sandbox' | 'production'). Used together with
   *  marketplacePlatformType to derive the seller-panel host. (#407) */
  marketplaceEnvironment?: string;
  /** Optional. When provided, a Dismiss button appears on terminal statuses
   *  and the error variant is rendered with a Dismiss action. When omitted,
   *  the consumer is treated as a static read-only surface (e.g. a page
   *  panel rather than a session-scoped tracker): no Dismiss button, and
   *  the error path renders nothing rather than an unactionable error
   *  message — matches the "gracefully shows nothing" guarantee that
   *  read-only consumers expect (#391). */
  onDismiss?: () => void;
  /** Invoked when the operator clicks Retry on a failed record. Only
   *  rendered when the record has a non-null `request` snapshot — without
   *  the snapshot the wizard cannot pre-fill, so we hide the action. */
  onRetry?: (record: OfferCreationStatusResponse) => void;
}

export function OfferCreationTracker({
  connectionId,
  offerCreationRecordId,
  marketplacePlatformType,
  marketplaceEnvironment,
  onDismiss,
  onRetry,
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
    // Read-only consumers (no onDismiss) are treated as "show nothing on
    // failure" — they have no way to dismiss the error UI and the surface
    // is informational, not actionable.
    if (onDismiss === undefined) {
      return <></>;
    }
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
  const sellerPanelUrl = buildAllegroSellerPanelUrl(
    marketplacePlatformType,
    marketplaceEnvironment,
    record.externalOfferId,
  );
  // Hide Retry when the snapshot is absent (old records) or carries a
  // schemaVersion this client does not know how to read. A server newer
  // than the client can persist v2+ snapshots; we must not silently
  // map them with v1 semantics.
  const canRetry =
    record.status === 'failed' &&
    onRetry !== undefined &&
    record.request != null &&
    canReadCreateOfferRequestSnapshot(record.request);
  const showDismiss = isTerminal && onDismiss !== undefined;

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
        {canRetry ? (
          <Button tone="secondary" onClick={() => onRetry?.(record)}>
            Retry
          </Button>
        ) : null}
        {showDismiss ? (
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

      {record.status === 'reused' ? (
        <p className="offer-creation-tracker__body">
          Offer already existed on the marketplace — reused the existing listing
          {record.externalOfferId ? (
            <>
              {' '}· external id{' '}
              <span className="mono-text">{record.externalOfferId}</span>
            </>
          ) : null}
          .
        </p>
      ) : null}

      {record.status === 'draft' ? (
        <>
          <p className="offer-creation-tracker__body">
            Offer created as a draft on Allegro
            {record.externalOfferId ? (
              <>
                {' '}· external id{' '}
                <span className="mono-text">{record.externalOfferId}</span>
              </>
            ) : null}
            .
            {sellerPanelUrl ? (
              <>
                {' '}
                <a href={sellerPanelUrl} target="_blank" rel="noopener noreferrer">
                  Open in Allegro seller panel
                </a>
              </>
            ) : null}
          </p>
          {record.errors && record.errors.length > 0 ? (
            <>
              <p className="offer-creation-tracker__body">
                Allegro reported validation issues that block publishing:
              </p>
              <OfferCreationErrorList errors={record.errors} />
            </>
          ) : (
            <p className="offer-creation-tracker__body offer-creation-tracker__body--muted">
              No inline validation issues — publish manually in the Allegro seller panel.
            </p>
          )}
        </>
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
