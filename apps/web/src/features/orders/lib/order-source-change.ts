/**
 * Source Change View Model (#3961)
 *
 * Turns an order record into what the "Changed in {channel}" card shows: the
 * line diff, what OpenLinker already did, what is left and which actions apply.
 * Pure, so every state is unit-testable without rendering.
 *
 * Two facts feed it and they answer different questions:
 *  - `lastAmendmentChanges` - WHAT the source changed (the most recent change);
 *  - the `source-amendment` attention entry - whether a person must still
 *    DECIDE. No entry plus a line change means OpenLinker applied it.
 *
 * @module apps/web/src/features/orders/lib
 */
import type { Messages } from '../../../shared/i18n';
import type { OrderAmendmentChange, OrderOmsAttentionEntry } from '../api/orders.types';

const PRODUCER = 'source-amendment';

export type SourceChangeStatus = 'applied' | 'decision' | 'shipped' | 'failed';

/** Whether a next step is done, waiting on someone, or just stated. */
export type SourceChangeMark = 'done' | 'todo' | 'none';

/** A key under `orders.sourceChange.effect` in the locale files. */
export type SourceChangeEffectKey = keyof Messages['orders']['sourceChange']['effect'];

/** A key under `orders.sourceChange.action` in the locale files. */
export type SourceChangeActionLabel = keyof Messages['orders']['sourceChange']['action'];

export interface SourceChangeEffect {
  readonly mark: SourceChangeMark;
  readonly key: SourceChangeEffectKey;
}

/**
 * What OpenLinker did and what is left, per state. The cause codes are the
 * backend's `SourceChangeHoldCause` plus the two it writes when nothing is held
 * (`shipped`, `apply-failed`). The sentences live in the locale files; this
 * table only orders them and marks each one.
 */
const EFFECTS: Readonly<Record<string, readonly SourceChangeEffect[]>> = {
  applied: [
    { mark: 'done', key: 'packingAsksNew' },
    { mark: 'done', key: 'stockFollows' },
  ],
  'box-holds-more': [
    { mark: 'todo', key: 'boxHoldsMore' },
    { mark: 'done', key: 'packerTold' },
    { mark: 'none', key: 'stockChangesWhenMatches' },
  ],
  'box-closed': [
    { mark: 'todo', key: 'boxClosedBefore' },
    { mark: 'done', key: 'packingOnHold' },
    { mark: 'none', key: 'stockUnchanged' },
  ],
  'packed-elsewhere': [
    { mark: 'todo', key: 'packedElsewhere' },
    { mark: 'done', key: 'packingOnHold' },
    { mark: 'none', key: 'tellWarehouse' },
  ],
  'already-fulfilled': [
    { mark: 'todo', key: 'alreadyPacked' },
    { mark: 'done', key: 'packingOnHold' },
    { mark: 'none', key: 'stockUnchanged' },
  ],
  'units-added': [
    { mark: 'todo', key: 'noAutoAdd' },
    { mark: 'done', key: 'packingOnHold' },
    { mark: 'none', key: 'stockUnchanged' },
  ],
  shipped: [
    { mark: 'none', key: 'parcelLeftOld' },
    { mark: 'todo', key: 'settleWithBuyer' },
  ],
  'apply-failed': [
    { mark: 'todo', key: 'couldNotUpdate' },
    { mark: 'none', key: 'triesAgain' },
  ],
};

/** An unknown cause falls back to the generic sentence rather than to nothing. */
const UNKNOWN_EFFECTS: readonly SourceChangeEffect[] = [{ mark: 'todo', key: 'noLongerMatches' }];

export interface SourceChangeLineView {
  readonly key: string;
  readonly name: string;
  /** Shown under the name only when it says something the name does not. */
  readonly sku: string | null;
  readonly from: number;
  readonly to: number;
}

export interface SourceChangeView {
  readonly status: SourceChangeStatus;
  readonly lines: readonly SourceChangeLineView[];
  readonly effects: readonly SourceChangeEffect[];
  /** The primary and secondary actions, in render order; empty when nothing is left to do. */
  readonly actions: ReadonlyArray<{ readonly action: 'recheck' | 'accept'; readonly label: SourceChangeActionLabel }>;
}

export interface DescribeSourceChangeInput {
  readonly lastAmendmentChanges: readonly OrderAmendmentChange[] | null | undefined;
  readonly omsAttention: readonly OrderOmsAttentionEntry[] | null | undefined;
  /** Item names by source line id, so a line reads by what the operator recognises. */
  readonly itemNames: Readonly<Record<string, string>>;
  /** The order has packing work. Without it a source change has nothing to apply to. */
  readonly hasPackingWork: boolean;
}

export function describeSourceChange(input: DescribeSourceChangeInput): SourceChangeView | null {
  const entry = (input.omsAttention ?? []).find((candidate) => candidate.producer === PRODUCER);
  const lines = lineChanges(input.lastAmendmentChanges ?? [], input.itemNames);

  if (entry === undefined) {
    if (lines.length === 0 || !input.hasPackingWork) return null;
    return { status: 'applied', lines, effects: effectsFor('applied'), actions: [] };
  }

  const cause = entry.detail ?? 'unknown';
  if (cause === 'shipped') {
    return {
      status: 'shipped',
      lines,
      effects: effectsFor('shipped'),
      actions: [{ action: 'accept', label: 'handled' }],
    };
  }
  if (cause === 'apply-failed') {
    return {
      status: 'failed',
      lines,
      effects: effectsFor('apply-failed'),
      actions: [{ action: 'recheck', label: 'retry' }],
    };
  }
  return {
    status: 'decision',
    lines,
    effects: effectsFor(cause),
    actions: [
      { action: 'recheck', label: 'recheck' },
      { action: 'accept', label: 'keep' },
    ],
  };
}

function effectsFor(cause: string): readonly SourceChangeEffect[] {
  return EFFECTS[cause] ?? UNKNOWN_EFFECTS;
}

function lineChanges(
  changes: readonly OrderAmendmentChange[],
  itemNames: Readonly<Record<string, string>>
): SourceChangeLineView[] {
  const out: SourceChangeLineView[] = [];
  changes.forEach((change, index) => {
    const name =
      (change.lineId !== undefined ? itemNames[change.lineId] : undefined) ??
      change.sku ??
      change.lineId ??
      '';
    const key = `${change.lineId ?? 'line'}:${String(index)}`;
    const sku = change.sku !== undefined && change.sku !== name ? change.sku : null;
    if (change.kind === 'line-quantity-changed') {
      out.push({ key, name, sku, from: change.fromQuantity ?? 0, to: change.toQuantity ?? 0 });
    } else if (change.kind === 'line-removed') {
      out.push({ key, name, sku, from: change.fromQuantity ?? 0, to: 0 });
    } else if (change.kind === 'line-added') {
      out.push({ key, name, sku, from: 0, to: change.toQuantity ?? 0 });
    }
  });
  return out;
}
