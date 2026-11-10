/**
 * Stock movement history - view model (#4061)
 *
 * Pure presentation rules for the global history page: the one sentence a
 * row reads as, its one amount (the change over the resulting stock),
 * grouping one sync run or one order into a single expandable line, the day a
 * line belongs to, and the plain explanation the detail panel opens with.
 *
 * Every function takes the copy it renders as an argument, so the rules are
 * testable against `InventoryMovementRow` exactly as the API returns it and
 * follow the active language without reading it themselves.
 *
 * @module apps/web/src/features/inventory/lib
 */
import { interpolate, type getMessages, type PluralFn } from '../../../shared/i18n';
import type { InventoryMovementRow } from '../api/inventory-movements.types';
import { movementNeedsAttention, operatorReasonText, presentRefusalText } from './stock-movement-presentation';

export type StockHistoryCopy = ReturnType<typeof getMessages<'inventory'>>['stockHistory'];

export interface StockHistoryContext {
  copy: StockHistoryCopy;
  plural: PluralFn;
  /** The name of the connection that keeps the row's stock. */
  masterName: (row: InventoryMovementRow) => string;
  /** Any connection's name by id, for the channels a change was sent to. */
  connectionName: (connectionId: string) => string;
}

// ── Amount ───────────────────────────────────────────────────────────

/** `up` / `down` move stock, `void` moved nothing, `reserve` is a hold. */
export type AmountTone = 'up' | 'down' | 'void' | 'reserve';

export interface AmountView {
  /** The big number: the signed change, or the starting count. */
  change: string;
  /** The small line under it: the result, or why there is none. */
  result: string;
  tone: AmountTone;
}

const MINUS = '−';

export function signed(value: number): string {
  if (value > 0) return `+${value}`;
  if (value < 0) return `${MINUS}${Math.abs(value)}`;
  return '0';
}

/** A hold is the promised quantity, positive while held and negative once let go. */
function holdChange(row: InventoryMovementRow): number {
  return row.status === 'held' ? Math.abs(row.quantityDelta) : -Math.abs(row.quantityDelta);
}

export function presentAmount(row: InventoryMovementRow, copy: StockHistoryCopy): AmountView {
  const a = copy.amount;
  if (row.kind === 'reservation') {
    const result =
      row.status === 'held'
        ? a.held
        : row.status === 'consumed'
          ? a.shipped
          : row.status === 'expired'
            ? a.expired
            : a.released;
    return { change: signed(holdChange(row)), result, tone: 'reserve' };
  }
  if (row.status === 'refused') return { change: signed(row.quantityDelta), result: a.notApplied, tone: 'void' };
  if (row.status === 'in_doubt') return { change: signed(row.quantityDelta), result: a.notConfirmed, tone: 'void' };
  if (row.status === 'pending') return { change: signed(row.quantityDelta), result: a.waiting, tone: 'void' };
  if (row.quantityBefore === null && row.quantityAfter !== null) {
    return { change: String(row.quantityAfter), result: a.startingCount, tone: 'up' };
  }
  return {
    change: signed(row.quantityDelta),
    result: row.quantityAfter === null ? '' : interpolate(a.now, { n: row.quantityAfter }),
    tone: row.quantityDelta >= 0 ? 'up' : 'down',
  };
}

// ── Badge (only when something is not normal) ────────────────────────

export type MovementBadgeTone = 'error' | 'warning' | 'info';

/** Guide entry ids a badge or a panel link can jump to. */
export type StockGuideId =
  | 'numbers.amount'
  | 'numbers.onHand'
  | 'numbers.reserved'
  | 'numbers.available'
  | 'numbers.startingCount'
  | 'states.refused'
  | 'states.inDoubt'
  | 'states.pending'
  | 'kinds.sale'
  | 'kinds.cancellation'
  | 'kinds.return'
  | 'kinds.correction'
  | 'kinds.shopChange'
  | 'kinds.hold';

export interface MovementBadge {
  label: string;
  tone: MovementBadgeTone;
  guideId: StockGuideId;
}

/**
 * An applied change and a hold need no badge: the sentence already says what
 * happened. A badge appears only for the three states that ask for a look.
 */
export function movementBadge(row: InventoryMovementRow, copy: StockHistoryCopy): MovementBadge | null {
  if (row.kind !== 'movement') return null;
  if (row.status === 'refused') return { label: copy.badges.refused, tone: 'error', guideId: 'states.refused' };
  if (row.status === 'in_doubt') return { label: copy.badges.inDoubt, tone: 'warning', guideId: 'states.inDoubt' };
  if (row.status === 'pending') return { label: copy.badges.pending, tone: 'info', guideId: 'states.pending' };
  return null;
}

/** The guide entry that best explains a row: its state when abnormal, else its kind. */
export function guideIdFor(row: InventoryMovementRow, copy: StockHistoryCopy): StockGuideId {
  const badge = movementBadge(row, copy);
  if (badge) return badge.guideId;
  if (row.kind === 'reservation') return 'kinds.hold';
  switch (row.reason) {
    case 'sale':
      return 'kinds.sale';
    case 'cancellation_restore':
      return 'kinds.cancellation';
    case 'return_restock':
      return 'kinds.return';
    case 'manual_correction':
      return 'kinds.correction';
    default:
      return row.quantityBefore === null ? 'numbers.startingCount' : 'kinds.shopChange';
  }
}

// ── One sentence per row ─────────────────────────────────────────────

function refOf(row: InventoryMovementRow, copy: StockHistoryCopy): string {
  return row.sourceLabel ?? row.sourceRef ?? copy.sentences.unknownRef;
}

/** The line under the product name: what happened and who caused it. */
export function describeMovement(row: InventoryMovementRow, ctx: StockHistoryContext): string {
  const s = ctx.copy.sentences;
  const ref = refOf(row, ctx.copy);
  if (row.kind === 'reservation') {
    if (row.status === 'held') return interpolate(s.held, { ref });
    if (row.status === 'consumed') return interpolate(s.consumed, { ref });
    if (row.status === 'expired') return interpolate(s.expired, { ref });
    return interpolate(s.released, { ref });
  }
  switch (row.reason) {
    case 'sale':
      return interpolate(s.sale, { ref });
    case 'cancellation_restore':
      return interpolate(s.cancellationRestore, { ref });
    case 'return_restock':
      return interpolate(s.returnRestock, { ref });
    case 'manual_correction': {
      const who = row.actorName ?? s.someone;
      const why = operatorReasonText(row);
      return why ? interpolate(s.correctedByWhy, { who, why }) : interpolate(s.correctedBy, { who });
    }
    default: {
      const master = ctx.masterName(row);
      return row.quantityBefore === null
        ? interpolate(s.firstCount, { master })
        : interpolate(s.shopChange, { master });
    }
  }
}

// ── Grouping one event seen on several products ──────────────────────

export interface MovementGroup {
  key: string;
  rows: InventoryMovementRow[];
}

function localMinute(iso: string): string {
  const d = new Date(iso);
  return `${localDayKey(d)}T${d.getHours()}:${d.getMinutes()}`;
}

/**
 * Rows that are the same EVENT on several products. An order groups by its
 * reference. A sync run groups by the run id the ledger records (#4062); a
 * row written before that id existed falls back to connection and minute,
 * which can split a run across a minute boundary. Only applied rows group: a
 * refused or unconfirmed row always stands on its own, so it is never hidden.
 */
export function groupKey(row: InventoryMovementRow): string {
  if (row.kind === 'reservation' && row.sourceRef) return `hold:${row.sourceRef}:${row.status}`;
  if (row.kind === 'movement' && row.status === 'applied') {
    if (row.reason === 'sale' && row.sourceRef) return `sale:${row.sourceRef}`;
    if (row.reason === 'master_sync') {
      const run = row.quantityBefore === null ? 'first' : 'sync';
      if (row.syncRunId) return `${run}:run:${row.syncRunId}`;
      return `${run}:${row.sourceConnectionId ?? '-'}:${localMinute(row.occurredAt)}`;
    }
  }
  return `row:${row.id}`;
}

/** Groups only ADJACENT rows, so the list keeps the order the API returned. */
export function groupMovements(rows: readonly InventoryMovementRow[]): MovementGroup[] {
  const groups: MovementGroup[] = [];
  for (const row of rows) {
    const key = groupKey(row);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.rows.push(row);
    else groups.push({ key: groups.some((g) => g.key === key) ? `${key}#${row.id}` : key, rows: [row] });
  }
  return groups;
}

export interface GroupView {
  title: string;
  amount: AmountView;
}

/** The collapsed line for a group of two or more rows. */
export function describeGroup(group: MovementGroup, ctx: StockHistoryContext): GroupView {
  const { copy, plural } = ctx;
  const first = group.rows[0];
  const n = group.rows.length;
  const ref = refOf(first, copy);
  const amounts = group.rows.map((r) => presentAmount(r, copy));
  const same = amounts.every((a) => a.change === amounts[0].change);

  if (first.kind === 'reservation') {
    const forms = first.status === 'held' ? copy.groups.holds : copy.groups.released;
    return {
      title: plural(n, forms, { ref }),
      amount: { change: same ? amounts[0].change : '', result: same ? copy.amount.each : amounts[0].result, tone: 'reserve' },
    };
  }
  if (first.reason === 'sale') {
    return {
      title: plural(n, copy.groups.sale, { ref }),
      amount: { change: same ? amounts[0].change : '', result: same ? copy.amount.each : '', tone: 'down' },
    };
  }
  const master = ctx.masterName(first);
  if (first.quantityBefore === null) {
    const counts = group.rows.map((r) => r.quantityAfter ?? 0);
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    return {
      title: plural(n, copy.groups.firstCount, { master }),
      amount: {
        change: min === max ? String(min) : interpolate(copy.amount.range, { min, max }),
        result: copy.amount.startingCounts,
        tone: 'up',
      },
    };
  }
  const allDown = group.rows.every((r) => r.quantityDelta < 0);
  return {
    title: plural(n, copy.groups.sync, { master }),
    amount: {
      change: same ? amounts[0].change : '',
      result: same ? copy.amount.each : '',
      tone: allDown ? 'down' : 'up',
    },
  };
}

// ── Days ─────────────────────────────────────────────────────────────

/** A local calendar day key, so a change at 23:30 lands on the day the operator lived it. */
export function localDayKey(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
}

export interface MovementDay {
  key: string;
  label: string;
  groups: MovementGroup[];
}

export function bucketByDay(
  groups: readonly MovementGroup[],
  now: Date,
  copy: StockHistoryCopy,
  formatDate: (iso: string) => string,
): MovementDay[] {
  const today = localDayKey(now);
  const yesterday = localDayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const days: MovementDay[] = [];
  for (const group of groups) {
    const iso = group.rows[0].occurredAt;
    const key = localDayKey(new Date(iso));
    const date = formatDate(iso);
    const label =
      key === today
        ? interpolate(copy.day.today, { date })
        : key === yesterday
          ? interpolate(copy.day.yesterday, { date })
          : date;
    const last = days[days.length - 1];
    if (last && last.key === key) last.groups.push(group);
    else days.push({ key, label, groups: [group] });
  }
  return days;
}

// ── The detail panel's explanation ───────────────────────────────────

export interface LedgerLine {
  label: string;
  value: string;
  /** The result line, drawn above a rule. */
  total?: boolean;
}

export interface Explanation {
  title: string;
  body: string;
  lines: LedgerLine[];
  footnote: string;
  /** True for a state the operator should act on: the body is shown as a warning. */
  attention: boolean;
}

export function explainMovement(
  row: InventoryMovementRow,
  ctx: StockHistoryContext,
  formatTime: (iso: string) => string,
): Explanation {
  const { copy, plural } = ctx;
  const e = copy.explain;
  const l = copy.detail.ledger;
  const f = copy.detail.footnotes;
  const master = ctx.masterName(row);
  const time = formatTime(row.occurredAt);
  const ref = refOf(row, copy);
  const units = plural(Math.abs(row.quantityDelta), e.units);

  if (row.kind === 'reservation') {
    const held = row.status === 'held';
    return {
      title: interpolate(held ? e.titles.held : e.titles.releasedHold, { units, ref }),
      body: held ? e.bodies.held : e.bodies.releasedHold,
      lines: [
        { label: l.onHand, value: l.unchanged },
        { label: l.reserved, value: signed(holdChange(row)), total: true },
      ],
      footnote: interpolate(f.recordedHold, { time }),
      attention: false,
    };
  }

  if (row.status === 'refused') {
    return {
      title: e.titles.refused,
      body:
        presentRefusalText(row.refusalReason, row.refusalDetail, master) ??
        interpolate(e.bodies.refusedFallback, { master }),
      lines: [
        { label: l.requested, value: signed(row.quantityDelta) },
        { label: l.applied, value: '0', total: true },
      ],
      footnote: interpolate(f.refusedBy, { master, time }),
      attention: true,
    };
  }

  if (row.status === 'in_doubt') {
    return {
      title: e.titles.inDoubt,
      body: interpolate(e.bodies.inDoubt, { master }),
      lines: [
        { label: l.requested, value: signed(row.quantityDelta) },
        { label: l.confirmed, value: l.noAnswer, total: true },
      ],
      footnote: interpolate(f.sentAt, { time }),
      attention: true,
    };
  }

  if (row.status === 'pending') {
    return {
      title: interpolate(e.titles.pending, { master }),
      body: e.bodies.pending,
      lines: [{ label: l.requested, value: signed(row.quantityDelta), total: true }],
      footnote: interpolate(f.sentAt, { time }),
      attention: false,
    };
  }

  const before = row.quantityBefore;
  const after = row.quantityAfter === null ? '?' : String(row.quantityAfter);
  const confirmed = interpolate(f.confirmedBy, { master, time });
  if (before === null) {
    return {
      title: interpolate(e.titles.firstCount, { after }),
      body: interpolate(e.bodies.firstCount, { master }),
      lines: [
        { label: l.before, value: l.notTracked },
        { label: l.onHand, value: after, total: true },
      ],
      footnote: interpolate(f.readFrom, { master, time }),
      attention: false,
    };
  }

  const lines: LedgerLine[] = [
    { label: l.before, value: String(before) },
    { label: l.change, value: signed(row.quantityDelta) },
    { label: l.after, value: after, total: true },
  ];
  switch (row.reason) {
    case 'sale':
      return {
        title: interpolate(e.titles.sale, { ref, units }),
        body: interpolate(e.bodies.sale, { master }),
        lines,
        footnote: confirmed,
        attention: false,
      };
    case 'cancellation_restore':
      return {
        title: interpolate(e.titles.cancellationRestore, { ref, units }),
        body: interpolate(e.bodies.cancellationRestore, { master }),
        lines,
        footnote: confirmed,
        attention: false,
      };
    case 'return_restock':
      return {
        title: interpolate(e.titles.returnRestock, { ref, units }),
        body: interpolate(e.bodies.returnRestock, { master }),
        lines,
        footnote: confirmed,
        attention: false,
      };
    case 'manual_correction':
      return {
        title: interpolate(row.quantityDelta >= 0 ? e.titles.manualAdded : e.titles.manualRemoved, {
          who: row.actorName ?? copy.sentences.someone,
          units,
        }),
        body: interpolate(e.bodies.manualCorrection, { master }),
        lines,
        footnote: confirmed,
        attention: false,
      };
    default:
      return {
        title: interpolate(e.titles.shopChange, { before, after }),
        body: interpolate(e.bodies.shopChange, { master, before, after }),
        lines,
        footnote: interpolate(f.readFrom, { master, time }),
        attention: false,
      };
  }
}

/** Rows on the current page that ask the operator to act. */
export function countNeedingAttention(rows: readonly InventoryMovementRow[]): number {
  return rows.filter(movementNeedsAttention).length;
}
