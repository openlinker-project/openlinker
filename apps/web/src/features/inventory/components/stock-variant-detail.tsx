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
import { useId, useState, type ReactElement, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { interpolate, renderRich, useMessages, usePlural } from '../../../shared/i18n';
import { Button } from '../../../shared/ui/button';
import { CopyableId } from '../../../shared/ui/copyable-id';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { TimeDisplay } from '../../../shared/ui/time-display';
import type { StockViewVariant } from '../api/inventory.types';
import { isUnnamedMaster, type ProductStockModel, type StockRowModel } from '../lib/stock-row';

type DetailCopy = ReturnType<typeof useMessages<'inventory'>>['stockVariantDetail'];
import { formatStaleness, holdLabel, publishedHolds, recordedOnlyHolds } from '../lib/stock-view';

function sourceLabel(row: StockRowModel): string {
  return isUnnamedMaster(row.masterName) ? '—' : row.masterName;
}

/** Only the cases that are NOT the default computed-by-OpenLinker one need saying. */
function howWeKnow(copy: DetailCopy, stock: StockViewVariant, source: string): string | null {
  if (stock.provenance === 'unknown') return copy.provenanceUnknown;
  if (stock.provenance === 'authority') {
    return source === '—' ? copy.provenanceExternal : interpolate(copy.provenanceReportedBy, { source });
  }
  return null;
}

function shortOrderRef(label: string): string {
  return label.length > 12 ? `${label.slice(0, 8)}…` : label;
}

/** Stock source, location and last-synced cells, placed first in the variant's details grid. */
export function StockMetaCells({ row }: { row: StockRowModel }): ReactElement | null {
  const copy = useMessages('inventory').stockVariantDetail;
  const { stock, key } = row;
  if (row.state === 'loading' || row.state === 'restricted' || stock === null) return null;
  const live = stock.positions.filter((position) => !position.isStale);
  const locationNames = [...new Set(live.map((p) => p.locationName).filter((n): n is string => !!n))];
  const source = sourceLabel(row);
  const provenance = howWeKnow(copy, stock, source);
  return (
    <>
      <div className="variant-drawer__meta-cell" data-testid={`stock-provenance-${key}`}>
        <span className="variant-drawer__meta-label">{copy.stockSource}</span>
        <span className="variant-drawer__meta-value variant-drawer__meta-value--wrap">
          {source}
          {provenance ? <span className="variant-drawer__meta-muted"> · {provenance}</span> : null}
        </span>
      </div>
      <div className="variant-drawer__meta-cell">
        <span className="variant-drawer__meta-label">{copy.location}</span>
        <span className="variant-drawer__meta-value variant-drawer__meta-value--wrap">
          {row.multiLocation
            ? interpolate(copy.multiLocation, { n: stock.livePositionCount })
            : locationNames.length > 0
              ? locationNames.join(', ')
              : copy.noLocation}
        </span>
      </div>
      <div className="variant-drawer__meta-cell">
        <span className="variant-drawer__meta-label">{copy.lastSynced}</span>
        <span className="variant-drawer__meta-value variant-drawer__meta-value--wrap">
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
    </>
  );
}

/** Variant id, shortened, with the copy affordance the rest of the app uses. */
export function VariantIdValue({ id }: { id: string }): ReactElement {
  const copy = useMessages('inventory').stockVariantDetail;
  return (
    <CopyableId
      id={id}
      label={id.length > 22 ? `${id.slice(0, 14)}…` : id}
      copyLabel={copy.copyVariantId}
      copiedLabel={copy.copiedVariantId}
    />
  );
}

function Note({ testId, children }: { testId: string; children: ReactNode }): ReactElement {
  return (
    <p className="stock-eq__note" data-testid={testId}>
      {children}
    </p>
  );
}

function Equation({ row, stock }: { row: StockRowModel; stock: ProductStockModel | null }): ReactElement | null {
  const copy = useMessages('inventory').stockVariantDetail;
  const plural = usePlural();
  const [open, setOpen] = useState(false);
  const listId = useId();
  const { stock: view, key } = row;
  if (view === null) return null;
  const name = row.masterName;
  const bold = { b: (text: string) => <b>{text}</b> };
  const testId = `stock-formula-${key}`;
  const actions = stock ? <StockActions row={row} stock={stock} /> : null;

  let body: ReactElement;
  if (row.state === 'unknown') {
    body = (
      <Note testId={testId}>
        {renderRich(copy.unknownNote, bold, { n: view.masterAvailable, master: name })}
      </Note>
    );
  } else if (row.state === 'staled') {
    body = (
      <Note testId={testId}>
        {view.positions[0]
          ? renderRich(
              copy.stoppedReportingOn,
              { ...bold, time: () => <TimeDisplay iso={view.positions[0]!.updatedAt} /> },
              { master: name, key },
            )
          : renderRich(copy.stoppedReporting, bold, { master: name, key })}
      </Note>
    );
  } else if (row.multiSource) {
    const bySource = new Map<string, number>();
    for (const position of view.positions) {
      if (position.isStale) continue;
      const label = position.sourceConnectionName ?? copy.anotherConnection;
      bySource.set(label, (bySource.get(label) ?? 0) + position.availableQuantity);
    }
    body = (
      <Note testId={testId}>
        {renderRich(copy.multiSourceNote, bold, {
          total: view.masterAvailable,
          terms: [...bySource].map(([label, qty]) => interpolate(copy.sourceTerm, { n: qty, source: label })).join(' + '),
        })}
      </Note>
    );
  } else {
    const reserved = view.heldCounted ?? 0;
    const counted = publishedHolds(view.holds);
    const toSell = view.availableToPromise ?? 0;
    const shortBy = Math.max(0, reserved - view.masterAvailable);
    const listable = counted.length > 0;
    body = (
      <div className="stock-eq__line" data-testid={testId}>
        <span className="stock-eq__term">
          <b className="stock-eq__num">{view.masterAvailable}</b> {interpolate(copy.inMaster, { master: name })}
        </span>{' '}
        {reserved > 0 ? (
          <>
            <span className="stock-eq__op">{'−'}</span>{' '}
            {listable ? (
              <button
                type="button"
                className="stock-eq__reserved"
                aria-expanded={open}
                aria-controls={listId}
                data-testid={`stock-holds-toggle-${key}`}
                onClick={() => setOpen((prev) => !prev)}
              >
                <b className="stock-eq__num">{reserved}</b> {copy.reserved}
                <svg className="stock-eq__chevron" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 4.5l3 3 3-3" />
                </svg>
              </button>
            ) : (
              <span className="stock-eq__term">
                <b className="stock-eq__num">{reserved}</b> {copy.reserved}
              </span>
            )}{' '}
          </>
        ) : null}
        <span className="stock-eq__op">=</span>{' '}
        <span className="stock-eq__term">
          <b className="stock-eq__num">{toSell}</b> {copy.toSell}
        </span>
        {shortBy > 0 ? (
          <span className="stock-eq__short">{interpolate(copy.shortBy, { n: shortBy })}</span>
        ) : null}
      </div>
    );
    const recordedOnly = recordedOnlyHolds(view.holds);
    const recordedUnits = view.heldRecordedOnly ?? recordedOnly.reduce((sum, hold) => sum + hold.quantity, 0);
    return (
      <div className="stock-eq">
        <div className="stock-eq__head">
          {body}
          {actions}
        </div>
        {reserved > 0 && view.holds === null ? (
          <p className="stock-eq__note">{copy.holdsUnlisted}</p>
        ) : null}
        {listable ? (
          <ul
            id={listId}
            hidden={!open}
            className="stock-eq__holds"
            data-testid={open ? `stock-holds-${key}` : undefined}
          >
            {counted.map((hold) => {
              const label = holdLabel(hold);
              return (
                <li key={hold.orderRecordId} data-testid={`stock-hold-${label}`}>
                  <Link
                    to={`/orders/${encodeURIComponent(hold.orderRecordId)}`}
                    className="mono-text"
                    title={label}
                    aria-label={interpolate(copy.orderAria, { label })}
                  >
                    {shortOrderRef(label)}
                  </Link>
                  <span className="mono-text tabular">{interpolate(copy.holdReserved, { n: hold.quantity })}</span>
                </li>
              );
            })}
          </ul>
        ) : null}
        {recordedUnits > 0 ? (
          <p className="stock-eq__note" data-testid={`stock-recorded-${key}`}>
            {plural(recordedUnits, copy.recordedOnly)}
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <div className="stock-eq">
      <div className="stock-eq__head">
        {body}
        {actions}
      </div>
    </div>
  );
}

function Positions({ row }: { row: StockRowModel }): ReactElement | null {
  const copy = useMessages('inventory').stockVariantDetail.positions;
  const { stock, key } = row;
  if (stock === null || stock.positions.length <= 1) return null;
  return (
    <div className="av-ch-scroll av-positions">
      <table className="av-ch-table" data-testid={`stock-positions-${key}`}>
        <thead>
          <tr>
            <th>{copy.location}</th>
            <th>{copy.stockSource}</th>
            <th className="av-ch-num">{copy.stock}</th>
            <th className="av-ch-num">{copy.reservedInShop}</th>
            <th>{copy.lastSynced}</th>
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
                      {copy.stale}
                    </StatusBadge>
                    <span className="av-sub">{copy.notCounted}</span>
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

/** The equation strip (with its actions at the right end), the reserving orders and the positions. */
export function StockNarrative({
  row,
  stock = null,
}: {
  row: StockRowModel;
  stock?: ProductStockModel | null;
}): ReactElement | null {
  if (row.state === 'loading' || row.state === 'restricted' || row.stock === null) return null;
  return (
    <>
      <Equation row={row} stock={stock} />
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
  const copy = useMessages('inventory').stockVariantDetail;
  const { key } = row;
  const disabled = row.adjustHint !== null || !stock.onAdjust;
  const hintId = `stock-adjust-hint-${key}`;
  const hint: ReactNode = row.adjustHint;
  return (
    <div className="stock-eq__actions">
      <div className="stock-eq__adjust">
      <Button
        tone="secondary"
        disabled={disabled}
        aria-describedby={hint ? hintId : undefined}
        data-testid={`stock-adjust-${key}`}
        onClick={() => stock.onAdjust?.({ variant: row.variant, stock: row.stock })}
      >
        {copy.adjustStock}
      </Button>
      {hint ? (
        <span id={hintId} className="stock-eq__hint" data-testid={hintId}>
          {hint}
        </span>
      ) : null}
      </div>
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
          {copy.stockHistory} <span className="variant-drawer__arrow">→</span>
        </a>
      ) : null}
    </div>
  );
}
