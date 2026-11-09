/**
 * Shipping route action (#3958)
 *
 * The one way order detail lets an operator change who ships an order's
 * delivery method: a button that opens the mappings feature's `RoutingDialog`
 * for the order's SOURCE connection, naming the delivery method the operator
 * came from. Used by the Delivery panel's "Shipped by" row, the delivery rider
 * and the Shipment panel's shop-ships-it state, so all three open the same
 * editor instead of sending the operator to a mappings tab.
 *
 * Gated like the routing panel itself (`connections:write`, with the demo
 * read-only lock): saving routes is a connection write, so a role that cannot
 * save sees no action rather than a dialog whose Save it is refused.
 *
 * @module apps/web/src/features/orders/components
 */
import { useState, type ReactElement } from 'react';

import { useWriteAccess } from '../../../shared/auth/use-permission';
import { demoReadOnlyActionMessage } from '../../../shared/config/demo-mode';
import { Button } from '../../../shared/ui/button';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { useConnectionsQuery } from '../../connections';
import { RoutingDialog } from '../../mappings';
import { useDemoMode } from '../../system';

/** Name used when the source connection is not in the (cache-warm) list yet. */
const UNKNOWN_SOURCE_NAME = 'channel';

interface ShippingRouteActionProps {
  /** The order's source connection; routing is keyed on it. */
  sourceConnectionId: string;
  /** Source display name when the caller already has it; looked up otherwise. */
  sourceName?: string | null;
  /** The order's delivery method, named in the dialog so the operator finds its row. */
  methodLabel?: string | null;
  methodId?: string | null;
  label: string;
  /**
   * `rider` renders the delivery rider banner's own button style, so the
   * action sits in that banner like the Connect / Enable links beside it.
   */
  appearance?: 'button' | 'rider';
}

export function ShippingRouteAction({
  sourceConnectionId,
  sourceName,
  methodLabel,
  methodId,
  label,
  appearance = 'button',
}: ShippingRouteActionProps): ReactElement | null {
  const demoMode = useDemoMode();
  const write = useWriteAccess('connections:write', demoMode);
  const connectionsQuery = useConnectionsQuery();
  const [open, setOpen] = useState(false);

  if (!write.visible) {
    return null;
  }

  const resolvedSourceName =
    sourceName ??
    connectionsQuery.data?.find((c) => c.id === sourceConnectionId)?.name ??
    UNKNOWN_SOURCE_NAME;

  return (
    <>
      <ReadOnlyLock active={write.demoReadOnly} message={demoReadOnlyActionMessage()}>
        {appearance === 'rider' ? (
          <button
            type="button"
            className="delivery-rider-banner__button"
            disabled={write.demoReadOnly}
            onClick={() => setOpen(true)}
          >
            {label}
          </button>
        ) : (
          <Button
            tone="secondary"
            className="button--sm"
            disabled={write.demoReadOnly}
            onClick={() => setOpen(true)}
          >
            {label}
          </Button>
        )}
      </ReadOnlyLock>
      <RoutingDialog
        open={open}
        onOpenChange={setOpen}
        sourceConnectionId={sourceConnectionId}
        sourceName={resolvedSourceName}
        methodLabel={methodLabel ?? undefined}
        methodId={methodId ?? undefined}
      />
    </>
  );
}
