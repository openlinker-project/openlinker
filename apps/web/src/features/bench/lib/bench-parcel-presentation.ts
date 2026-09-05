/**
 * Pack-bench parcel presentation rules (#2418, `W3b-5`)
 *
 * Pure functions turning the parcel and document reads into what the surface
 * renders. No React, no I/O.
 *
 * ## Every server vocabulary degrades out loud, never silently
 *
 * `refusal`, a verification `reason` and a reopen `reason` all arrive as plain
 * strings, so a newer backend can hand this build a value it was not compiled
 * against. Each resolver below has an explicit unknown arm that says the bench
 * cannot explain what happened — never a blank, and never a cheerful default. A
 * packer told nothing is a packer who scans on.
 *
 * ## The interrupt fires on ONE condition (D4/D21)
 *
 * {@link hasBecomeUnpackable} is the whole rule, and it reads `refusal` alone —
 * the same field the list colours its rows from, and the field the API projects
 * from the same shared eligibility rule. Nothing about a buyer, a price or a
 * document can move it, which is what stops the interrupt going off for a change
 * the packer cannot act on.
 *
 * @module apps/web/src/features/bench/lib
 */
import {
  resolveSalesDocumentReasonCopy,
  type SalesDocumentGateReasonCopy,
} from '../../sales-documents';
import type { BenchParcel, BenchParcelLine } from '../api/bench-parcel.types';
import { benchParcelCopy } from './bench-parcel.copy';

/** How far one line has got. Never says HOW its units were confirmed. */
export type BenchLineState = 'verified' | 'in-progress' | 'not-started';

export function benchLineState(line: BenchParcelLine): BenchLineState {
  if (line.verifiedQuantity >= line.requiredQuantity) return 'verified';
  return line.verifiedQuantity > 0 ? 'in-progress' : 'not-started';
}

/** Units required across the whole box, and units verified into it. */
export function parcelTotals(parcel: BenchParcel): {
  readonly required: number;
  readonly verified: number;
} {
  return {
    required: parcel.lines.reduce((sum, line) => sum + line.requiredQuantity, 0),
    verified: parcel.lines.reduce((sum, line) => sum + line.verifiedQuantity, 0),
  };
}

/**
 * Which of two reads of one box is the newer? (#2421, story H2)
 *
 * The bench sends one request per physical gesture and a fast packer has
 * several in flight at once. Nothing orders the answers: the response recording
 * unit 1 can land AFTER the response recording unit 2, and a cache write that
 * takes whichever arrived last then shows `1 of 2` for a box the server holds
 * at `2 of 2`.
 *
 * That is H2's mirror image — a line displaying as LESS verified than the system
 * accepted — and under D18 it never surfaces, because the box closes on the
 * system's own count with no confirmation step in which the two are compared.
 * The packer sees a line still wanting a unit that is already in the box, scans
 * a third, and gets an over-pack refusal for a box that is simply finished.
 *
 * `version` is the API's own monotonic answer — the same field `reopen` sends
 * as `expectedVersion` — so the rule is a comparison rather than a guess.
 * Equal versions are accepted: a retry under one gesture id answers with the
 * identical parcel, and refusing it would leave a redundant but correct read
 * out for no gain.
 */
export function isNewerParcelRead(
  incoming: BenchParcel,
  cached: BenchParcel | undefined
): boolean {
  if (cached === undefined) return true;
  // A read of a DIFFERENT box is never comparable — versions are per work, so
  // comparing across them would drop a legitimate first read of the next
  // parcel whose version happens to be lower.
  if (cached.workId !== incoming.workId) return true;
  return incoming.version >= cached.version;
}

/** Is this box shut? The API's own answer, never inferred from the counts. */
export function isParcelClosed(parcel: BenchParcel): boolean {
  return parcel.closedAt !== null;
}

/**
 * D4/D21's trigger, and the only one.
 *
 * True when a box that could be packed can no longer be. It deliberately does
 * NOT fire on a box that was already refused when it opened — that is D2's
 * refusal screen, which the packer has already read, and interrupting them over
 * it would be an alarm about a fact they are looking at.
 */
export function hasBecomeUnpackable(
  previous: BenchParcel | undefined,
  next: BenchParcel
): boolean {
  if (next.refusal === null) return false;
  if (previous === undefined) return false;
  return previous.refusal === null;
}

/** D2's screen, and the interrupt's own headline, from one refusal vocabulary. */
export function describeParcelRefusal(refusal: string): {
  readonly title: string;
  readonly body: string;
  readonly interruptTitle: string;
} {
  const copy = benchParcelCopy;
  switch (refusal) {
    case 'held':
      return {
        title: copy.refusal.heldTitle,
        body: copy.refusal.heldBody,
        interruptTitle: copy.interrupt.heldTitle,
      };
    case 'cancelled':
      return {
        title: copy.refusal.cancelledTitle,
        body: copy.refusal.cancelledBody,
        interruptTitle: copy.interrupt.cancelledTitle,
      };
    default:
      // A refusal this build does not know is still a refusal. It stops the
      // packing and says so — the safe direction — rather than being read as
      // "no reason given, carry on".
      return {
        title: copy.refusal.unknownTitle,
        body: copy.refusal.unknownBody,
        interruptTitle: copy.interrupt.unknownTitle,
      };
  }
}

/**
 * Why the server turned a unit away.
 *
 * `over-packed` is the only arm that needs the line, because it is the only one
 * whose sentence quotes the numbers — E3 requires the packer to be told the
 * count did not move.
 */
export function describeVerificationRefusal(
  reason: string | null,
  line: BenchParcelLine | undefined
): string {
  const copy = benchParcelCopy.verify;
  switch (reason) {
    case 'over-packed':
      return copy.overPacked({
        required: line?.requiredQuantity ?? 0,
        kept: line?.verifiedQuantity ?? 0,
      });
    case 'not-packable':
      return copy.notPackable;
    case 'parcel-closed':
      return copy.parcelClosed;
    case 'no-such-line':
      return copy.noSuchLine;
    default:
      return copy.unknownRefusal;
  }
}

/** Why a reopen was turned down. `shipped` gets its own words — the box has gone. */
export function describeReopenRefusal(reason: string | null): string {
  const copy = benchParcelCopy.closed;
  switch (reason) {
    case 'shipped':
      return copy.reopenShipped;
    case 'not-closed':
      return copy.reopenNotClosed;
    default:
      return copy.reopenUnknownRefusal;
  }
}

/**
 * Why no invoice was issued, in the vocabulary the rest of the product uses.
 *
 * Delegates to `features/sales-documents`, which owns the one reason-to-copy map
 * guarded against the backend unions by
 * `scripts/check-sales-document-reason-mirror.mjs`. A second map here would be a
 * second answer to one question, and the guarded one would not be the one the
 * packer reads. `null` when nothing recorded a reason, or when this build does
 * not recognise the one recorded — the surface says so rather than rendering an
 * unlabelled gap.
 */
export function describeInvoiceBlock(
  blockReason: string | null,
  unresolvedReason: string | null
): SalesDocumentGateReasonCopy | null {
  return resolveSalesDocumentReasonCopy(
    blockReason as Parameters<typeof resolveSalesDocumentReasonCopy>[0],
    unresolvedReason as Parameters<typeof resolveSalesDocumentReasonCopy>[1]
  );
}
