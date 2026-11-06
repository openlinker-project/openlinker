/**
 * Multipack hold banner (#3624)
 *
 * An order is held when a channel sold N units of one product in one offer and
 * OpenLinker has not been told what that means: shipping it as one unit would
 * take 1 off stock for the price of N. One click confirms "one sale of this
 * offer = N x this product" (no new product, no remapping) and every order
 * waiting for it continues.
 *
 * @module apps/web/src/features/bundles/components
 */
import { useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useWriteAccess } from '../../../shared/auth/use-permission';
import { formatPlural, interpolate, useLocale, useMessages } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { useDemoMode } from '../../system';
import { useConfirmMultipackMutation } from '../hooks/use-confirm-multipack-mutation';

export interface MultipackHold {
  lineId: string;
  packQuantity: number;
  lineName: string | null;
  variantId: string | null;
  productName: string | null;
  sku: string | null;
}

export function MultipackHoldBanner({
  hold,
  otherLinesHeld = false,
}: {
  hold: MultipackHold;
  /** The order holds more than one multipack line; confirming this one does not free the order. */
  otherLinesHeld?: boolean;
}): ReactElement {
  const copy = useMessages('bundles');
  const { locale } = useLocale();
  const demoMode = useDemoMode();
  const write = useWriteAccess('bundles:write', demoMode);
  const confirm = useConfirmMultipackMutation();
  const [released, setReleased] = useState<number | null>(null);
  const name = hold.productName ?? hold.lineName ?? hold.sku ?? '';
  const productsHref = `/products?${new URLSearchParams({ search: hold.sku ?? name }).toString()}`;
  const variantId = hold.variantId;

  if (released !== null) {
    return (
      <Alert
        tone="success"
        title={copy.order.multipackConfirmedTitle}
        data-testid="order-multipack-created"
      >
        {otherLinesHeld
          ? copy.order.multipackConfirmedOthers
          : formatPlural(released, copy.order.multipackContinue, locale)}
      </Alert>
    );
  }

  const unavailableReason = !write.canWrite
    ? copy.order.viewOnlyReason
    : variantId === null
      ? copy.order.multipackNoProduct
      : undefined;

  return (
    <Alert
      tone="warning"
      title={interpolate(copy.order.multipackTitle, { n: hold.packQuantity })}
      data-testid="order-multipack-banner"
      action={
        <span className="button-group">
          <Button
            tone="primary"
            className="button--sm"
            data-testid="order-multipack-create-bundle"
            disabled={unavailableReason !== undefined || confirm.isPending}
            title={unavailableReason}
            onClick={() => {
              if (variantId === null) return;
              confirm.mutate(
                { variantId, packQuantity: hold.packQuantity },
                {
                  onSuccess: (result) => {
                    setReleased(result.releasedOrders);
                  },
                },
              );
            }}
          >
            {interpolate(copy.order.confirmMultipack, { n: hold.packQuantity, name })}
          </Button>
          <Link
            className="button button--ghost button--sm"
            data-testid="order-multipack-open-products"
            to={productsHref}
          >
            {copy.order.openProducts}
          </Link>
        </span>
      }
    >
      <p>{interpolate(copy.order.multipackBody, { n: hold.packQuantity })}</p>
      <p data-testid="order-multipack-confirm-text">
        {interpolate(
          otherLinesHeld ? copy.order.multipackConfirmTextLine : copy.order.multipackConfirmText,
          { n: hold.packQuantity, name },
        )}
      </p>
      {confirm.isError ? <p role="alert">{copy.order.multipackFailed}</p> : null}
    </Alert>
  );
}
