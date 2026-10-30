/**
 * Stock variant detail (#3569, mockup m25)
 *
 * The stock half of a variants-table row's expanded view, in three parts the
 * table places around its own attribute and listing blocks: the meta cells
 * (where the figure comes from), the narrative (the sum behind "to sell", the
 * orders reserving units, the positions) and the actions (Adjust stock and a
 * link to the history).
 *
 * @module apps/web/src/features/inventory/components
 */
import { useState, type ReactElement, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../../shared/ui/button';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { TimeDisplay } from '../../../shared/ui/time-display';
import type { StockViewVariant } from '../api/inventory.types';
import {
  UNNAMED_MASTER,
  type ProductStockModel,
  type StockRowModel,
} from '../lib/stock-row';
import { formatStaleness, holdLabel, publishedHolds, recordedOnlyHolds } from '../lib/stock-view';

function pluralize(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function sourceLabel(row: StockRowModel): string {
  return row.masterName === UNNAMED_MASTER ? '—' : row.masterName;
}

function howWeKnow(stock: StockViewVariant): string {
  if (stock.provenance === 'unknown') return 'not known';
  if (stock.provenance === 'authority') return 'reported by an external system';
  return 'worked out by OpenLinker';
}

/** Cells appended to the variant's attribute / ID / EAN grid. */
export function StockMetaCells({ row }: { row: StockRowModel }): ReactElement | null {
  const { stock, key } = row;
  if (row.state === 'loading' || row.state === 'restricted' || stock === null) return null;
  const live = stock.positions.filter((position) => !position.isStale);
  const locationNames = [...new Set(live.map((p) => p.locationName).filter((n): n is string => !!n))];
  return (
    <>
      <div className="variant-drawer__meta-cell" data-testid={`stock-provenance-${key}`}>
        <span className="variant-drawer__meta-label">Stock source</span>
        <span className="variant-drawer__meta-value variant-drawer__meta-value--wrap">
          {sourceLabel(row)} <span className="variant-drawer__meta-muted">· {howWeKnow(stock)}</span>
        </span>
      </div>
      <div className="variant-drawer__meta-cell">
        <span className="variant-drawer__meta-label">Location</span>
        <span className="variant-drawer__meta-value variant-drawer__meta-value--wrap">
          {row.multiLocation
            ? `${stock.livePositionCount} locations - see below`
            : locationNames.length > 0
              ? locationNames.join(', ')
              : 'No location reported'}
        </span>
      </div>
      <div className="variant-drawer__meta-cell">
        <span className="variant-drawer__meta-label">Last synced</span>
        <span className="variant-drawer__meta-value">
          {stock.observedAt ? (
            <>
              <TimeDisplay className="mono-text" iso={stock.observedAt} />{' '}
              {stock.stalenessMs !== null ? (
                <span className="variant-drawer__meta-muted">{formatStaleness(stock.stalenessMs)}</span>
              ) : null}
            </>
          ) : (
            '—'
          )}
        </span>
      </div>
      {row.state === 'ok' && row.masterReserved > 0 ? (
        <div className="variant-drawer__meta-cell">
          <span className="variant-drawer__meta-label">Reserved in {sourceLabel(row)}</span>
          <span className="variant-drawer__meta-value mono-text tabular">
            {row.masterReserved}
            <span className="variant-drawer__meta-muted">
              {' '}
              already taken out of the {row.masterAvailable}
            </span>
          </span>
        </div>
      ) : null}
    </>
  );
}

function Formula({ row }: { row: StockRowModel }): ReactElement | null {
  const { stock, key } = row;
  if (stock === null) return null;
  const name = sourceLabel(row) === '—' ? 'the master' : row.masterName;
  const testId = `stock-formula-${key}`;

  if (row.state === 'unknown') {
    return (
      <p className="variant-drawer__note" data-testid={testId}>
        <b>{stock.masterAvailable}</b> in {name}. OpenLinker can&apos;t work out the reserved count right now, so it
        isn&apos;t sending stock to your channels.
      </p>
    );
  }
  if (row.state === 'staled') {
    return (
      <p className="variant-drawer__note" data-testid={testId}>
        {name} stopped reporting <b>{key}</b>
        {stock.positions[0] ? (
          <>
            {' '}
            on <TimeDisplay iso={stock.positions[0].updatedAt} />
          </>
        ) : null}
        . It is no longer counted, so you can sell <b>0</b> and its listings are paused. If the variant was deleted
        on purpose, nothing else is needed.
      </p>
    );
  }
  if (row.multiSource) {
    const bySource = new Map<string, number>();
    for (const position of stock.positions) {
      if (position.isStale) continue;
      const label = position.sourceConnectionName ?? 'another connection';
      bySource.set(label, (bySource.get(label) ?? 0) + position.availableQuantity);
    }
    return (
      <p className="variant-drawer__note" data-testid={testId}>
        <b>{stock.masterAvailable}</b> = {[...bySource].map(([label, qty]) => `${qty} in ${label}`).join(' + ')}. New
        orders for this variant don&apos;t reserve stock until one shop owns it.
      </p>
    );
  }
  const reserved = stock.heldCounted ?? 0;
  const orders = publishedHolds(stock.holds).length;
  const toSell = stock.availableToPromise ?? 0;
  const shortBy = Math.max(0, reserved - stock.masterAvailable);
  return (
    <p className="variant-drawer__note" data-testid={testId}>
      <b>{stock.masterAvailable}</b> in {name}
      {reserved > 0 ? (
        <>
          {' − '}
          <b>{reserved}</b> reserved{stock.holds !== null ? ` for ${pluralize(orders, 'order', 'orders')}` : ''}
        </>
      ) : null}{' '}
      = <b>{toSell}</b> to sell
      {shortBy > 0 ? `. ${shortBy} of the reserved units aren't in stock.` : '.'}
    </p>
  );
}

function Holds({ row }: { row: StockRowModel }): ReactElement | null {
  const [open, setOpen] = useState(false);
  const { stock, key } = row;
  if (stock === null || row.state !== 'ok' || row.multiSource) return null;
  const counted = publishedHolds(stock.holds);
  const recordedOnly = recordedOnlyHolds(stock.holds);
  const recordedUnits = stock.heldRecordedOnly ?? recordedOnly.reduce((sum, hold) => sum + hold.quantity, 0);
  const reserved = stock.heldCounted ?? 0;
  return (
    <>
      {reserved > 0 && stock.holds === null ? (
        <p className="variant-drawer__note">The orders reserving stock couldn&apos;t be listed.</p>
      ) : null}
      {counted.length > 0 ? (
        <>
          <Button
            tone="ghost"
            aria-expanded={open}
            data-testid={`stock-holds-toggle-${key}`}
            onClick={() => setOpen((prev) => !prev)}
          >
            {open ? 'Hide' : 'Show'} the {pluralize(counted.length, 'order', 'orders')}
          </Button>
          {open ? (
            <ul className="variant-drawer__holds" data-testid={`stock-holds-${key}`}>
              {counted.map((hold) => (
                <li key={hold.orderRecordId} data-testid={`stock-hold-${holdLabel(hold)}`}>
                  <Link to={`/orders/${encodeURIComponent(hold.orderRecordId)}`}>Order {holdLabel(hold)}</Link>
                  <span className="mono-text tabular">{hold.quantity} reserved</span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
      {recordedUnits > 0 ? (
        <p className="variant-drawer__note" data-testid={`stock-recorded-${key}`}>
          {recordedUnits} more {recordedUnits === 1 ? 'is' : 'are'} reserved for orders OpenLinker doesn&apos;t
          fulfil. They don&apos;t lower what you can sell.
        </p>
      ) : null}
    </>
  );
}

function Positions({ row }: { row: StockRowModel }): ReactElement | null {
  const { stock, key } = row;
  if (stock === null || stock.positions.length <= 1) return null;
  return (
    <div className="av-ch-scroll av-positions">
      <table className="av-ch-table" data-testid={`stock-positions-${key}`}>
        <thead>
          <tr>
            <th>Location</th>
            <th>Stock source</th>
            <th className="av-ch-num">Stock</th>
            <th className="av-ch-num">Reserved in the shop</th>
            <th>Last synced</th>
          </tr>
        </thead>
        <tbody>
          {stock.positions.map((position, index) => (
            <tr key={`${position.locationId ?? 'none'}:${position.sourceConnectionId ?? 'none'}:${index}`}>
              <td>
                {position.locationName ?? '—'}
                {position.isStale ? (
                  <>
                    {' '}
                    <StatusBadge tone="warning" compact withDot>
                      Stale
                    </StatusBadge>
                    <span className="av-sub">Not counted</span>
                  </>
                ) : null}
              </td>
              <td>{position.sourceConnectionName ?? '—'}</td>
              <td className="av-ch-num">{position.availableQuantity}</td>
              <td className="av-ch-num">{position.reservedQuantity}</td>
              <td>
                <TimeDisplay className="mono-text" iso={position.updatedAt} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The sum, the reserving orders and the positions. */
export function StockNarrative({ row }: { row: StockRowModel }): ReactElement | null {
  if (row.state === 'loading' || row.state === 'restricted' || row.stock === null) return null;
  return (
    <>
      <Formula row={row} />
      <Holds row={row} />
      <Positions row={row} />
    </>
  );
}

/** Adjust stock, with the reason it is off, and the way into the history. */
export function StockActions({
  row,
  stock,
}: {
  row: StockRowModel;
  stock: ProductStockModel;
}): ReactElement {
  const { key } = row;
  const disabled = row.adjustHint !== null || !stock.onAdjust;
  const hintId = `stock-adjust-hint-${key}`;
  const hint: ReactNode = row.adjustHint;
  return (
    <div className="variant-drawer__links variant-drawer__links--stock">
      <Button
        tone="secondary"
        disabled={disabled}
        aria-describedby={hint ? hintId : undefined}
        data-testid={`stock-adjust-${key}`}
        onClick={() => stock.onAdjust?.({ variant: row.variant, stock: row.stock })}
      >
        Adjust stock
      </Button>
      {hint ? (
        <span id={hintId} className="variant-drawer__meta-muted" data-testid={hintId}>
          {hint}
        </span>
      ) : null}
      {stock.onShowHistory ? (
        <a
          className="variant-drawer__link"
          href="#stock-history"
          data-testid={`stock-movements-${key}`}
          onClick={(event) => {
            event.preventDefault();
            stock.onShowHistory?.(row.variant.id);
          }}
        >
          Stock history <span className="variant-drawer__arrow">→</span>
        </a>
      ) : null}
    </div>
  );
}
