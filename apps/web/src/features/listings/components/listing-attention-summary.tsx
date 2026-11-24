/**
 * ListingAttentionSummary (#4046)
 *
 * "Needs a look" beside the listings lifecycle tabs:
 *
 *   Needs a look  4 price changes · 3 blocked by shop · 1 selling deleted
 *
 * - price changes: the review queue's open count; opens the queue view.
 * - blocked by shop: listings carrying a shop-level (account-scoped) problem,
 *   counted across every page (#4045). It carries what the notice above the
 *   table used to say - the problem, its code and that it is reported against
 *   every listing on the connection - with Show these listings and Open
 *   connection.
 * - selling deleted: live offers still selling a product deleted in the shop;
 *   toggles that filter.
 *
 * An unknown number renders a dash, never 0.
 *
 * @module apps/web/src/features/listings/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { interpolate, useMessages, usePlural } from '../../../shared/i18n';
import { AttentionSummary, type AttentionGroup } from '../../../shared/ui/attention-summary';
import { Button } from '../../../shared/ui/button';
import type { OfferAttentionCounts } from '../api/listings.types';

export interface ListingAttentionSummaryProps {
  /** The price-change queue's open count; `null` while unknown. */
  priceChanges: number | null;
  onReviewPriceChanges: () => void;
  attention: OfferAttentionCounts | null;
  shopBlocked: boolean;
  /** Applies the shop-blocked filter, narrowed to one connection when given. */
  onShowShopBlocked: (connectionId: string | null) => void;
  onClearShopBlocked: () => void;
  sellingDeleted: boolean;
  onSellingDeletedChange: (on: boolean) => void;
  connectionName: (connectionId: string) => string | null;
}

export function ListingAttentionSummary({
  priceChanges,
  onReviewPriceChanges,
  attention,
  shopBlocked,
  onShowShopBlocked,
  onClearShopBlocked,
  sellingDeleted,
  onSellingDeletedChange,
  connectionName,
}: ListingAttentionSummaryProps): ReactElement {
  const copy = useMessages('listings').listingsListPage.attention;
  const plural = usePlural();
  const blocked = attention?.shopBlockedByConnection ?? [];

  const groups: AttentionGroup[] = [
    {
      id: 'price-changes',
      label: copy.priceChanges.label,
      short: copy.priceChanges.short,
      tone: 'warning',
      total: priceChanges ?? undefined,
      body: (close) => (
        <div className="attention-note">
          <p>{priceChanges === null ? copy.priceChanges.bodyUnknown : plural(priceChanges, copy.priceChanges.body)}</p>
          <Button
            className="button--sm"
            onClick={() => {
              close();
              onReviewPriceChanges();
            }}
          >
            {copy.priceChanges.review}
          </Button>
        </div>
      ),
    },
    {
      id: 'shop-blocked',
      label: copy.shopBlocked.label,
      short: copy.shopBlocked.short,
      tone: 'error',
      total: attention?.shopBlocked,
      body: (close) => (
        <div className="attention-note">
          {blocked.length === 0 ? <p>{copy.shopBlocked.none}</p> : null}
          {blocked.map((connection) => (
            <div key={connection.connectionId} className="attention-note__block">
              <p>
                <strong>
                  {interpolate(copy.shopBlocked.title, {
                    connection: connectionName(connection.connectionId) ?? copy.shopBlocked.unknownConnection,
                  })}
                </strong>{' '}
                {plural(connection.count, copy.shopBlocked.affected)}
              </p>
              <ul className="attention-note__problems">
                {connection.problems.map((problem) => (
                  <li key={`${problem.code ?? ''}:${problem.message}`}>
                    {problem.message}
                    {problem.code !== undefined ? (
                      <span className="problem-line__code mono-text">{problem.code}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
              <span className="button-group">
                <Button
                  className="button--sm"
                  onClick={() => {
                    close();
                    onShowShopBlocked(blocked.length > 1 ? connection.connectionId : null);
                  }}
                >
                  {copy.shopBlocked.show}
                </Button>
                <Link
                  className="button button--ghost button--sm"
                  to={`/connections/${encodeURIComponent(connection.connectionId)}`}
                  onClick={close}
                >
                  {copy.shopBlocked.openConnection}
                </Link>
              </span>
            </div>
          ))}
          {blocked.length > 0 ? <p className="text-muted">{copy.shopBlocked.scope}</p> : null}
          {shopBlocked ? (
            <Button
              tone="ghost"
              className="button--sm"
              onClick={() => {
                close();
                onClearShopBlocked();
              }}
            >
              {copy.shopBlocked.clear}
            </Button>
          ) : null}
        </div>
      ),
    },
    {
      id: 'selling-deleted',
      label: copy.sellingDeleted.label,
      short: copy.sellingDeleted.short,
      tone: 'error',
      total: attention?.sellingDeletedProduct,
      items: [
        {
          id: 'selling-deleted',
          label: copy.sellingDeleted.itemTitle,
          desc: copy.sellingDeleted.itemDesc,
          tone: 'error',
          on: sellingDeleted,
          count: attention?.sellingDeletedProduct,
          toggle: (): void => {
            onSellingDeletedChange(!sellingDeleted);
          },
        },
      ],
    },
  ];

  return <AttentionSummary groups={groups} label={copy.label} />;
}
