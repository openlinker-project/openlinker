/**
 * OfferCreationTracker
 *
 * Inline card that polls an OfferCreationRecord until terminal status. On
 * `active` it shows the external offer id; on `failed`/`draft` it renders the
 * structured error list. Today it is mounted read-only on the sync-job detail
 * page (a job whose payload carries an `offerCreationRecordId`) — no `onDismiss`,
 * so the error path renders inline rather than offering an action.
 *
 * Steady-state bulk offer creation is tracked on the bulk-batch progress page
 * (`/listings/bulk-batches/:batchId`), which owns its own status polling and the
 * "Retry all failed" affordance (#1754); this component no longer carries a
 * per-record Retry action.
 *
 * @module apps/web/src/features/listings/components
 */
import type { ReactElement, ReactNode } from 'react';
import { Button } from '../../../shared/ui/button';
import { interpolate, renderRich, useMessages } from '../../../shared/i18n';
import { usePlatforms } from '../../../shared/plugins';
import { resolvePlatformLabel } from '../../mappings';
import { useOfferCreationStatusQuery } from '../hooks/use-offer-creation-status-query';
import { TERMINAL_OFFER_CREATION_STATUSES } from '../api/listings.types';
import { buildAllegroSellerPanelUrl } from '../lib/allegro-seller-panel-url';
import { OfferCreationStatusBadge } from './offer-creation-status-badge';
import { OfferCreationErrorList } from './offer-creation-error-list';

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
}

export function OfferCreationTracker({
  connectionId,
  offerCreationRecordId,
  marketplacePlatformType,
  marketplaceEnvironment,
  onDismiss,
}: OfferCreationTrackerProps): ReactElement {
  const copy = useMessages('listings').offerCreationTracker;
  const query = useOfferCreationStatusQuery(connectionId, offerCreationRecordId);
  // The operator needs to know WHICH channel holds the draft, so the sentence
  // names it from the plugin registry; with no known platform it falls back
  // to the generic wording rather than inventing a name.
  const platforms = usePlatforms();
  const platform = marketplacePlatformType
    ? resolvePlatformLabel(platforms, marketplacePlatformType)
    : undefined;
  // The external id sits in mono inside the sentence, so it is passed as a
  // value and wrapped by the `<id>` tag rather than concatenated.
  const withExternalId = (withId: string, withoutId: string, externalId: string | null): ReactNode =>
    externalId
      ? renderRich(withId, { id: (text) => <span className="mono-text">{text}</span> }, {
          externalId,
          platform: platform ?? '',
        })
      : interpolate(withoutId, { platform: platform ?? '' });
  const draftCopy = platform ? copy.draft.onPlatform : copy.draft.anyPlatform;
  const reusedCopy = platform ? copy.reused.onPlatform : copy.reused.anyPlatform;

  if (query.isLoading) {
    return (
      <section className="offer-creation-tracker" aria-live="polite">
        <div className="offer-creation-tracker__header">
          <span className="offer-creation-tracker__label">{copy.label}</span>
          <span className="mono-text offer-creation-tracker__id" title={offerCreationRecordId}>
            {offerCreationRecordId}
          </span>
        </div>
        <p className="offer-creation-tracker__body">{copy.loading}</p>
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
          <span className="offer-creation-tracker__label">{copy.label}</span>
          <Button tone="ghost" onClick={onDismiss}>
            {copy.dismiss}
          </Button>
        </div>
        <p className="offer-creation-tracker__body">
          {interpolate(copy.loadFailed, { message: query.error.message })}
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
  const showDismiss = isTerminal && onDismiss !== undefined;

  return (
    <section
      className={`offer-creation-tracker offer-creation-tracker--${record.status}`}
      aria-live="polite"
    >
      <div className="offer-creation-tracker__header">
        <span className="offer-creation-tracker__label">{copy.label}</span>
        <OfferCreationStatusBadge status={record.status} />
        <span className="mono-text offer-creation-tracker__id" title={record.id}>
          {record.id}
        </span>
        {showDismiss ? (
          <Button tone="ghost" onClick={onDismiss}>
            {copy.dismiss}
          </Button>
        ) : null}
      </div>

      {!isTerminal ? (
        <p className="offer-creation-tracker__body">{copy.processing}</p>
      ) : null}

      {record.status === 'active' ? (
        <p className="offer-creation-tracker__body">
          {withExternalId(copy.live.withId, copy.live.withoutId, record.externalOfferId)}
        </p>
      ) : null}

      {record.status === 'reused' ? (
        <p className="offer-creation-tracker__body">
          {withExternalId(reusedCopy.withId, reusedCopy.withoutId, record.externalOfferId)}
        </p>
      ) : null}

      {record.status === 'draft' ? (
        <>
          <p className="offer-creation-tracker__body">
            {withExternalId(draftCopy.withId, draftCopy.withoutId, record.externalOfferId)}
            {sellerPanelUrl ? (
              <>
                {' '}
                <a href={sellerPanelUrl} target="_blank" rel="noopener noreferrer">
                  {interpolate(copy.draft.openSellerPanel, { platform: platform ?? '' })}
                </a>
              </>
            ) : null}
          </p>
          {record.errors && record.errors.length > 0 ? (
            <>
              <p className="offer-creation-tracker__body">{copy.draft.validationIssues}</p>
              <OfferCreationErrorList errors={record.errors} />
            </>
          ) : (
            <p className="offer-creation-tracker__body offer-creation-tracker__body--muted">
              {interpolate(draftCopy.noValidationIssues, { platform: platform ?? '' })}
            </p>
          )}
        </>
      ) : null}

      {record.status === 'failed' ? (
        <>
          <p className="offer-creation-tracker__body">{copy.failed}</p>
          <OfferCreationErrorList errors={record.errors} />
        </>
      ) : null}
    </section>
  );
}
