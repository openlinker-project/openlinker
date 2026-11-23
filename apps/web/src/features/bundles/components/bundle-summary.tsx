/**
 * Bundle summary (#3935)
 *
 * The right column of the bundle form, always in view on a wide screen and the
 * body of a bottom sheet on a phone. It leads with the one answer a seller
 * wants, how many bundles they can sell, as a large number that counts to its
 * new value when an edit changes it, and names the component that limits it
 * (highlighted below as well, with a small stock bar per row so the numbers can
 * be compared at a glance). Unknown stock is never drawn as zero: it says which
 * component has no stock figure and what to do. It only reads what the form
 * already holds, so it never disagrees with a step.
 *
 * @module apps/web/src/features/bundles/components
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { animate, useReducedMotion } from 'motion/react';
import {
  formatPlural,
  interpolate,
  selectPluralForm,
  useFormat,
  useLocale,
  useMessages,
} from '../../../shared/i18n';
import { VariantThumbnail } from '../../products';
import type { BundleAvailability } from '../lib/bundle-availability';
import type { ParsedRow } from '../lib/bundle-form-model';
import { quantityProblem } from './bundle-step-components';

/** Counts from the figure on screen to the new one in ~250 ms; instantly under reduced motion. */
export function useCountUp(target: number, reduceMotion: boolean): number {
  const [shown, setShown] = useState(target);
  const shownRef = useRef(target);
  useEffect(() => {
    if (reduceMotion || shownRef.current === target) {
      shownRef.current = target;
      setShown(target);
      return undefined;
    }
    const controls = animate(shownRef.current, target, {
      duration: 0.25,
      ease: 'easeOut',
      onUpdate: (value) => {
        const rounded = Math.round(value);
        shownRef.current = rounded;
        setShown(rounded);
      },
      onComplete: () => {
        shownRef.current = target;
        setShown(target);
      },
    });
    return () => {
      controls.stop();
    };
  }, [target, reduceMotion]);
  return shown;
}

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
  const { locale } = useLocale();
  const reduceMotion = useReducedMotion() ?? false;
  const valid = rows.filter((row) => row.qty > 0);
  const noPaidComponent = valid.length > 0 && valid.every((row) => row.gift);
  const quantityReason = {
    min: copy.qtyMin,
    whole: copy.qtyWhole,
    max: copy.qtyMax,
  };
  const limiting = availability.kind === 'known' ? availability.limitedBy : null;
  const state =
    availability.kind === 'known'
      ? availability.bundles === 0
        ? 'is-zero'
        : 'is-ok'
      : availability.kind === 'unknown'
        ? 'is-unk'
        : 'is-empty';
  const limitingStock =
    limiting === null ? null : valid.find((row) => row.name === limiting)?.availableToPromise;
  const target = availability.kind === 'known' ? availability.bundles : 0;
  const shown = useCountUp(target, reduceMotion);

  // How many bundles each component's stock would allow, for the bars.
  const supported = valid.map((row) =>
    row.availableToPromise === null ? null : Math.floor(row.availableToPromise / row.qty)
  );
  const widest = Math.max(1, ...supported.map((n) => n ?? 0));
  const unitTemplate = selectPluralForm(target, copy.summarySetsPlural, locale);
  const [unitBefore = '', unitAfter = ''] = unitTemplate.split('{n}');
  const unknownRow = availability.kind === 'unknown' ? valid.find((row) => row.name === availability.component) : undefined;

  return (
    <div className="bf-summary" data-testid="bundle-form-summary">
      <div className={`s-hero ${state}`} data-testid="bundle-form-availability" aria-live="polite" aria-atomic="true">
        <p className="s-hero__label">{copy.summaryAvailability}</p>
        {availability.kind === 'unknown' ? (
          <>
            <p className="s-hero__chip">
              <span aria-hidden="true">!</span>
              {availability.component !== null
                ? interpolate(copy.summaryUnknownChip, { name: availability.component })
                : copy.availabilityUnknownGeneric}
            </p>
            <p className="s-hero__note">
              {availability.component !== null
                ? interpolate(copy.availabilityUnknown, { name: availability.component })
                : copy.availabilityUnknownGeneric}
            </p>
            <p className="s-hero__note">{copy.summaryUnknownWhy}</p>
            {unknownRow !== undefined ? (
              <Link className="link s-hero__action" to={`/products/${encodeURIComponent(unknownRow.productId)}`}>
                {copy.summaryCheckStock}
              </Link>
            ) : null}
          </>
        ) : availability.kind === 'known' ? (
          <>
            <p className="s-hero__figure">
              <span className="sr-only">{formatPlural(target, copy.summarySetsPlural, locale)}</span>
              <span aria-hidden="true">
                <b className="s-hero__num mono tabular">{shown}</b>
                <span className="s-hero__unit">{`${unitBefore}${unitAfter}`.trim()}</span>
              </span>
            </p>
            {limiting !== null ? (
              <p className="s-hero__note">
                {limitingStock === null || limitingStock === undefined
                  ? interpolate(copy.summaryLimitedBy, { name: limiting })
                  : interpolate(copy.summaryLimitedByQty, { name: limiting, n: limitingStock })}
              </p>
            ) : null}
            {target === 0 ? (
              <p className="s-hero__note">
                {limiting !== null
                  ? interpolate(copy.summaryZeroWhy, { name: limiting })
                  : copy.summaryZeroWhySingle}
              </p>
            ) : null}
          </>
        ) : (
          <>
            <p className="s-hero__note">{copy.summaryAddComponent}</p>
          </>
        )}
      </div>

      <p className={`bf-summary__name${name !== null && name !== '' ? '' : ' is-unnamed'}`}>
        {name !== null && name !== '' ? name : copy.summaryUnnamed}
      </p>
      <dl className="bf-summary__facts">
        <div>
          <dt>{copy.summaryPrice}</dt>
          <dd className="mono tabular">
            {price !== null ? format.money(price, currency) : copy.summaryNoPrice}
          </dd>
        </div>
      </dl>
      <p className="bf-summary__h">{copy.summaryComponents}</p>
      {noPaidComponent ? <p className="pm-help s-warn">{copy.summaryNoPaid}</p> : null}
      {rows.length === 0 ? (
        <p className="pm-help">{copy.readbackEmpty}</p>
      ) : (
        <ul className="bf-summary__list">
          {rows.map((row) => {
            const problem = row.qty > 0 ? null : (quantityProblem(row.quantity) ?? 'min');
            if (problem !== null) {
              return (
                <li key={row.variantId} className="is-invalid" data-testid="bundle-form-summary-invalid">
                  <VariantThumbnail src={row.imageUrl} name={row.name} size="sm" />
                  <span className="bf-summary__who">
                    <span>{row.name}</span>
                    <small className="s-unk">
                      {copy.summaryQtyInvalid}: {quantityReason[problem]}
                    </small>
                  </span>
                </li>
              );
            }
            const index = valid.indexOf(row);
            const enough = supported[index] ?? null;
            const isLimit = limiting !== null && row.name === limiting;
            return (
              <li key={row.variantId} className={isLimit ? 'is-lim' : undefined} data-testid={isLimit ? 'bundle-form-summary-limiting' : undefined}>
                <VariantThumbnail src={row.imageUrl} name={row.name} size="sm" />
                <span className="bf-summary__who">
                  <span>{row.name}</span>
                  {row.attributes ? <small>{row.attributes}</small> : null}
                  {enough === null ? (
                    <small className="s-unk">{copy.s3StockUnknown}</small>
                  ) : (
                    <span
                      className="s-bar"
                      role="img"
                      aria-label={formatPlural(enough, copy.summaryEnoughFor, locale)}
                      title={formatPlural(enough, copy.summaryEnoughFor, locale)}
                    >
                      <span style={{ width: `${String(Math.round((enough / widest) * 100))}%` }} />
                    </span>
                  )}
                </span>
                <span className="s-side">
                  <span className="mono tabular">×{row.qty}</span>
                  {row.gift ? <span className="cx-tag cx-tag--gift">{copy.summaryGift}</span> : null}
                  {isLimit ? <span className="cx-tag s-limit-tag">{copy.summaryLimitTag}</span> : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {giftDocumentLine !== null ? <p className="pm-help">{giftDocumentLine}</p> : null}
      <p className="pm-help">{copy.summaryReservations}</p>
    </div>
  );
}
