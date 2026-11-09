/**
 * Stock movement history - list (#4061)
 *
 * Rows grouped by day. Every row answers two questions in two places: on the
 * left, which product and what happened to it, in one sentence; on the right,
 * by how much and when. One event seen on several products (a sync run, an
 * order) is one line, collapsed until opened. A badge appears only when a
 * change needs a look; help lives in the guide, not in the list.
 *
 * @module apps/web/src/features/inventory/components
 */
import { useMemo, useState, type ReactElement } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { interpolate } from '../../../shared/i18n';
import { StatusBadge } from '../../../shared/ui/status-badge';
import type { InventoryMovementRow } from '../api/inventory-movements.types';
import { presentMovementType } from '../lib/stock-movement-presentation';
import {
  bucketByDay,
  describeGroup,
  describeMovement,
  groupMovements,
  movementBadge,
  presentAmount,
  type AmountView,
  type MovementGroup,
  type StockHistoryContext,
} from '../lib/stock-movement-view-model';

export interface StockMovementHistoryProps {
  rows: readonly InventoryMovementRow[];
  context: StockHistoryContext;
  selectedId: string | null;
  onOpenRow: (row: InventoryMovementRow) => void;
  now: Date;
  formatTime: (iso: string) => string;
  formatDate: (iso: string) => string;
}

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

export function StockMovementHistory({
  rows,
  context,
  selectedId,
  onOpenRow,
  now,
  formatTime,
  formatDate,
}: StockMovementHistoryProps): ReactElement {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const days = useMemo(
    () => bucketByDay(groupMovements(rows), now, context.copy, formatDate),
    [rows, now, context.copy, formatDate],
  );
  const toggle = (key: string): void =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="stock-days" data-testid="stock-movements-table">
      {days.map((day) => (
        <section key={day.key} className="stock-day" aria-label={day.label}>
          <h2 className="stock-day__head">{day.label}</h2>
          <div className="stock-day__list">
            {day.groups.map((group) =>
              group.rows.length === 1 ? (
                <MovementRow
                  key={group.key}
                  row={group.rows[0]}
                  context={context}
                  selected={selectedId === group.rows[0].id}
                  onOpen={onOpenRow}
                  formatTime={formatTime}
                />
              ) : (
                <EventLine
                  key={group.key}
                  group={group}
                  open={expanded.has(group.key)}
                  onToggle={() => toggle(group.key)}
                  context={context}
                  selectedId={selectedId}
                  onOpen={onOpenRow}
                  formatTime={formatTime}
                />
              ),
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

function Amount({ amount }: { amount: AmountView }): ReactElement {
  return (
    <span className={`stock-amount stock-amount--${amount.tone}`}>
      <span className="stock-amount__change tabular" data-testid="stock-movement-change">
        {amount.change}
      </span>
      <span className="stock-amount__result" data-testid="stock-movement-result">
        {amount.result}
      </span>
    </span>
  );
}

interface MovementRowProps {
  row: InventoryMovementRow;
  context: StockHistoryContext;
  selected: boolean;
  onOpen: (row: InventoryMovementRow) => void;
  formatTime: (iso: string) => string;
  /** Inside an event line the sentence and the time are already said once, above. */
  nested?: boolean;
}

function MovementRow({ row, context, selected, onOpen, formatTime, nested = false }: MovementRowProps): ReactElement {
  const { copy } = context;
  const badge = movementBadge(row, copy);
  const sentence = describeMovement(row, context);
  const amount = presentAmount(row, copy);
  const product = row.productName ?? row.sku ?? row.productId;
  return (
    <button
      type="button"
      className={['stock-row', nested ? 'stock-row--nested' : '', selected ? 'stock-row--selected' : '']
        .filter(Boolean)
        .join(' ')}
      data-testid="stock-movement-row"
      data-movement-status={row.status}
      data-movement-kind={row.kind}
      data-movement-type={presentMovementType(row).token}
      onClick={() => onOpen(row)}
      aria-label={interpolate(copy.openDetails, {
        product,
        sentence,
        change: amount.change,
        result: amount.result,
      })}
    >
      <span className="stock-row__main">
        <span className="stock-row__name">
          {product}
          {row.sku && row.productName ? <span className="stock-row__sku mono-text">{row.sku}</span> : null}
        </span>
        {nested ? null : (
          <span className="stock-row__sentence">
            <span data-testid="stock-movement-sentence">{sentence}</span>
            {badge ? (
              <StatusBadge compact tone={badge.tone} data-testid="stock-movement-badge">
                {badge.label}
              </StatusBadge>
            ) : null}
          </span>
        )}
      </span>
      <Amount amount={amount} />
      <span className="stock-row__time tabular">{nested ? '' : formatTime(row.occurredAt)}</span>
      <span className="stock-row__chev" aria-hidden="true">
        ›
      </span>
    </button>
  );
}

interface EventLineProps {
  group: MovementGroup;
  open: boolean;
  onToggle: () => void;
  context: StockHistoryContext;
  selectedId: string | null;
  onOpen: (row: InventoryMovementRow) => void;
  formatTime: (iso: string) => string;
}

function EventLine({ group, open, onToggle, context, selectedId, onOpen, formatTime }: EventLineProps): ReactElement {
  const view = describeGroup(group, context);
  const bodyId = `stock-event-${group.key.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  return (
    <div className="stock-event" data-open={open} data-testid="stock-movement-group">
      <button
        type="button"
        className="stock-row stock-event__toggle"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={onToggle}
      >
        <span className="stock-row__main">
          <span className="stock-row__name">{view.title}</span>
          <span className="stock-row__sentence">
            {open ? context.copy.groups.hide : context.copy.groups.show}
          </span>
        </span>
        <Amount amount={view.amount} />
        <span className="stock-row__time tabular">{formatTime(group.rows[0].occurredAt)}</span>
        <motion.span
          className="stock-row__chev"
          aria-hidden="true"
          animate={{ rotate: open ? 90 : 0 }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        >
          ›
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="body"
            id={bodyId}
            className="stock-event__body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ height: { duration: 0.28, ease: EASE }, opacity: { duration: 0.18 } }}
          >
            {group.rows.map((row) => (
              <MovementRow
                key={row.id}
                row={row}
                context={context}
                selected={selectedId === row.id}
                onOpen={onOpen}
                formatTime={formatTime}
                nested
              />
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
