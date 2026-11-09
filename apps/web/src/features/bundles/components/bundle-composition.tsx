/**
 * Composition of one bundle (#3624): a "Bundle contents" section with one row per
 * component - picture, name linking to the component product, SKU, quantity and
 * the gift mark. Loaded only when mounted (a row opened, a page visited), never
 * for the whole list.
 *
 * @module apps/web/src/features/bundles/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useMessages } from '../../../shared/i18n';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { VariantThumbnail } from '../../products';
import { useBundleQuery } from '../hooks/use-bundle-queries';

export function BundleComposition({
  variantId,
  testId,
}: {
  variantId: string;
  testId: string;
}): ReactElement {
  const copy = useMessages('bundles');
  const query = useBundleQuery(variantId);

  return (
    <section aria-label={copy.list.compositionHeading} data-testid={testId}>
      <h4 style={{ margin: 0 }}>{copy.list.compositionHeading}</h4>
      {query.isLoading ? (
        <p className="text-muted">{copy.list.compositionLoading}</p>
      ) : query.isError || !query.data ? (
        <p role="alert">{copy.list.compositionFailed}</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {query.data.componentAvailability.map((component) => {
            const name = component.summary.name ?? component.summary.sku ?? component.variantId;
            return (
              <li
                key={component.variantId}
                className="ds-row"
                style={{ gap: 'var(--space-3)', alignItems: 'center', padding: 'var(--space-2) 0' }}
                data-testid={`${testId}-line-${component.variantId}`}
              >
                <VariantThumbnail src={component.summary.imageUrl} name={name} size="sm" />
                <span className="products-cell-stack">
                  <Link className="mk-link" to={`/products/${encodeURIComponent(component.productId)}`}>
                    {name}
                  </Link>
                  {component.summary.sku ? (
                    <span className="text-muted products-cell-sub">{component.summary.sku}</span>
                  ) : null}
                </span>
                <span>{`× ${String(component.quantity)}`}</span>
                {component.giftSlot === true ? (
                  <StatusBadge tone="success" compact>
                    {copy.form.gift}
                  </StatusBadge>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
