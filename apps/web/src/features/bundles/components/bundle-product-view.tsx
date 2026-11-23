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
import { useMemo, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useMessages, formatPlural, interpolate, useFormat, useLocale } from '../../../shared/i18n';
import { ComposerSection } from '../../../shared/ui/composer-section';
import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui/status-badge';
import { useTopProductVariantSalesQuery } from '../../analytics';
import { useConnectionsQuery } from '../../connections';
import { useListingsQuery, type OfferLifecycle } from '../../listings';
import { computeBundleAvailability } from '../lib/bundle-availability';
import { namedPackSize } from '../lib/bundle-form-model';
import { splitBundlePrice } from '../lib/bundle-price-split';
import { describeComponents, diffAgainst } from './bundle-history';
import { BundleComponentList } from './bundle-component-list';
import { BundleJourney } from './bundle-journey';
import { useBundleHistoryQuery, useBundleQuery } from '../hooks/use-bundle-queries';

const LIFECYCLE_TONE: Record<OfferLifecycle, StatusBadgeTone> = {
  Active: 'success',
  Draft: 'neutral',
  Invalid: 'error',
  Ended: 'neutral',
  Unsynced: 'neutral',
};

/** Connection names can carry the time they were created, which only crowds the row. */
const TRAILING_TIMESTAMP = /\s*\(\d{4}-\d{2}-\d{2}T[^)]*\)\s*$/;
const displayConnectionName = (name: string): string => name.replace(TRAILING_TIMESTAMP, '');

export interface BundleProductViewProps {
  bundleVariantId: string;
  productId: string;
}

export function BundleProductView({
  bundleVariantId,
  productId,
}: BundleProductViewProps): ReactElement {
  const allCopy = useMessages('bundles');
  const copy = allCopy.view;
  const { locale } = useLocale();
  const format = useFormat();
  const detail = useBundleQuery(bundleVariantId);
  const history = useBundleHistoryQuery(bundleVariantId, true);
  const listings = useListingsQuery({ internalId: bundleVariantId }, { limit: 50, offset: 0 });
  const connections = useConnectionsQuery();
  const [showSplit, setShowSplit] = useState(false);
  const soldRange = useMemo(() => {
    const day = 24 * 60 * 60 * 1000;
    const iso = (d: Date): string => d.toISOString().slice(0, 10);
    const now = Date.now();
    return { from: iso(new Date(now - 29 * day)), to: iso(new Date(now)) };
  }, []);
  const sold = useTopProductVariantSalesQuery(productId, soldRange, { enabled: true });

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
    }))
  );
  // A component the shop no longer returns has neither name nor SKU (the list tags
  // it "removed"); the set cannot be assembled, whatever the other stocks say.
  const removedCount = rows.filter(
    (row) => row.summary.name === null && row.summary.sku === null
  ).length;
  const priceable = rows.filter((row) => row.giftSlot !== true);
  const componentsSum =
    bundle.bundle.price !== null &&
    priceable.length > 0 &&
    priceable.every((row) => row.summary.price !== null)
      ? priceable.reduce((sum, row) => sum + row.quantity * (row.summary.price ?? 0), 0)
      : null;
  const discountToday =
    componentsSum !== null && componentsSum > 0 && bundle.bundle.price !== null
      ? componentsSum - bundle.bundle.price
      : null;
  // The name promises a pack size the composition does not hold (one product, another quantity).
  const namedSize = namedPackSize(`${bundle.bundle.name ?? ''} ${bundle.bundle.sku ?? ''}`);
  const nameMismatch =
    rows.length === 1 && namedSize !== null && namedSize !== rows[0].quantity
      ? { named: namedSize, actual: rows[0].quantity }
      : null;
  const giftCount = rows.filter((row) => row.giftSlot === true).length;
  const split = splitBundlePrice(
    bundle.bundle.price,
    rows.map((row) => ({
      variantId: row.variantId,
      quantity: row.quantity,
      standalonePrice: row.summary.price,
      giftSlot: row.giftSlot === true,
    }))
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

  const nextAction =
    availability.kind === 'known' && availability.limitedBy !== null && availability.bundles <= 3
      ? interpolate(copy.nextRestock, { name: availability.limitedBy, n: availability.bundles })
      : null;
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
        <BundleJourney
          componentCount={rows.length}
          listedCount={listedCount}
          channelCount={offerRows.length}
          sold={
            sold.data
              ? sold.data.variants
                  .filter((v) => v.variantId === bundleVariantId)
                  .reduce((sum, v) => sum + v.units, 0)
              : null
          }
          listHref={wizardTo()}
        />
        {removedCount > 0 ? (
          <div className="ux-removed-banner" role="alert" data-testid="bundle-view-removed-banner">
            <strong>{copy.removedTitle}</strong>
            <p>{interpolate(copy.removedBody, { n: removedCount })}</p>
          </div>
        ) : null}
        {nextAction !== null ? (
          <div className="ux-next-strip" data-testid="bundle-next-action">
            <span>{nextAction}</span>
          </div>
        ) : null}
        <ComposerSection
          title={copy.compositionTitle}
          aside={`${formatPlural(rows.length, allCopy.form.componentsCount, locale)}${
            giftCount > 0 ? ` · ${interpolate(copy.giftCount, { n: giftCount })}` : ''
          }`}
          riseIndex={2}
        >
          {/* The rail card already states "N bundles, limited by X"; repeat it
              here only when it is an alert (zero or unknown). */}
          {removedCount > 0 ? (
            <div className="cx-avail is-zero" data-testid="bundle-view-availability-line">
              {copy.removedAvailabilityLine}
            </div>
          ) : availability.kind !== 'known' || availability.bundles === 0 ? (
            <div
              className={`cx-avail ${availabilityTone}`}
              data-testid="bundle-view-availability-line"
            >
              {availabilityLine}
            </div>
          ) : null}
          <BundleComponentList
            components={rows}
            bundlesAvailable={availability.kind === 'known' ? availability.bundles : null}
          />
          {listedCount > 0 ? (
            <p className="pm-help" data-testid="bundle-view-edit-offers-note">
              {formatPlural(listedCount, copy.editOffersNote, locale)}
            </p>
          ) : null}
          {nameMismatch !== null ? (
            <p className="pm-help ux-name-mismatch" role="note" data-testid="bundle-view-name-mismatch">
              {interpolate(copy.nameMismatch, nameMismatch)}{' '}
              <Link to={`/products/bundles/${encodeURIComponent(bundleVariantId)}`}>
                {copy.nameMismatchEdit}
              </Link>
            </p>
          ) : null}
          <p className="pm-help" data-testid="bundle-view-price-stays">
            {copy.priceStaysNote}
            {discountToday !== null && componentsSum !== null
              ? ` ${
                  discountToday >= 0
                    ? interpolate(copy.discountToday, {
                        pct: format.number(Math.round((discountToday / componentsSum) * 100)),
                      })
                    : interpolate(copy.discountNegative, {
                        amount: format.money(-discountToday, currency),
                      })
                }`
              : ''}
          </p>
          <p className="bundle-dup">
            <Link
              className="button button--secondary button--sm"
              data-testid="bundle-view-duplicate"
              to={`/products/bundles/new?from=${encodeURIComponent(bundleVariantId)}`}
            >
              {copy.duplicate}
            </Link>
            <span className="pm-help">{copy.duplicateHint}</span>
          </p>
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
                          <span
                            key={line.variantId}
                            className={`pm-doc__l${row?.giftSlot ? ' is-gift' : ''}`}
                          >
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
          aside={formatPlural(offerRows.length, copy.offersAside, locale, { listed: listedCount })}
          riseIndex={3}
        >
          {listedCount === 0 && offerRows.length > 0 ? (
            <div className="ux-empty-offers" data-testid="bundle-view-offers-empty">
              <strong>{copy.offersEmptyTitle}</strong>
              <p>{copy.offersEmptyBody}</p>
              <Link className="button button--primary button--sm" to={wizardTo()}>
                {copy.offersEmptyAction}
              </Link>
            </div>
          ) : null}
          <ul className="cx-offers" data-testid="bundle-view-offers">
            {offerRows.map(({ connection, listing }) => (
              <li key={connection.id}>
                <span className="ux-offer-name" title={connection.name}>
                  {displayConnectionName(connection.name)}
                </span>
                {listing ? (
                  <>
                    <span>
                      <StatusBadge
                        compact
                        withDot
                        tone={LIFECYCLE_TONE[listing.channelStatus?.lifecycle ?? 'Unsynced']}
                      >
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
                      {listing.commercial?.availableQuantity != null &&
                      availability.kind === 'known' &&
                      listing.commercial.availableQuantity !== availability.bundles ? (
                        // Below the component count is the normal shape of a channel reserve or
                        // a pending order, so it is a note; only a channel ABOVE what the
                        // components allow is a fault a sync could fix.
                        <span
                          className={
                            listing.commercial.availableQuantity > availability.bundles
                              ? 'ux-offer-mismatch'
                              : 'ux-offer-mismatch ux-offer-mismatch--note'
                          }
                          data-testid="bundle-offer-mismatch"
                        >
                          {interpolate(
                            listing.commercial.availableQuantity > availability.bundles
                              ? copy.offerMismatch
                              : copy.offerReserveNote,
                            {
                              channel: listing.commercial.availableQuantity,
                              sets: availability.bundles,
                            }
                          )}
                        </span>
                      ) : null}
                    </span>
                    <Link
                      className="button button--secondary button--sm"
                      to={`/listings?search=${encodeURIComponent(listing.externalId)}`}
                    >
                      {copy.open}
                    </Link>
                  </>
                ) : (
                  <>
                    <span className="cx-sub">{copy.notListed}</span>
                    <span />
                    <Link
                      className="button button--secondary button--sm"
                      to={wizardTo(connection.id)}
                    >
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
          aside={
            history.data ? formatPlural(history.data.length, copy.versionsCount, locale) : undefined
          }
          riseIndex={4}
        >
          <ul className="pm-log" data-testid="bundle-view-history">
            {(history.data ?? []).map((entry, index, all) => {
              const chips = diffAgainst(entry, all[index + 1], {
                added: allCopy.form.historyDiffAdded,
                removed: allCopy.form.historyDiffRemoved,
                quantity: allCopy.form.historyDiffQuantity,
              });
              return (
              <li key={entry.version}>
                <span>
                  <b>
                    {entry.current
                      ? copy.currentVersion
                      : interpolate(copy.version, { n: entry.version })}
                  </b>
                  <span className="text-muted">
                    {interpolate(copy.since, { date: format.date(entry.createdAt) })} ·{' '}
                    {describeComponents(entry)}
                  </span>
                  {chips.length > 0 ? (
                    <span className="bf-history__chips">
                      {chips.map((chip) => (
                        <span key={chip.text} className={`bf-history__chip bf-history__chip--${chip.kind}`}>
                          {chip.text}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </span>
                {entry.current ? (
                  <StatusBadge compact withDot tone="success">
                    {copy.active}
                  </StatusBadge>
                ) : entry.openOrders > 0 ? (
                  <span className="cx-tag cx-tag--quiet">
                    {formatPlural(entry.openOrders, copy.openOrders, locale)}
                  </span>
                ) : null}
              </li>
              );
            })}
          </ul>
          {bundle.openOrdersOnOlderComposition > 0 ? (
            <div className="cx-note">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v5M12 16v.5" />
              </svg>
              <p>{formatPlural(bundle.openOrdersOnOlderComposition, allCopy.form.openOrdersNote, locale)}</p>
            </div>
          ) : null}
        </ComposerSection>
      </div>

      <aside className="pm-col pm-rail">
        <ComposerSection title={copy.availabilityTitle} aside={copy.liveAside} riseIndex={3}>
          <span
            className="cx-tag cx-tag--quiet bundle-derived-tag"
            title={copy.derivedStockHint}
            data-testid="bundle-view-derived-stock"
          >
            {copy.derivedStock}
          </span>{' '}
          <span
            className="cx-tag cx-tag--quiet bundle-derived-tag"
            title={copy.virtualHint}
            tabIndex={0}
            data-testid="bundle-view-virtual-chip"
          >
            {copy.virtualChip}
          </span>
          <div className={`cx-avail ${availabilityTone}`} style={{ alignItems: 'flex-end' }}>
            {removedCount > 0 ? (
              <>
                <span className="cx-big mono tabular">
                  0 <small>{copy.bundlesWord}</small>
                </span>
                <span style={{ paddingBottom: 2 }}>{copy.removedAvailabilityLine}</span>
              </>
            ) : availability.kind === 'known' ? (
              <>
                <span className="cx-big mono tabular">
                  {availability.bundles} <small>{copy.bundlesWord}</small>
                </span>
                <span style={{ paddingBottom: 2 }}>
                  {availability.limitedBy === null
                    ? interpolate(copy.canAssembleOk, { n: availability.bundles })
                    : interpolate(copy.canAssemble, {
                        n: availability.bundles,
                        name: availability.limitedBy,
                      })}
                </span>
              </>
            ) : (
              <span>{copy.availableLineUnknown}</span>
            )}
          </div>
          <p className="pm-help" data-testid="bundle-view-stock-rule">{copy.stockRule}</p>
          <p className="pm-help" data-testid="bundle-view-stock-reserve">{copy.stockRuleReserve}</p>
          <p className="pm-help">{copy.channelsGetNumber}</p>
        </ComposerSection>
        <ComposerSection title={copy.glanceTitle} riseIndex={4}>
          <div className="pm-kpis" style={{ gridTemplateColumns: 'repeat(2,minmax(0,1fr))' }}>
            <div className="pm-kpi">
              <span className="pm-kpi__l">{copy.priceGross}</span>
              <span className="pm-kpi__n mono tabular">
                {bundle.bundle.price === null ? '—' : format.money(bundle.bundle.price, currency)}
              </span>
              <span className="pm-kpi__s">{copy.asInShop}</span>
            </div>
            {sold.data ? (
              <div className="pm-kpi" data-testid="bundle-view-sold">
                <span className="pm-kpi__l">{copy.sold}</span>
                <span className="pm-kpi__n mono tabular">
                  {format.number(
                    sold.data.variants
                      .filter((v) => v.variantId === bundleVariantId)
                      .reduce((sum, v) => sum + v.units, 0)
                  )}
                </span>
                <span className="pm-kpi__s">{copy.soldHint}</span>
              </div>
            ) : null}
          </div>
        </ComposerSection>
        <ComposerSection title={copy.whoTitle} riseIndex={5}>
          <p className="pm-help">{copy.whoBody}</p>
        </ComposerSection>
      </aside>
    </div>
  );
}
