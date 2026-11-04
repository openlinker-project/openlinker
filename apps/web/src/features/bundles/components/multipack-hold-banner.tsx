/**
 * Multipack hold banner (#3624)
 *
 * An order is held when a channel sold N units of one product in one offer and
 * OpenLinker has no bundle for it: shipping it as one unit would take 1 off
 * stock for the price of N. The banner names the problem and offers the next
 * step: define the bundle (the form starts with "N x product"), after which
 * every order waiting for a bundle is sent to be processed again.
 *
 * @module apps/web/src/features/bundles/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useWriteAccess } from '../../../shared/auth/use-permission';
import { interpolate, useMessages } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import { useDemoMode } from '../../system';

export interface MultipackHold {
  lineId: string;
  packQuantity: number;
  lineName: string | null;
  variantId: string | null;
  productName: string | null;
  sku: string | null;
}

export function MultipackHoldBanner({ hold }: { hold: MultipackHold }): ReactElement {
  const copy = useMessages('bundles');
  const demoMode = useDemoMode();
  const write = useWriteAccess('products:write', demoMode);
  const name = hold.productName ?? hold.lineName ?? hold.sku ?? '';
  const createHref =
    hold.variantId === null
      ? '/products/bundles/new'
      : `/products/bundles/new?${new URLSearchParams({
          component: hold.variantId,
          quantity: String(hold.packQuantity),
        }).toString()}`;
  const productsHref = `/products?${new URLSearchParams({ search: hold.sku ?? name }).toString()}`;

  return (
    <Alert
      tone="warning"
      title={interpolate(copy.order.multipackTitle, { n: hold.packQuantity })}
      data-testid="order-multipack-banner"
      action={
        <span className="button-group">
          {write.canWrite ? (
            <Link
              className="button button--primary button--sm"
              data-testid="order-multipack-create-bundle"
              to={createHref}
            >
              {hold.variantId === null
                ? copy.order.createBundleNoProduct
                : interpolate(copy.order.createBundle, { n: hold.packQuantity, name })}
            </Link>
          ) : (
            <span
              className="button button--primary button--sm"
              role="button"
              aria-disabled="true"
              tabIndex={0}
              title={copy.order.viewOnlyReason}
              data-testid="order-multipack-create-bundle"
            >
              {interpolate(copy.order.createBundle, { n: hold.packQuantity, name })}
            </span>
          )}
          <Link className="button button--ghost button--sm" data-testid="order-multipack-open-products" to={productsHref}>
            {copy.order.openProducts}
          </Link>
        </span>
      }
    >
      {interpolate(copy.order.multipackBody, { n: hold.packQuantity })}
    </Alert>
  );
}
