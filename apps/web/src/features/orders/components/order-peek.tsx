/**
 * OrderPeek (#4026)
 *
 * The order summary that replaced the orders list's inline expanded row. It is
 * a `SidePanel`: a side sheet over the dimmed, blurred list on a desktop, a
 * bottom sheet on a phone. The header names the order (the order number links
 * to the order page), its channel and placed date, the total and payment; then
 * the actions, a Status / Shipment / Money card built from the SAME renderers
 * as the table cells, and the expanded row's old content (`detail`) unchanged.
 *
 * ↑ ↓ and J K walk the visible rows without closing; Previous / Next do the
 * same in the footer. The panel stays mounted while the order changes, and the
 * body is keyed on the order so its content swap is visible.
 *
 * @module apps/web/src/features/orders/components
 */
import { useState, type ReactElement, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { PeekPanel, PeekStateCard } from '../../../shared/ui/peek-panel';
import { formatOrderRef } from './order-identity-cell';
import { interpolate, useMessages } from '../../../shared/i18n';

export interface OrderPeekView {
  internalOrderId: string;
  /** The channel's order number; falls back to the internal id. */
  reference: string;
  source: ReactNode;
  destination?: string;
  placed?: ReactNode;
  total?: string;
  payment?: ReactNode;
  status: ReactNode;
  shipment: ReactNode;
  money: ReactNode;
  /** The order on its channel, when the source supplied a safe link. */
  channelUrl?: string;
  channelName?: string;
  /** Present only when OpenLinker can generate a label for this order. */
  generateLabelHref?: string;
  detail: ReactNode;
}

export interface OrderPeekProps {
  view: OrderPeekView | null;
  /** 1-based position among the visible rows. */
  position: number;
  count: number;
  onNavigate: (step: -1 | 1) => void;
  onOpenChange: (open: boolean) => void;
}

/** The mockup's quiet "Copy" beside the order number. */
function CopyReference({ value }: { value: string }): ReactElement {
  const COPY = useMessages('orders').peek;
  const common = useMessages('ui').common;
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="peek-panel__copy"
      title={COPY.copyReference}
      onClick={(event) => {
        event.stopPropagation();
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          window.setTimeout(() => {
            setCopied(false);
          }, 1500);
        });
      }}
    >
      {copied ? common.copied : common.copy}
    </button>
  );
}

export function OrderPeek({
  view,
  position,
  count,
  onNavigate,
  onOpenChange,
}: OrderPeekProps): ReactElement {
  const COPY = useMessages('orders').peek;
  return (
    <PeekPanel
      open={view !== null}
      onOpenChange={onOpenChange}
      position={position}
      count={count}
      onNavigate={onNavigate}
      bodyKey={view?.internalOrderId}
      description={COPY.description}
      title={
        view ? (
          <span className="peek-panel__ref">
            <Link className="peek-panel__title-link" to={`/orders/${view.internalOrderId}`}>
              {formatOrderRef(view.reference)}
              <span className="peek-panel__title-arrow" aria-hidden="true">
                ↗
              </span>
            </Link>
            <CopyReference value={view.reference} />
          </span>
        ) : (
          COPY.kicker
        )
      }
      meta={
        view ? (
          <span className="peek-panel__meta">
            {view.source}
            {view.destination ? <span>→ {view.destination}</span> : null}
            {view.placed ? <span>{view.placed}</span> : null}
          </span>
        ) : null
      }
      headerAside={
        view ? (
          <>
            {view.total ? <span className="peek-panel__total tabular">{view.total}</span> : null}
            {view.payment}
          </>
        ) : null
      }
    >
      {view ? (
        <>
          <div className="peek-panel__actions">
            <Link className="button button--primary button--sm" to={`/orders/${view.internalOrderId}`}>
              {COPY.openOrder}
            </Link>
            {view.channelUrl && view.channelName ? (
              <a
                className="button button--secondary button--sm"
                href={view.channelUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {interpolate(COPY.viewOn, { channel: view.channelName })} <span aria-hidden="true">↗</span>
              </a>
            ) : null}
            {view.generateLabelHref ? (
              <Link className="button button--secondary button--sm" to={view.generateLabelHref}>
                {COPY.generateLabel}
              </Link>
            ) : null}
          </div>
          <PeekStateCard
            label={COPY.stateAria}
            rows={[
              { label: COPY.status, value: view.status },
              { label: COPY.shipment, value: view.shipment },
              { label: COPY.money, value: view.money },
            ]}
          />
          {view.detail}
        </>
      ) : null}
    </PeekPanel>
  );
}
