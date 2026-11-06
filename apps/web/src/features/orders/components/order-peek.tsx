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
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../../shared/ui/button';
import { SidePanel } from '../../../shared/ui/side-panel';
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

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  );
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
  const open = view !== null;
  const hasPrevious = position > 1;
  const hasNext = position < count;

  useEffect(() => {
    if (!open) return undefined;
    function onKeydown(e: KeyboardEvent): void {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      if ((e.key === 'ArrowDown' || e.key === 'j') && hasNext) {
        e.preventDefault();
        onNavigate(1);
      } else if ((e.key === 'ArrowUp' || e.key === 'k') && hasPrevious) {
        e.preventDefault();
        onNavigate(-1);
      }
    }
    document.addEventListener('keydown', onKeydown);
    return () => {
      document.removeEventListener('keydown', onKeydown);
    };
  }, [open, hasNext, hasPrevious, onNavigate]);

  return (
    <SidePanel
      open={open}
      onOpenChange={onOpenChange}
      width={560}
      className="peek-panel"
      closeIcon
      closeLabel={COPY.closeDetails}
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
      description={COPY.description}
      footer={
        <div className="peek-panel__foot">
          <span className="text-muted mono tabular">{interpolate(COPY.position, { index: String(position), count: String(count) })}</span>
          <span className="button-group">
            <Button
              tone="secondary"
              className="button--sm"
              disabled={!hasPrevious}
              onClick={() => {
                onNavigate(-1);
              }}
            >
              {COPY.previous}
            </Button>
            <Button
              tone="secondary"
              className="button--sm"
              disabled={!hasNext}
              onClick={() => {
                onNavigate(1);
              }}
            >
              {COPY.next}
            </Button>
          </span>
        </div>
      }
    >
      {view ? (
        <div className="peek-panel__body" key={view.internalOrderId}>
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
          <section className="peek-panel__state" aria-label={COPY.stateAria}>
            <div className="peek-panel__state-row">
              <span className="eyebrow">{COPY.status}</span>
              <div className="peek-panel__state-value">{view.status}</div>
            </div>
            <div className="peek-panel__state-row">
              <span className="eyebrow">{COPY.shipment}</span>
              <div className="peek-panel__state-value">{view.shipment}</div>
            </div>
            <div className="peek-panel__state-row">
              <span className="eyebrow">{COPY.money}</span>
              <div className="peek-panel__state-value">{view.money}</div>
            </div>
          </section>
          {view.detail}
        </div>
      ) : null}
    </SidePanel>
  );
}
