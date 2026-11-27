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
  const unavailableReason = !write.canWrite
    ? copy.order.viewOnlyReason
    : variantId === null
      ? copy.order.multipackNoProduct
      : undefined;

  // One Alert instance for both states, so the tone change cross-fades through
  // the CSS transition instead of swapping a warning box for a success box.
  const isReleased = released !== null;
  const bundleHref = `/products/bundles/new?${new URLSearchParams({
    component: variantId ?? '',
    quantity: String(hold.packQuantity),
  }).toString()}`;

  return (
    <Alert
      tone={isReleased ? 'success' : 'warning'}
      className="ux-hold-banner"
      title={
        isReleased
          ? copy.order.multipackConfirmedTitle
          : interpolate(copy.order.multipackTitle, { n: hold.packQuantity })
      }
      data-testid={isReleased ? 'order-multipack-created' : 'order-multipack-banner'}
      action={
        isReleased ? undefined : (
          <span className="button-group ux-hold-banner__actions">
            <Button
              tone="primary"
              className="button--sm"
              data-testid="order-multipack-create-bundle"
              disabled={unavailableReason !== undefined || confirm.isPending}
              aria-describedby={unavailableReason ? 'order-multipack-reason' : undefined}
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
              {confirm.isPending
                ? copy.order.multipackSaving
                : interpolate(copy.order.confirmMultipack, { n: hold.packQuantity, name })}
            </Button>
            <Link
              className="button button--ghost button--sm"
              data-testid="order-multipack-open-products"
              to={productsHref}
            >
              {copy.order.openProducts}
            </Link>
          </span>
        )
      }
    >
      {isReleased ? (
        <>
          <p>
            {otherLinesHeld
              ? copy.order.multipackConfirmedOthers
              : formatPlural(released, copy.order.multipackContinue, locale)}
          </p>
          <p className="ux-hold-banner__rule">
            {copy.order.multipackRuleSaved}{' '}
            <Link to={productsHref} data-testid="order-multipack-rule-link">
              {copy.order.multipackRuleLink}
            </Link>
          </p>
        </>
      ) : (
        <>
          <p data-testid="order-multipack-confirm-text">
            {interpolate(
              otherLinesHeld
                ? copy.order.multipackConfirmTextLine
                : copy.order.multipackConfirmText,
              { n: hold.packQuantity, name },
            )}
          </p>
          <p className="ux-hold-banner__preview" data-testid="order-multipack-preview">
            <span>{copy.order.multipackPreviewSale}</span>
            <span aria-hidden="true">{'\u2192'}</span>
            <strong>{interpolate(copy.list.compositionLine, { n: hold.packQuantity, name })}</strong>
          </p>
          <p className="ux-hold-banner__lead">{copy.order.multipackWhatHappens}</p>
          <ul className="ux-hold-banner__list" data-testid="order-multipack-effects">
            <li>{copy.order.multipackEffectRule}</li>
            <li>{interpolate(copy.order.multipackEffectStock, { n: hold.packQuantity })}</li>
            <li>{copy.order.multipackEffectOrders}</li>
          </ul>
          <p className="ux-hold-banner__alt">
            {copy.order.multipackNotSet}{' '}
            {variantId !== null ? (
              <Link to={bundleHref} data-testid="order-multipack-make-bundle">
                {copy.order.multipackMakeBundle}
              </Link>
            ) : null}
          </p>
          {unavailableReason ? (
            <p id="order-multipack-reason" className="ux-hold-banner__reason">
              {unavailableReason}
            </p>
          ) : null}
          {confirm.isPending ? (
            <p className="sr-only" aria-live="polite">
              {copy.order.multipackSaving}
            </p>
          ) : null}
          {confirm.isError ? <p role="alert">{copy.order.multipackFailed}</p> : null}
        </>
      )}
    </Alert>
  );
}
