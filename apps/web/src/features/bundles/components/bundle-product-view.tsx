/**
 * Bundle product view (#3520, mockup "Zestaw poranny")
 *
 * What the Overview tab of a product shows when the product is a bundle: the
 * composition with each component's stock and what limits the set, the
 * bundle's offers per channel, the composition history with the open orders
 * still on an older version, and the live availability in the side rail.
 *
 * Everything here is read from the bundle definition and the listings of the
 * bundle variant; nothing is stored by this view.
 *
 * @module apps/web/src/features/bundles/components
 */
import { useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useMessages, formatPlural, interpolate, useFormat, useLocale } from '../../../shared/i18n';
import { ComposerSection } from '../../../shared/ui/composer-section';
import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui/status-badge';
import { useConnectionsQuery } from '../../connections';
import { useListingsQuery } from '../../listings/hooks/use-listings-query';
import type { OfferLifecycle } from '../../listings/api/listings.types';
import { computeBundleAvailability } from '../lib/bundle-availability';
import { splitBundlePrice } from '../lib/bundle-price-split';
import { BundleComponentList } from './bundle-component-list';
import { useBundleHistoryQuery, useBundleQuery } from '../hooks/use-bundle-queries';

const LIFECYCLE_TONE: Record<OfferLifecycle, StatusBadgeTone> = {
  Active: 'success',
  Draft: 'neutral',
  Invalid: 'error',
  Ended: 'neutral',
  Unsynced: 'neutral',
};

export interface BundleProductViewProps {
  bundleVariantId: string;
  productId: string;
}

export function BundleProductView({ bundleVariantId, productId }: BundleProductViewProps): ReactElement {
  const copy = useMessages('bundles').view;
  const { locale } = useLocale();
  const format = useFormat();
  const detail = useBundleQuery(bundleVariantId);
  const history = useBundleHistoryQuery(bundleVariantId, true);
  const listings = useListingsQuery({ internalId: bundleVariantId }, { limit: 50, offset: 0 });
  const connections = useConnectionsQuery();
  const [showSplit, setShowSplit] = useState(false);

  if (detail.isLoading) return <p className="text-muted">{copy.loading}</p>;
  if (detail.isError || !detail.data) return <p role="alert">{copy.loadFailed}</p>;
  const bundle = detail.data;
  const currency = bundle.bundle.currency ?? undefined;

  const rows = bundle.componentAvailability;
  const availability = computeBundleAvailability(
    rows.map((row) => ({
      name: row.summary.name ?? row.summary.sku ?? row.variantId,
      quantity: row.quantity,
      availableToPromise: row.availableToPromise,
    })),
  );
  const giftCount = rows.filter((row) => row.giftSlot === true).length;
  const split = splitBundlePrice(
    bundle.bundle.price,
    rows.map((row) => ({
      variantId: row.variantId,
      quantity: row.quantity,
      standalonePrice: row.summary.price,
      giftSlot: row.giftSlot === true,
    })),
  );

  const offerConnections = (connections.data ?? [])
    .filter((c) => c.status === 'active' && c.supportedCapabilities?.includes('OfferCreator'))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
  const offerRows = offerConnections.map((connection) => ({
    connection,
    listing: (listings.data?.items ?? []).find((l) => l.connectionId === connection.id) ?? null,
  }));
  const listedCount = offerRows.filter((row) => row.listing !== null).length;
  const wizardTo = (connectionId?: string): string => {
    const params = new URLSearchParams({ productIds: productId, variantIds: bundleVariantId });
    if (connectionId) params.set('connectionId', connectionId);
    return `/listings/bulk-create/wizard?${params.toString()}`;
  };

  const availabilityTone =
    availability.kind === 'known' ? (availability.bundles === 0 ? 'is-zero' : 'is-warn') : 'is-unk';
  const availabilityLine =
    availability.kind === 'known'
      ? availability.limitedBy === null
        ? interpolate(copy.availableLineOk, { n: availability.bundles })
        : interpolate(copy.availableLine, { n: availability.bundles, name: availability.limitedBy })
      : copy.availableLineUnknown;

  return (
    <div className="pm-grid" data-testid="bundle-product-view">
      <div className="pm-col">
        <ComposerSection
          title={copy.compositionTitle}
          aside={`${interpolate(copy.compositionAside, { n: rows.length })}${
            giftCount > 0 ? ` · ${interpolate(copy.giftCount, { n: giftCount })}` : ''
          }`}
          riseIndex={2}
        >
          <div className={`cx-avail ${availabilityTone}`} data-testid="bundle-view-availability-line">
            {availabilityLine}
          </div>
          <BundleComponentList components={rows} bundlesAvailable={availability.kind === 'known' ? availability.bundles : null} />
          <div className="pm-disc">
            <button
              type="button"
              className="pm-disc__btn"
              aria-expanded={showSplit}
              onClick={() => {
                setShowSplit((v) => !v);
              }}
            >
              <span className="pm-disc__caret" aria-hidden="true" />
              <span>{showSplit ? copy.priceSplitHide : copy.priceSplitShow}</span>
              <span className="pm-disc__sum">{copy.priceSplitInfoOnly}</span>
            </button>
            <div className={`pm-disc__body${showSplit ? ' is-open' : ''}`}>
              <div>
                <div className="pm-disc__inner">
                  {split.kind === 'ok' ? (
                    <div className="pm-doc">
                      {split.lines.map((line) => {
                        const row = rows.find((r) => r.variantId === line.variantId);
                        return (
                          <span key={line.variantId} className={`pm-doc__l${row?.giftSlot ? ' is-gift' : ''}`}>
                            <span>{row?.summary.name ?? line.variantId}</span>
                            <b className="mono tabular">{format.money(line.amount, currency)}</b>
                          </span>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </ComposerSection>

        <ComposerSection
          title={copy.offersTitle}
          aside={interpolate(copy.offersAside, { listed: listedCount, total: offerRows.length })}
          riseIndex={3}
        >
          <ul className="cx-offers" data-testid="bundle-view-offers">
            {offerRows.map(({ connection, listing }) => (
              <li key={connection.id}>
                <span>{connection.name}</span>
                {listing ? (
                  <>
                    <span>
                      <StatusBadge compact withDot tone={LIFECYCLE_TONE[listing.channelStatus?.lifecycle ?? 'Unsynced']}>
                        {copy.status[listing.channelStatus?.lifecycle ?? 'Unsynced']}
                      </StatusBadge>
                    </span>
                    <span className="mono tabular">
                      {listing.commercial?.availableQuantity != null
                        ? interpolate(copy.offerQty, { n: listing.commercial.availableQuantity })
                        : ''}
                      {listing.commercial?.price
                        ? ` · ${format.money(Number(listing.commercial.price), listing.commercial.currency ?? currency)}`
                        : ''}
                    </span>
                    <Link className="button button--ghost button--sm" to={`/listings?search=${encodeURIComponent(listing.externalId)}`}>
                      {copy.open}
                    </Link>
                  </>
                ) : (
                  <>
                    <span className="cx-sub">{copy.notListed}</span>
                    <span />
                    <Link className="button button--secondary button--sm" to={wizardTo(connection.id)}>
                      {copy.listHere}
                    </Link>
                  </>
                )}
              </li>
            ))}
          </ul>
          <p className="pm-help">{copy.noEan}</p>
        </ComposerSection>

        <ComposerSection
          title={copy.historyTitle}
          aside={history.data ? formatPlural(history.data.length, copy.versionsCount, locale) : undefined}
          riseIndex={4}
        >
          <ul className="pm-log" data-testid="bundle-view-history">
            {(history.data ?? []).map((entry) => (
              <li key={entry.version}>
                <span>
                  <b>{entry.current ? copy.currentVersion : interpolate(copy.version, { n: entry.version })}</b>
                  <span className="text-muted">
                    {interpolate(copy.since, { date: format.date(entry.createdAt) })} ·{' '}
                    {entry.components
                      .map((component, index) => {
                        const n = entry.componentSummaries[index]?.name ?? component.variantId;
                        return component.giftSlot ? `${n} (${copy.gift.toLowerCase()})` : n;
                      })
                      .join(', ')}
                  </span>
                </span>
                {entry.current ? (
                  <StatusBadge compact withDot tone="success">
                    {copy.active}
                  </StatusBadge>
                ) : entry.openOrders > 0 ? (
                  <span className="cx-tag cx-tag--quiet">{formatPlural(entry.openOrders, copy.openOrders, locale)}</span>
                ) : null}
              </li>
            ))}
          </ul>
          {bundle.openOrdersOnOlderComposition > 0 ? (
            <div className="cx-note">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v5M12 16v.5" />
              </svg>
              <p>{formatPlural(bundle.openOrdersOnOlderComposition, copy.openOrders, locale)}</p>
            </div>
          ) : null}
        </ComposerSection>
      </div>

      <aside className="pm-col pm-rail">
        <ComposerSection title={copy.availabilityTitle} aside={copy.liveAside} riseIndex={3}>
          <div className={`cx-avail ${availabilityTone}`} style={{ alignItems: 'flex-end' }}>
            {availability.kind === 'known' ? (
              <>
                <span className="cx-big mono tabular">
                  {availability.bundles} <small>{copy.bundlesWord}</small>
                </span>
                <span style={{ paddingBottom: 2 }}>
                  {availability.limitedBy === null
                    ? interpolate(copy.canAssembleOk, { n: availability.bundles })
                    : interpolate(copy.canAssemble, { n: availability.bundles, name: availability.limitedBy })}
                </span>
              </>
            ) : (
              <span>{copy.availableLineUnknown}</span>
            )}
          </div>
          <p className="pm-help">{copy.channelsGetNumber}</p>
        </ComposerSection>
        <ComposerSection title={copy.glanceTitle} riseIndex={4}>
          <div className="pm-kpis" style={{ gridTemplateColumns: 'minmax(0,1fr)' }}>
            <div className="pm-kpi">
              <span className="pm-kpi__l">{copy.priceGross}</span>
              <span className="pm-kpi__n mono tabular">
                {bundle.bundle.price === null ? '—' : format.money(bundle.bundle.price, currency)}
              </span>
              <span className="pm-kpi__s">{copy.asInShop}</span>
            </div>
          </div>
        </ComposerSection>
        <ComposerSection title={copy.whoTitle} riseIndex={5}>
          <p className="pm-help">{copy.whoBody}</p>
        </ComposerSection>
      </aside>
    </div>
  );
}
