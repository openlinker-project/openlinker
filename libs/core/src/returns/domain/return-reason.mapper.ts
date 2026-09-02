/**
 * Return Reason Mapper
 *
 * The ONE narrow-or-fallback rule that turns an open-world reason string into
 * the closed `RefundReason` union (#2328, ADR-060).
 *
 * Pure: no I/O, no injected dependency, no framework import. It is the rule for
 * the vocabulary it sits with, so it lives beside the domain rather than inside
 * whichever caller happened to need it first.
 *
 * **There is deliberately only one copy.** Two callers narrow the same column
 * from opposite directions — `ReturnRepository` reading a stored `reason` back
 * out, and `ReturnsService` mapping a source's `reasonRaw` on the way in — and a
 * private copy per caller is how a context ends up with two spellings of one
 * rule. `#2330`'s adapter-side ingestion imports this too rather than adding a
 * third.
 *
 * The fallback is `'other'` rather than a throw because the input is genuinely
 * open-world: a marketplace may invent a reason word at any time, and refusing
 * the whole return over an unrecognised one would discard a real parcel heading
 * for a real building. The caller supplies the warning; this function stays
 * pure so it is callable from anywhere, including a repository read path where
 * logging is the caller's concern.
 *
 * @module libs/core/src/returns/domain
 */
import { RefundReasonValues } from '@openlinker/core/orders/types';
import type { RefundReason } from '@openlinker/core/orders/types';

/**
 * Narrow an arbitrary reason string onto `RefundReason`.
 *
 * Returns `null` for anything outside the union, so a caller can distinguish
 * "the source said something we do not recognise" (worth a warning) from "the
 * source said `other`" (perfectly ordinary). Callers that just want a value use
 * {@link toRefundReasonOrOther}.
 */
export function narrowRefundReason(rawReason: string | null | undefined): RefundReason | null {
  if (rawReason === null || rawReason === undefined) {
    return null;
  }
  return (RefundReasonValues as readonly string[]).includes(rawReason)
    ? (rawReason as RefundReason)
    : null;
}

/**
 * The total form: every input yields a `RefundReason`, unrecognised ones
 * yielding `'other'`. See the module docblock for why the fallback is not a
 * throw.
 */
export function toRefundReasonOrOther(rawReason: string | null | undefined): RefundReason {
  return narrowRefundReason(rawReason) ?? 'other';
}
