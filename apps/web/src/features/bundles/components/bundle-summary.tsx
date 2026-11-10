/**
 * Bundle summary (#3935)
 *
 * The right column of the bundle form, always in view on a wide screen and the
 * body of a bottom sheet on a phone: the bundle's name and price, how many
 * bundles the stock allows and which component runs out first, the components
 * with their pictures, and where the gift stands. It only reads what the form
 * already holds, so it never disagrees with a step.
 *
 * @module apps/web/src/features/bundles/components
 */
import type { ReactElement } from 'react';
import { interpolate, useFormat, useMessages } from '../../../shared/i18n';
import { VariantThumbnail } from '../../products';
import type { BundleAvailability } from '../lib/bundle-availability';
import type { ParsedRow } from '../lib/bundle-form-model';

export interface BundleSummaryProps {
  name: string | null;
  price: number | null;
  currency: string | undefined;
  rows: readonly ParsedRow[];
  availability: BundleAvailability;
  /** The line saying how the gift shows on documents, when there is a gift. */
  giftDocumentLine: string | null;
}

export function BundleSummary({
  name,
  price,
  currency,
  rows,
  availability,
  giftDocumentLine,
}: BundleSummaryProps): ReactElement {
  const copy = useMessages('bundles').form;
  const format = useFormat();
  const valid = rows.filter((row) => row.qty > 0);
  const limiting = availability.kind === 'known' ? availability.limitedBy : null;
  const state =
    availability.kind === 'known' ? (availability.bundles === 0 ? 'is-zero' : 'is-ok') : 'is-unk';

  return (
    <div className="bf-summary" data-testid="bundle-form-summary">
      <p className="bf-summary__name">{name !== null && name !== '' ? name : copy.readbackNoProduct}</p>
      <dl className="bf-summary__facts">
        <div>
          <dt>{copy.summaryPrice}</dt>
          <dd className="mono tabular">
            {price !== null ? format.money(price, currency) : copy.summaryNoPrice}
          </dd>
        </div>
        <div className={`bf-summary__avail ${state}`} data-testid="bundle-form-availability">
          <dt>{copy.summaryAvailability}</dt>
          <dd>
            {availability.kind === 'known' ? (
              <>
                <b className="bf-summary__big mono tabular">
                  {interpolate(copy.summarySets, { n: availability.bundles })}
                </b>
                {limiting !== null ? (
                  <span>{interpolate(copy.limitsFirst, { name: limiting })}</span>
                ) : null}
              </>
            ) : availability.kind === 'unknown' ? (
              <span>
                {availability.component !== null
                  ? interpolate(copy.availabilityUnknown, { name: availability.component })
                  : copy.availabilityUnknownGeneric}
              </span>
            ) : (
              <span>{copy.availabilityEmpty}</span>
            )}
          </dd>
        </div>
      </dl>
      <p className="bf-summary__h">{copy.summaryComponents}</p>
      {valid.length === 0 ? (
        <p className="pm-help">{copy.readbackEmpty}</p>
      ) : (
        <ul className="bf-summary__list">
          {valid.map((row) => (
            <li key={row.variantId} className={row.name === limiting ? 'is-lim' : undefined}>
              <VariantThumbnail src={row.imageUrl} name={row.name} size="sm" />
              <span className="bf-summary__who">
                <span>{row.name}</span>
                {row.attributes ? <small>{row.attributes}</small> : null}
              </span>
              <span className="mono tabular">×{row.qty}</span>
              {row.gift ? <span className="cx-tag cx-tag--gift">{copy.summaryGift}</span> : null}
            </li>
          ))}
        </ul>
      )}
      {giftDocumentLine !== null ? <p className="pm-help">{giftDocumentLine}</p> : null}
    </div>
  );
}
