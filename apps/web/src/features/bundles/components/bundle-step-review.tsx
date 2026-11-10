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
import { useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { interpolate, useFormat, useMessages } from '../../../shared/i18n';
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
  onGoTo: (step: BundleStepKey) => void;
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
  onGoTo,
  saved,
}: BundleStepReviewProps): ReactElement {
  const copy = useMessages('bundles').form;
  const format = useFormat();
  const valid = rows.filter((row) => row.qty > 0);
  const tail =
    availability.kind === 'known'
      ? availability.limitedBy === null
        ? interpolate(copy.readbackTail, { n: availability.bundles })
        : interpolate(copy.readbackTailLimited, { n: availability.bundles, name: availability.limitedBy })
      : availability.kind === 'unknown'
        ? copy.readbackUnknown
        : '';

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

      <dl className="bf-review">
        <div>
          <dt>{copy.s4Product}</dt>
          <dd>{productLine}</dd>
          <Button tone="ghost" className="button--sm" onClick={() => { onGoTo('product'); }}>
            {copy.s4Edit}
          </Button>
        </div>
        <div>
          <dt>{copy.s4Price}</dt>
          <dd className="mono tabular">{price !== null ? format.money(price, currency) : copy.summaryNoPrice}</dd>
          <Button tone="ghost" className="button--sm" onClick={() => { onGoTo('product'); }}>
            {copy.s4Edit}
          </Button>
        </div>
        <div>
          <dt>{copy.s4Gifts}</dt>
          <dd>{giftLine}</dd>
          <Button tone="ghost" className="button--sm" onClick={() => { onGoTo('gifts'); }}>
            {copy.s4Edit}
          </Button>
        </div>
      </dl>

      <PriceSplit price={price} currency={currency} rows={rows} />

      {saved !== null ? <SendOn saved={saved} /> : null}
    </div>
  );
}

function SendOn({ saved }: { saved: { productId: string; variantId: string } }): ReactElement {
  const copy = useMessages('bundles').form;
  const connections = useConnectionsQuery();
  const active = (connections.data ?? []).filter((c) => c.status === 'active');
  const marketplaces = active.filter((c) => c.enabledCapabilities.includes('OfferManager'));
  const shops = active.filter(
    (c) =>
      c.enabledCapabilities.includes('ProductPublisher') &&
      !marketplaces.some((m) => m.id === c.id)
  );
  const target = (connectionId: string): string =>
    `/listings/bulk-create/wizard?${new URLSearchParams({
      productIds: saved.productId,
      variantIds: saved.variantId,
      connectionId,
    }).toString()}`;

  return (
    <section className="bf-sendon" data-testid="bundle-form-send-on" aria-labelledby="bf-sendon-h">
      <h3 id="bf-sendon-h" className="bf-h3">
        {copy.goTitle}
      </h3>
      <p className="pm-help">{copy.goLead}</p>
      {marketplaces.length + shops.length === 0 ? (
        <p className="pm-help">{copy.goNone}</p>
      ) : (
        <ul className="bf-targets">
          {[...marketplaces.map((c) => ({ c, kind: 'marketplace' as const })), ...shops.map((c) => ({ c, kind: 'shop' as const }))].map(
            ({ c, kind }) => (
              <li key={c.id} data-testid={`bundle-form-target-${c.id}`}>
                <b className="bf-targets__name">{c.name}</b>
                <span className="bf-targets__text">
                  {interpolate(kind === 'shop' ? copy.goShop : copy.goMarketplace, { name: c.name })}
                </span>
                <Link className="button button--secondary button--sm" to={target(c.id)}>
                  {copy.goButton}
                </Link>
              </li>
            )
          )}
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
          <div className="pm-disc__inner" data-testid={open ? 'bundle-form-price-split' : undefined}>
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
                      name: rows.find((r) => r.variantId === split.variantIds[0])?.name ?? split.variantIds[0],
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
