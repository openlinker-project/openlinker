/**
 * "Used in bundles" (#3624): which bundles hold a product as a component and
 * whether as a gift, so an operator knows changing its stock changes theirs.
 * Renders nothing when the product is in no bundle - there is no "none"
 * reassurance, because a failed read looks identical to an empty one.
 *
 * @module apps/web/src/features/bundles/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useFormat, useMessages } from '../../../shared/i18n';
import { ComposerSection } from '../../../shared/ui/composer-section';
import { useBundleUsedInManyQuery } from '../hooks/use-bundle-queries';

export function ProductUsedInBundles({
  variantIds,
  card = false,
}: {
  variantIds: readonly string[];
  /** Render as a page card ("Bundles", mockup) instead of a peek section. */
  card?: boolean;
}): ReactElement | null {
  const copy = useMessages('bundles');
  const format = useFormat();
  const result = useBundleUsedInManyQuery(variantIds);
  const entries = result.data ?? [];
  if (entries.length === 0) {
    return null;
  }
  const list = (
    <ul className="cx-comp cx-comp--compact" data-testid="bundle-list-used-in">
      {entries.map((entry) => (
        <li
          key={`${entry.bundleVariantId}:${entry.componentVariantId ?? ''}`}
          data-testid={`bundle-list-used-in-${entry.bundle.sku ?? entry.bundleVariantId}`}
        >
          <span className="cx-mosaic" aria-hidden="true">
            <i className="t-a" />
            <i className="t-d" />
            <i className="t-b" />
            <i className="t-c" />
          </span>
          <span className="cx-comp__n">
            <Link to={`/products/bundles/${entry.bundleVariantId}`}>
              {entry.bundle.name ?? entry.bundle.sku ?? entry.bundleVariantId}
            </Link>
            <span className="cx-sub">
              <span className="mono">{entry.bundle.sku ?? ''}</span>
              {entry.bundle.price !== null
                ? ` · ${format.money(entry.bundle.price, entry.bundle.currency ?? undefined)}`
                : ''}
            </span>
          </span>
          <span className="cx-comp__q">
            <span className="mono tabular">×{entry.quantity}</span>
            {entry.giftSlot === true ? (
              <span className="cx-tag cx-tag--gift">{copy.view.gift}</span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
  if (card) {
    return (
      <ComposerSection title={copy.list.usedInTitle} aside={String(entries.length)} riseIndex={3}>
        <p className="pm-help">{copy.list.usedInIntro}</p>
        {list}
      </ComposerSection>
    );
  }
  return (
    <section className="peek-section">
      <h3 className="peek-section__title">{copy.list.usedInTitle}</h3>
      <p className="pm-help">{copy.list.usedInIntro}</p>
      {list}
    </section>
  );
}
