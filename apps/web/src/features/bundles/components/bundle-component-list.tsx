/**
 * Bundle component list (#3520)
 *
 * The composition of a bundle as the mockups draw it: one row per component
 * with its picture, name (a link to the component product), quantity, gift
 * mark, and on the right its stock, how many whole bundles that stock allows
 * and a bar against the limiting component. Used by the bundle product page,
 * the products-list peek and the offer wizard's bundle modal.
 *
 * `compact` drops the bar and shows only quantity and stock.
 *
 * @module apps/web/src/features/bundles/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { interpolate, useMessages } from '../../../shared/i18n';
import { VariantThumbnail } from '../../products';
import type { BundleComponentAvailability } from '../api/bundles.types';

export interface BundleComponentListProps {
  components: readonly BundleComponentAvailability[];
  /** Whole bundles available, `null` when unknown. */
  bundlesAvailable: number | null;
  compact?: boolean;
  /** Link component names to their product pages. */
  linkNames?: boolean;
  /** When set, each row gets `data-testid="{prefix}-line-{variantId}"`. */
  testIdPrefix?: string;
}

export function BundleComponentList({
  components,
  bundlesAvailable,
  compact = false,
  linkNames = true,
  testIdPrefix,
}: BundleComponentListProps): ReactElement {
  const copy = useMessages('bundles').view;
  return (
    <ul
      className={`cx-comp${compact ? ' cx-comp--compact' : ''}`}
      data-testid="bundle-view-components"
    >
      {components.map((component) => {
        const name = component.summary.name ?? component.summary.sku ?? component.variantId;
        const stock = component.availableToPromise;
        const sets = stock === null ? null : Math.floor(stock / component.quantity);
        const limiting = bundlesAvailable !== null && sets !== null && sets === bundlesAvailable;
        const nameNode = linkNames ? (
          <Link to={`/products/${encodeURIComponent(component.productId)}`}>{name}</Link>
        ) : (
          <span>{name}</span>
        );
        const gift =
          component.giftSlot === true ? (
            <span className="cx-tag cx-tag--gift">{copy.gift}</span>
          ) : null;
        return (
          <li
            key={component.variantId}
            className={limiting ? 'is-lim' : undefined}
            data-testid={testIdPrefix ? `${testIdPrefix}-line-${component.variantId}` : undefined}
          >
            <VariantThumbnail src={component.summary.imageUrl} name={name} size="sm" />
            {compact ? (
              <>
                <span className="cx-comp__n">
                  {nameNode}
                  <span className="cx-sub mono">{component.summary.sku ?? ''}</span>
                </span>
                <span className="cx-comp__q">
                  <span className="mono tabular">×{component.quantity}</span>
                  {gift}
                  <span className="cx-comp__s">
                    {stock === null ? copy.stockUnknown : interpolate(copy.pcs, { n: stock })}
                  </span>
                </span>
              </>
            ) : (
              <>
                <span className="cx-comp__n">
                  <span className="cx-comp__t">
                    {nameNode}
                    <span className="mono tabular cx-comp__x">×{component.quantity}</span>
                    {gift}
                  </span>
                  <span className="cx-sub mono">{component.summary.sku ?? ''}</span>
                </span>
                <span className="cx-comp__a">
                  {stock === null || sets === null ? (
                    <>
                      <b>{copy.stockUnknown}</b>
                      <small>{copy.notCounted}</small>
                      <span className="pm-bar">
                        <i style={{ width: 0 }} />
                      </span>
                    </>
                  ) : (
                    <>
                      <b className="mono tabular">{interpolate(copy.pcs, { n: stock })}</b>
                      <small>
                        {interpolate(copy.enoughFor, { n: sets })}
                        {limiting ? ` · ${copy.limits}` : ''}
                      </small>
                      <span className="pm-bar">
                        <i
                          style={{
                            width: `${String(
                              sets === 0
                                ? 0
                                : Math.max(
                                    6,
                                    limiting
                                      ? 100
                                      : Math.min(
                                          100,
                                          Math.floor((100 * (bundlesAvailable ?? 0)) / sets)
                                        )
                                  )
                            )}%`,
                          }}
                        />
                      </span>
                    </>
                  )}
                </span>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}
