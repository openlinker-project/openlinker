/**
 * Bundle form, step 4: check and save, then send on (#3935)
 *
 * The bundle read back in one sentence with a "Change" link to the step each
 * part came from. After the save, the same step turns into "where it goes":
 * every sales channel with one sentence about what will happen there and a
 * button that opens the existing listing flow with the bundle already chosen.
 *
 * @module apps/web/src/features/bundles/components
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { formatPlural, interpolate, useFormat, useLocale, useMessages } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { ReadbackSentence } from '../../../shared/ui/readback-sentence';
import { useConnectionsQuery } from '../../connections';
import type { BundleAvailability } from '../lib/bundle-availability';
import { splitBundlePrice } from '../lib/bundle-price-split';
import type { BundleStepKey, ParsedRow } from '../lib/bundle-form-model';

export interface BundleStepReviewProps {
  name: string | null;
  price: number | null;
  currency: string | undefined;
  rows: readonly ParsedRow[];
  availability: BundleAvailability;
  productLine: string;
  giftLine: string;
  /** Saveable but not assemblable right now (0 sets): said in amber, never as a plain "ready". */
  cannotAssemble?: boolean;
  /** The name claims a pack size the composition does not hold. */
  packMismatch?: { named: number; actual: number } | null;
  onGoTo: (step: BundleStepKey) => void;
  /** True while the product will be created in a shop on save (the "create" mode). */
  creating?: boolean;
  /** The shop that will create the product, when it is known. */
  masterName?: string;
  /** Set once the bundle is saved: the product and variant to list. */
  saved: { productId: string; variantId: string } | null;
}

export function BundleStepReview({
  name,
  price,
  currency,
  rows,
  availability,
  productLine,
  giftLine,
  cannotAssemble = false,
  packMismatch = null,
  onGoTo,
  creating,
  masterName,
  saved,
}: BundleStepReviewProps): ReactElement {
  const copy = useMessages('bundles').form;
  const format = useFormat();
  const { locale } = useLocale();
  const valid = rows.filter((row) => row.qty > 0);
  const stockText =
    availability.kind === 'known'
      ? formatPlural(availability.bundles, copy.s4StockSentence, locale) +
        (availability.limitedBy === null
          ? ''
          : ` (${interpolate(copy.s4LimitedBy, { name: availability.limitedBy })})`)
      : availability.kind === 'unknown'
        ? copy.readbackUnknown
        : '';
  const tail = stockText === '' ? '' : `${stockText}.`;
  const productName = name ?? copy.readbackNoProduct;
  const compositionText = valid
    .map((row) => `${row.name} ×${String(row.qty)}${row.gift ? ` (${copy.giftLower})` : ''}`)
    .join(', ');
  const edit = (what: string, step: BundleStepKey): ReactElement => (
    <Button
      tone="ghost"
      className="button--sm"
      aria-label={interpolate(copy.s4EditAria, { what })}
      onClick={() => {
        onGoTo(step);
      }}
    >
      {copy.s4Edit}
    </Button>
  );

  return (
    <div className="bf-step">
      <p className="bf-lead">{copy.s4Lead}</p>
      <ReadbackSentence
        eyebrow={copy.readbackEyebrow}
        name={name ?? copy.readbackNoProduct}
        data-testid="bundle-form-readback"
      >
        {valid.length === 0 ? (
          copy.readbackEmpty
        ) : (
          <>
            {valid.map((row, index) => (
              <span key={row.variantId}>
                {index > 0 ? (index === valid.length - 1 ? ` ${copy.and} ` : ', ') : ''}
                <b>{row.name}</b> ×{row.qty}
                {row.gift ? ` (${copy.giftLower})` : ''}
              </span>
            ))}{' '}
            {copy.inOnePackage} {tail}
          </>
        )}
      </ReadbackSentence>

      {cannotAssemble && saved === null ? (
        <Alert tone="warning" data-testid="bundle-form-cannot-assemble">
          {copy.s4CannotAssemble}
        </Alert>
      ) : null}

      {packMismatch !== null ? (
        <Alert tone="warning" data-testid="bundle-form-pack-mismatch-review">
          {interpolate(copy.packMismatch, packMismatch)}
        </Alert>
      ) : null}

      {saved === null && creating !== undefined ? (
        <section
          className="s4-happens"
          data-testid="bundle-form-happens"
          aria-labelledby="s4-happens-h"
        >
          <h3 id="s4-happens-h" className="bf-h3">
            {copy.s4Happens}
          </h3>
          <ol className="s4-happens__list">
            <li>
              {creating
                ? masterName !== undefined && masterName !== ''
                  ? interpolate(copy.s4HappensCreate, { master: masterName, name: productName })
                  : interpolate(copy.s4HappensCreateNoMaster, { name: productName })
                : interpolate(copy.s4HappensExisting, { name: productName })}
            </li>
            <li>{copy.s4HappensSave}</li>
            <li>{copy.s4HappensNotListed}</li>
            <li>{copy.s4HappensNoStock}</li>
          </ol>
        </section>
      ) : null}

      {saved === null ? <NextHint /> : null}

      <dl className="bf-review">
        <div>
          <dt>{copy.s4Composition}</dt>
          <dd data-testid="bundle-form-review-composition">
            {compositionText || copy.readbackEmpty}
            {edit(copy.s4Composition, 'components')}
          </dd>
        </div>
        <div>
          <dt>{copy.s4Stock}</dt>
          <dd data-testid="bundle-form-review-stock">
            {stockText || copy.availabilityEmpty}
            {edit(copy.s4Stock, 'components')}
          </dd>
        </div>
        <div>
          <dt>{copy.s4Product}</dt>
          <dd>
            {productLine}
            {edit(copy.s4Product, 'product')}
          </dd>
        </div>
        <div>
          <dt>{copy.s4Price}</dt>
          <dd className="mono tabular">
            {price !== null ? format.money(price, currency) : copy.summaryNoPrice}
            {edit(copy.s4Price, 'product')}
          </dd>
        </div>
        <div>
          <dt>{copy.s4Documents}</dt>
          <dd>
            {giftLine === copy.s4NoGifts ? copy.s4DocumentsNoGift : giftLine}
            {edit(copy.s4Documents, 'gifts')}
          </dd>
        </div>
      </dl>

      <PriceSplit price={price} currency={currency} rows={rows} />

      {saved !== null ? <SendOn saved={saved} /> : null}
    </div>
  );
}

/** Says before the Save button that saving is not the end: the offer is a separate, last step. */
function NextHint(): ReactElement {
  const copy = useMessages('bundles').form;
  const connections = useConnectionsQuery();
  const marketplaces = (connections.data ?? []).filter(
    (c) => c.status === 'active' && c.enabledCapabilities.includes('OfferManager')
  );
  const sole = marketplaces.length === 1 ? marketplaces[0] : undefined;
  return (
    <p className="bf-nextnote" data-testid="bundle-form-next-hint">
      {sole !== undefined ? interpolate(copy.s4Next, { name: sole.name }) : copy.s4NextMany}
    </p>
  );
}

function SendOn({ saved }: { saved: { productId: string; variantId: string } }): ReactElement {
  const copy = useMessages('bundles').form;
  const connections = useConnectionsQuery();
  const sectionRef = useRef<HTMLElement | null>(null);
  // The next step appears below the fold after Save; bring it into view so the
  // operator does not have to discover that saving was not the end.
  useEffect(() => {
    sectionRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    sectionRef.current?.focus({ preventScroll: true });
  }, []);
  const active = (connections.data ?? []).filter((c) => c.status === 'active');
  const marketplaces = active.filter((c) => c.enabledCapabilities.includes('OfferManager'));
  const shops = active.filter(
    (c) =>
      c.enabledCapabilities.includes('ProductPublisher') && !marketplaces.some((m) => m.id === c.id)
  );
  const soleMarketplace = marketplaces.length === 1 ? marketplaces[0] : undefined;
  const target = (connectionId: string): string =>
    `/listings/bulk-create/wizard?${new URLSearchParams({
      productIds: saved.productId,
      variantIds: saved.variantId,
      connectionId,
    }).toString()}`;

  return (
    <section
      ref={sectionRef}
      tabIndex={-1}
      className="bf-sendon"
      data-testid="bundle-form-send-on"
      aria-labelledby="bf-sendon-h"
    >
      <h3 id="bf-sendon-h" className="bf-h3">
        {copy.goTitle}
      </h3>
      <p className="pm-help">{copy.goLead}</p>
      {marketplaces.length + shops.length === 0 ? (
        <p className="pm-help">{copy.goNone}</p>
      ) : (
        <ul className="bf-targets">
          {[
            ...marketplaces.map((c) => ({ c, kind: 'marketplace' as const })),
            ...shops.map((c) => ({ c, kind: 'shop' as const })),
          ].map(({ c, kind }) => (
            <li key={c.id} data-testid={`bundle-form-target-${c.id}`}>
              <b className="bf-targets__name">{c.name}</b>
              <span className="bf-targets__text">
                {interpolate(kind === 'shop' ? copy.goShop : copy.goMarketplace, { name: c.name })}
              </span>
              <Link
                className={`button${soleMarketplace?.id === c.id ? '' : ' button--secondary'} button--sm`}
                to={target(c.id)}
              >
                {kind === 'marketplace'
                  ? interpolate(copy.listOnChannel, { name: c.name })
                  : copy.goButton}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PriceSplit({
  price,
  currency,
  rows,
}: {
  price: number | null;
  currency: string | undefined;
  rows: readonly ParsedRow[];
}): ReactElement {
  const copy = useMessages('bundles').form;
  const format = useFormat();
  const [open, setOpen] = useState(false);
  const split = splitBundlePrice(
    price,
    rows.map((row) => ({
      variantId: row.variantId,
      quantity: Math.max(row.qty, 1),
      standalonePrice: row.price,
      giftSlot: row.gift,
    }))
  );
  return (
    <div className="pm-disc">
      <button
        type="button"
        className="pm-disc__btn"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        <span className="pm-disc__caret" aria-hidden="true" />
        <span>{open ? copy.priceSplitHide : copy.priceSplitShow}</span>
        <span className="pm-disc__sum">{copy.priceSplitInfoOnly}</span>
      </button>
      <div className={`pm-disc__body${open ? ' is-open' : ''}`}>
        <div>
          <div
            className="pm-disc__inner"
            data-testid={open ? 'bundle-form-price-split' : undefined}
          >
            {open ? (
              <>
                <p className="pm-help">{copy.priceSplitIntro}</p>
                {split.kind === 'ok' ? (
                  <div className="pm-doc">
                    {split.lines.map((line) => {
                      const row = rows.find((r) => r.variantId === line.variantId);
                      return (
                        <span
                          key={line.variantId}
                          className={`pm-doc__l${row?.gift ? ' is-gift' : ''}`}
                          data-testid={`bundle-form-price-split-line-${row?.sku ?? line.variantId}`}
                        >
                          {interpolate(copy.priceSplitLine, {
                            name: row?.name ?? line.variantId,
                            amount: format.money(line.amount, currency),
                          })}
                        </span>
                      );
                    })}
                  </div>
                ) : split.kind === 'unknown-component-price' ? (
                  <Alert tone="warning" data-testid="bundle-form-price-share-alert">
                    {interpolate(copy.priceSplitMissingPrice, {
                      name:
                        rows.find((r) => r.variantId === split.variantIds[0])?.name ??
                        split.variantIds[0],
                    })}
                  </Alert>
                ) : split.kind === 'no-paid-component' ? (
                  <p className="pm-help">{copy.priceSplitNoPaid}</p>
                ) : (
                  <p className="pm-help">{copy.priceSplitNoPrice}</p>
                )}
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
