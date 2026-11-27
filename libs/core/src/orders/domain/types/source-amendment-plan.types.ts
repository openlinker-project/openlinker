/**
 * Source Amendment Plan (#3961)
 *
 * What to do when the order source reports a line quantity that no longer
 * matches the packing work of an already-routed order. Pure: every input is a
 * plain value, so the whole decision table is unit-testable without a
 * repository, and the service that acts on it holds no rule of its own.
 *
 * ## Level-triggered, not diff-triggered
 *
 * The planner compares the order's EFFECTIVE quantity per line with what the
 * work still REQUIRES. It never reads the one-shot amendment diff for a
 * decrease: that diff is overwritten by the next ingestion, so a follow-up that
 * failed once would otherwise never be retried. Comparing state means any later
 * ingestion of the same order finishes the job, and an ingestion of an order
 * that already agrees with its work plans nothing.
 *
 * ## Why an increase DOES read the diff
 *
 * "The order wants more than the work carries" is also what a line routing
 * marked unfulfillable looks like: it was never put into any work. Treating
 * every such line as an increase would hold every order with a refused line,
 * forever. So an increase only counts for a line the stored amendment says went
 * up or was added.
 *
 * ## The stage decides
 *
 * Before packing, a decrease is applied (the bench simply asks for fewer).
 * Once the box holds more units than the new quantity, once the box is closed,
 * once an outside holder has the work, or when units would have to be ADDED,
 * OpenLinker holds the box and asks a person. After shipping nothing can be
 * changed, so the change is only reported. This mirrors the gates of the
 * operator edit (#3542), which refuses in exactly those states.
 *
 * Pure, and living beside the types it is the rule for - the pure-rule
 * exception in `engineering-standards.md`.
 *
 * @module libs/core/src/orders/domain/types
 */

/** Why a change could not be applied on its own. Rendered by the frontend as copy. */
export const SourceChangeHoldCauseValues = [
  /** The packer already verified more units into the box than the new quantity. */
  'box-holds-more',
  /** The box was closed (or the order marked packed) before the change arrived. */
  'box-closed',
  /** A holder outside OpenLinker has the work; narrowing OL's row would not reach it. */
  'packed-elsewhere',
  /** The executor already reported more units fulfilled than the new quantity. */
  'already-fulfilled',
  /** The change adds units or a line; OpenLinker never adds to packing work on its own. */
  'units-added',
] as const;

export type SourceChangeHoldCause = (typeof SourceChangeHoldCauseValues)[number];

/** Narrow an untrusted string (a persisted attention detail) to the union. */
export function isSourceChangeHoldCause(value: unknown): value is SourceChangeHoldCause {
  return typeof value === 'string' && (SourceChangeHoldCauseValues as readonly string[]).includes(value);
}

/** One line whose order quantity differs from its work. */
export interface SourceAmendmentLine {
  readonly orderLineId: string;
  /** Units the packing work requires today. */
  readonly from: number;
  /** Units the order now asks for. */
  readonly to: number;
}

export interface SourceAmendmentPlanInput {
  /** Effective quantity per order line (operator overlay applied). A line absent here is `0`. */
  readonly effectiveByLine: Readonly<Record<string, number>>;
  /** Units each line still requires across non-terminal works. Absent means no live work carries it. */
  readonly requiredByLine: Readonly<Record<string, number>>;
  readonly verifiedByLine: Readonly<Record<string, number>>;
  readonly fulfilledByLine: Readonly<Record<string, number>>;
  /** Lines the stored amendment reports as raised or added. Only these can be an increase. */
  readonly increasedLineIds: ReadonlySet<string>;
  /** The order has no work at all. */
  readonly unrouted: boolean;
  readonly boxClosed: boolean;
  readonly shipped: boolean;
  readonly outsideHolder: boolean;
}

export type SourceAmendmentPlan =
  | { readonly kind: 'no-work' }
  | { readonly kind: 'in-sync' }
  | { readonly kind: 'apply'; readonly lines: readonly SourceAmendmentLine[] }
  | {
      readonly kind: 'hold';
      readonly cause: SourceChangeHoldCause;
      readonly lines: readonly SourceAmendmentLine[];
    }
  | { readonly kind: 'shipped'; readonly lines: readonly SourceAmendmentLine[] };

export function planSourceAmendment(input: SourceAmendmentPlanInput): SourceAmendmentPlan {
  if (input.unrouted) return { kind: 'no-work' };

  const decreases: SourceAmendmentLine[] = [];
  for (const [orderLineId, required] of Object.entries(input.requiredByLine)) {
    const effective = input.effectiveByLine[orderLineId] ?? 0;
    if (effective < required) decreases.push({ orderLineId, from: required, to: effective });
  }
  const increases: SourceAmendmentLine[] = [];
  for (const orderLineId of input.increasedLineIds) {
    const effective = input.effectiveByLine[orderLineId] ?? 0;
    const required = input.requiredByLine[orderLineId] ?? 0;
    if (effective > required) increases.push({ orderLineId, from: required, to: effective });
  }

  const lines = [...decreases, ...increases].sort((a, b) => a.orderLineId.localeCompare(b.orderLineId));
  if (lines.length === 0) return { kind: 'in-sync' };
  if (input.shipped) return { kind: 'shipped', lines };

  const cause = holdCause(input, decreases, increases);
  return cause === null ? { kind: 'apply', lines: decreases } : { kind: 'hold', cause, lines };
}

/** The first reason, in the order an operator would want it named, that a person must decide. */
function holdCause(
  input: SourceAmendmentPlanInput,
  decreases: readonly SourceAmendmentLine[],
  increases: readonly SourceAmendmentLine[]
): SourceChangeHoldCause | null {
  if (input.boxClosed) return 'box-closed';
  if (input.outsideHolder) return 'packed-elsewhere';
  if (decreases.some((line) => (input.fulfilledByLine[line.orderLineId] ?? 0) > line.to)) {
    return 'already-fulfilled';
  }
  if (decreases.some((line) => (input.verifiedByLine[line.orderLineId] ?? 0) > line.to)) {
    return 'box-holds-more';
  }
  if (increases.length > 0) return 'units-added';
  return null;
}

/**
 * `targetRef` of an operator's acceptance of one mismatch (#3961).
 *
 * Keyed on the exact lines and quantities, so accepting "2 -> 1" does not also
 * accept a later "2 -> 0": a new change from the source is a new mismatch and is
 * raised again. Line order is normalised so the same mismatch always yields the
 * same key.
 */
export function sourceChangeAcceptTargetRef(lines: readonly SourceAmendmentLine[]): string {
  const fingerprint = [...lines]
    .sort((a, b) => a.orderLineId.localeCompare(b.orderLineId))
    .map((line) => `${line.orderLineId}:${String(line.from)}>${String(line.to)}`)
    .join(',');
  return `source-change:${fingerprint}`;
}
