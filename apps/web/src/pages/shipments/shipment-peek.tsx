/**
 * ShipmentPeek (#4044)
 *
 * What a shipments row opens (row click, the arrow column or a card): the
 * shared `PeekPanel` with the order number linking to the order, the item,
 * customer and connection, the status and suggested action. The body leads
 * with Open order, then a Status / Processor / Tracking state card and the
 * content of the former expanded row - carrier rejection, facts and the same
 * actions (Generate / Regenerate / Download label, Mark dispatched, Cancel
 * shipment) - then Created and the shipment ID. ↑ ↓ / j k walk the rows.
 *
 * The page builds the cells (the same renderers the table uses), so the peek
 * and the row can never disagree about a shipment.
 *
 * @module apps/web/src/pages/shipments
 */
import type { ReactElement, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMessages } from '../../shared/i18n';
import { CopyableId } from '../../shared/ui/copyable-id';
import { PeekPanel, PeekStateCard } from '../../shared/ui/peek-panel';
import { TimeDisplay } from '../../shared/ui/time-display';
import type { Shipment } from '../../features/shipments/api/shipments.types';

export interface ShipmentPeekView {
  shipment: Shipment;
  /** Order number, or the shortened order id when the source sent none. */
  orderRef: string;
  meta: ReactNode;
  status: ReactNode;
  severity: ReactNode;
  processor: ReactNode;
  detail: ReactNode;
}

export interface ShipmentPeekProps {
  view: ShipmentPeekView | null;
  position: number;
  count: number;
  onNavigate: (step: -1 | 1) => void;
  onOpenChange: (open: boolean) => void;
}

export function ShipmentPeek({ view, position, count, onNavigate, onOpenChange }: ShipmentPeekProps): ReactElement {
  const copy = useMessages('shipments').shipmentsPage.peek;
  const shipment = view?.shipment;
  const orderHref = shipment ? `/orders/${encodeURIComponent(shipment.orderId)}` : '';
  return (
    <PeekPanel
      open={view !== null}
      onOpenChange={onOpenChange}
      position={position}
      count={count}
      onNavigate={onNavigate}
      bodyKey={shipment?.id}
      description={copy.description}
      title={
        view && shipment ? (
          <span className="peek-panel__ref">
            <Link className="peek-panel__title-link" to={orderHref}>
              {view.orderRef}
              <span className="peek-panel__title-arrow" aria-hidden="true">
                ↗
              </span>
            </Link>
          </span>
        ) : (
          copy.kicker
        )
      }
      meta={view ? <span className="peek-panel__meta">{view.meta}</span> : null}
      headerAside={
        view ? (
          <>
            {view.status}
            {view.severity}
          </>
        ) : null
      }
    >
      {view && shipment ? (
        <>
          <div className="peek-panel__actions">
            <Link className="button button--primary button--sm" to={orderHref}>
              {copy.openOrder}
            </Link>
          </div>
          <PeekStateCard
            label={copy.stateAria}
            rows={[
              { label: copy.status, value: view.status },
              { label: copy.processor, value: view.processor },
              {
                label: copy.tracking,
                value: shipment.trackingNumber ? (
                  <span className="mono-text">{shipment.trackingNumber}</span>
                ) : (
                  <span className="text-muted">-</span>
                ),
              },
            ]}
          />
          {view.detail}
          <dl className="shipment-peek__facts">
            <div>
              <dt className="eyebrow">{copy.created}</dt>
              <dd>
                <TimeDisplay iso={shipment.createdAt} />
              </dd>
            </div>
            <div>
              <dt className="eyebrow">{copy.shipmentId}</dt>
              <dd>
                <CopyableId id={shipment.id} />
              </dd>
            </div>
          </dl>
        </>
      ) : null}
    </PeekPanel>
  );
}
