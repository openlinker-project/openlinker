/**
 * ListingPeek (#4046)
 *
 * What a listings row opens (row click, the arrow column or a card): the
 * shared `PeekPanel` with the product name linking to the listing page, the
 * variant, external offer id and connection, and the price on channel. The
 * body leads with Open listing, Open product (when the listing is linked),
 * Edit offer and Check status, then the reason as a callout, a Lifecycle /
 * On channel / Status read state card and the identifiers. ↑ ↓ / j k walk the
 * rows. The listing page stays: this is the faster first stop.
 *
 * The page builds the cells (the same renderers the table uses), so the peek
 * and the row can never disagree about a listing.
 *
 * @module apps/web/src/pages/listings
 */
import type { ReactElement, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMessages } from '../../shared/i18n';
import { Button } from '../../shared/ui/button';
import { PeekPanel, PeekStateCard } from '../../shared/ui/peek-panel';
import { ProductGallery } from '../../features/products/components/product-gallery';
import type { OfferMapping } from '../../features/listings/api/listings.types';

export interface ListingPeekView {
  row: OfferMapping;
  title: string;
  thumbnail: ReactNode;
  variant: string | null;
  connection: ReactNode;
  price: ReactNode;
  lifecycle: ReactNode;
  onChannel: ReactNode;
  statusRead: ReactNode;
  channel: string;
  /** The listing's reason line; `muted` when it reports a state, not work. */
  reason: { text: string; title: string; muted?: boolean } | null;
  /** Present only when the operator may edit the offer. */
  onEdit?: () => void;
  /** Present only when the operator may refresh the status. */
  onCheckStatus?: () => void;
  checkingStatus: boolean;
}

export interface ListingPeekProps {
  view: ListingPeekView | null;
  position: number;
  count: number;
  onNavigate: (step: -1 | 1) => void;
  onOpenChange: (open: boolean) => void;
}

export function ListingPeek({ view, position, count, onNavigate, onOpenChange }: ListingPeekProps): ReactElement {
  const copy = useMessages('listings').listingsListPage.peek;
  const row = view?.row;
  const listingHref = row ? `/listings/${encodeURIComponent(row.id)}` : '';
  return (
    <PeekPanel
      open={view !== null}
      onOpenChange={onOpenChange}
      position={position}
      count={count}
      onNavigate={onNavigate}
      bodyKey={row?.id}
      description={copy.description}
      title={
        view && row ? (
          <span className="peek-panel__ref listing-peek__id">
            {view.thumbnail}
            <Link className="peek-panel__title-link" to={listingHref}>
              {view.title}
              <span className="peek-panel__title-arrow" aria-hidden="true">
                ↗
              </span>
            </Link>
          </span>
        ) : (
          copy.kicker
        )
      }
      meta={
        view && row ? (
          <span className="peek-panel__meta">
            {view.variant ? <span>{view.variant}</span> : null}
            <span className="mono-text">{row.externalId}</span>
            {view.connection}
          </span>
        ) : null
      }
      headerAside={
        view ? (
          <span className="listing-peek__price">
            <span className="peek-panel__total tabular">{view.price}</span>
            <span className="text-muted">{copy.onChannel}</span>
          </span>
        ) : null
      }
    >
      {view && row ? (
        <>
          <div className="peek-panel__actions">
            <Link className="button button--primary button--sm" to={listingHref}>
              {copy.openListing}
            </Link>
            {row.identity ? (
              <Link
                className="button button--secondary button--sm"
                to={`/products/${encodeURIComponent(row.identity.productId)}`}
              >
                {copy.openProduct}
              </Link>
            ) : null}
            {view.onEdit ? (
              <Button tone="secondary" className="button--sm" onClick={view.onEdit}>
                {copy.editOffer}
              </Button>
            ) : null}
            {view.onCheckStatus ? (
              <Button
                tone="secondary"
                className="button--sm"
                disabled={view.checkingStatus}
                onClick={view.onCheckStatus}
              >
                {view.checkingStatus ? copy.checkingStatus : copy.checkStatus}
              </Button>
            ) : null}
          </div>
          {view.reason ? (
            <div
              className={['listing-peek__reason', view.reason.muted ? 'listing-peek__reason--muted' : '']
                .filter(Boolean)
                .join(' ')}
              title={view.reason.title}
            >
              <span className="eyebrow">{copy.whyNotSelling}</span>
              <p>{view.reason.text}</p>
            </div>
          ) : null}
          {/* The product photo big enough to recognise it, with the product
              page's zoom (#4046 follow-up). */}
          <div className="peek-panel__media">
            <ProductGallery
              images={row.identity?.imageUrl ? [row.identity.imageUrl] : []}
              name={view.title}
              productId={row.identity?.productId}
            />
            <PeekStateCard
              label={copy.stateAria}
              rows={[
                { label: copy.lifecycle, value: view.lifecycle },
                { label: copy.onChannelRow, value: view.onChannel },
                { label: copy.statusRead, value: view.statusRead },
              ]}
            />
          </div>
          <dl className="listing-peek__facts">
            <div>
              <dt className="eyebrow">{copy.externalId}</dt>
              <dd className="mono-text">{row.externalId}</dd>
            </div>
            <div>
              <dt className="eyebrow">{copy.sku}</dt>
              <dd className="mono-text">{row.identity?.sku ?? '-'}</dd>
            </div>
            <div>
              <dt className="eyebrow">{copy.ean}</dt>
              <dd className="mono-text">{row.identity?.ean ?? '-'}</dd>
            </div>
            <div>
              <dt className="eyebrow">{copy.channel}</dt>
              <dd>{view.channel}</dd>
            </div>
          </dl>
        </>
      ) : null}
    </PeekPanel>
  );
}
