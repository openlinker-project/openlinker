/**
 * StockMovementPeek (#3935)
 *
 * What a row of the stock movement history opens: the shared `PeekPanel` with the
 * product, the type and status, and for a gift movement a callout saying where
 * the gift came from, with a link to the promotion that gave it. ↑ ↓ / j k walk
 * the rows. Read-only: nothing here changes stock.
 *
 * @module apps/web/src/features/inventory/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { interpolate, useMessages } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import { PeekPanel } from '../../../shared/ui/peek-panel';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { TimeDisplay } from '../../../shared/ui/time-display';
import type { InventoryMovementRow } from '../api/inventory-movements.types';
import {
  presentMovementStatus,
  presentMovementType,
  sourceKindLabel,
} from '../lib/stock-movement-presentation';
import { giftSourceText } from './stock-movements-table';

export interface StockMovementPeekProps {
  row: InventoryMovementRow | null;
  position: number;
  count: number;
  connectionNames: ReadonlyMap<string, string>;
  onNavigate: (step: -1 | 1) => void;
  onOpenChange: (open: boolean) => void;
}

export function StockMovementPeek({
  row,
  position,
  count,
  connectionNames,
  onNavigate,
  onOpenChange,
}: StockMovementPeekProps): ReactElement {
  const copy = useMessages('inventory').inventoryMovementsPage.peek;
  const tableCopy = useMessages('inventory').stockMovementsTable;
  const type = row ? presentMovementType(row) : null;
  const status = row ? presentMovementStatus(row.status) : null;
  const gift = row?.gift ?? null;
  const masterName = row?.sourceConnectionId ? (connectionNames.get(row.sourceConnectionId) ?? null) : null;
  const who = row
    ? row.actorUserId !== null
      ? (row.actorName ?? tableCopy.unknownUser)
      : `${copy.system} · ${sourceKindLabel(row.sourceKind) ?? ''}`.replace(/ · $/, '')
    : '';

  return (
    <PeekPanel
      open={row !== null}
      onOpenChange={onOpenChange}
      position={position}
      count={count}
      onNavigate={onNavigate}
      bodyKey={row ? `${row.kind}:${row.id}` : undefined}
      description={copy.description}
      title={row ? (row.productName ?? row.sku ?? copy.kicker) : copy.kicker}
      meta={
        row ? (
          <span className="peek-panel__meta">
            <span className="chip">{type?.label}</span>{' '}
            {status ? (
              <StatusBadge tone={status.tone} compact withDot>
                {status.label}
              </StatusBadge>
            ) : null}
          </span>
        ) : null
      }
    >
      {row ? (
        <>
          {gift ? (
            <Alert tone="info" data-testid="stock-movement-peek-gift">
              <strong>{copy.giftTitle}</strong> {copy.giftFrom[gift.source]} {copy.giftBody}
            </Alert>
          ) : null}
          <dl className="stock-movement-peek__facts">
            <div>
              <dt className="eyebrow">{copy.time}</dt>
              <dd>
                <TimeDisplay iso={row.occurredAt} />
              </dd>
            </div>
            <div>
              <dt className="eyebrow">{copy.who}</dt>
              <dd>{who}</dd>
            </div>
            <div>
              <dt className="eyebrow">{copy.change}</dt>
              <dd className="mono-text tabular">
                {row.kind === 'reservation'
                  ? interpolate(row.status === 'held' ? tableCopy.reservedFromZero : tableCopy.reservedToZero, {
                      n: row.quantityDelta,
                    })
                  : `${row.quantityDelta > 0 ? '+' : ''}${String(row.quantityDelta)}${
                      row.quantityAfter !== null ? ` · ${String(row.quantityBefore ?? (row.status === 'applied' ? tableCopy.new : '?'))} → ${String(row.quantityAfter)}` : ''
                    }`}
              </dd>
            </div>
            <div>
              <dt className="eyebrow">{copy.master}</dt>
              <dd>{masterName ?? '-'}</dd>
            </div>
          </dl>
          {row.sourceKind === 'order' && row.sourceRef ? (
            <section className="stock-movement-peek__order">
              <p className="eyebrow">{copy.order}</p>
              <Link className="mono-text" to={`/orders/${encodeURIComponent(row.sourceRef)}`}>
                {row.sourceLabel ?? tableCopy.order}
              </Link>
              {gift ? (
                <p className="text-muted" data-testid="stock-movement-peek-source">
                  {giftSourceText(gift, tableCopy.giftSource)}
                </p>
              ) : null}
            </section>
          ) : null}
          <div className="peek-panel__actions">
            {row.sourceKind === 'order' && row.sourceRef ? (
              <Link
                className="button button--primary button--sm"
                to={`/orders/${encodeURIComponent(row.sourceRef)}`}
              >
                {copy.openOrder}
              </Link>
            ) : null}
            {gift?.promotionId ? (
              <Link
                className="button button--secondary button--sm"
                to={`/promotions/${encodeURIComponent(gift.promotionId)}`}
              >
                {copy.seePromotion}
              </Link>
            ) : null}
          </div>
        </>
      ) : null}
    </PeekPanel>
  );
}
