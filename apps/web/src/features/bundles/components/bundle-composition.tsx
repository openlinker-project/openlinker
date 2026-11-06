/**
 * Composition of one bundle, shown under its row in the products list
 * (#3624): "2 x Mug", one per line. Loaded when the row is opened, never for the
 * whole page.
 *
 * @module apps/web/src/features/bundles/components
 */
import type { ReactElement } from 'react';
import { interpolate, useMessages } from '../../../shared/i18n';
import { StatusBadge } from '../../../shared/ui/status-badge';
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

  if (query.isLoading) return <p className="text-muted">{copy.list.compositionLoading}</p>;
  if (query.isError || !query.data) return <p role="alert">{copy.list.compositionFailed}</p>;

  return (
    <ul data-testid={testId} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {query.data.componentAvailability.map((component) => (
        <li key={component.variantId}>
          {interpolate(copy.list.compositionLine, {
            n: component.quantity,
            name: component.summary.name ?? component.summary.sku ?? component.variantId,
          })}{' '}
          {component.giftSlot === true ? (
            <StatusBadge tone="success" compact>
              {copy.form.gift}
            </StatusBadge>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
