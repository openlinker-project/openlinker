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
import type { OrderAmendmentChange, OrderOmsAttentionEntry } from '../api/orders.types';
import { SOURCE_CHANGE_COPY, type SourceChangeEffectCopy } from './order-source-change.copy';

const PRODUCER = 'source-amendment';

export type SourceChangeStatus = 'applied' | 'decision' | 'shipped' | 'failed';

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
  readonly effects: readonly SourceChangeEffectCopy[];
  /** The primary and secondary actions, in render order; empty when nothing is left to do. */
  readonly actions: ReadonlyArray<{ readonly action: 'recheck' | 'accept'; readonly label: string }>;
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
    return { status: 'applied', lines, effects: SOURCE_CHANGE_COPY.effects.applied, actions: [] };
  }

  const cause = entry.detail ?? 'unknown';
  if (cause === 'shipped') {
    return {
      status: 'shipped',
      lines,
      effects: SOURCE_CHANGE_COPY.effects.shipped,
      actions: [{ action: 'accept', label: SOURCE_CHANGE_COPY.actions.handled }],
    };
  }
  if (cause === 'apply-failed') {
    return {
      status: 'failed',
      lines,
      effects: SOURCE_CHANGE_COPY.effects['apply-failed'],
      actions: [{ action: 'recheck', label: SOURCE_CHANGE_COPY.actions.retry }],
    };
  }
  return {
    status: 'decision',
    lines,
    effects: effectsFor(cause),
    actions: [
      { action: 'recheck', label: SOURCE_CHANGE_COPY.actions.recheck },
      { action: 'accept', label: SOURCE_CHANGE_COPY.actions.keep },
    ],
  };
}

function effectsFor(cause: string): readonly SourceChangeEffectCopy[] {
  const table: Record<string, readonly SourceChangeEffectCopy[]> = SOURCE_CHANGE_COPY.effects;
  return table[cause] ?? SOURCE_CHANGE_COPY.effects.unknown;
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
