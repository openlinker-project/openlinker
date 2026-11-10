/**
 * Refused Number Inheritance Rule (#3960)
 *
 * When an operator retries a refused invoice, the next attempt MAY take over the
 * refused attempt's document number instead of allocating a fresh one, so the
 * refused number is not left as a gap. This file decides WHEN it may.
 *
 * The rule: only when the number provably never left OpenLinker. A number the
 * provider (or a relay in front of it) has seen may be recorded there - on a
 * document it holds in an error state, in its own books, or against a
 * duplicate-number check - and sending it again on a second document can then
 * be refused as a duplicate, or worse, put one number on two documents. A gap,
 * by contrast, is a known and audited state (the gap audit reports it, and an
 * operator can note why). So when in doubt the number is NOT inherited and the
 * gap is accepted: a gap is recoverable, a duplicate document number is not.
 *
 * `failureMode: 'rejected'` alone does not prove it. It promises only that the
 * provider created no VALID document; some adapters reach it after the provider
 * accepted the request and reported a terminal error later (a relay whose
 * status poll answers "error"), by which time the number was on the wire. So
 * the decision rests on the failure CODE instead, and only codes whose
 * definition (see `InvoiceFailureCode`) is "raised by the adapter BEFORE the
 * provider was contacted" qualify. Those are DECLARED by the adapter via
 * `failureCause`, never inferred from message text, which is what makes them
 * evidence rather than a guess.
 *
 * Deliberately excluded, with the reason:
 *   - `provider-rejected`: also used for refusals the provider answered, after
 *     it saw the number. The adapter does not say which, so it is not proof.
 *   - `connection-setting-rejected`, `buyer-tax-id-invalid`, `invalid-currency`,
 *     `sale-classification-required`: by definition the provider WAS contacted.
 *   - every `in-doubt` code: the document may exist.
 *
 * A pure rule beside its type (engineering-standards.md, the `*.types.ts`
 * pure-rule exception): the repository that moves the number applies it under
 * the predecessor's row lock, and the unit tests pin it.
 *
 * @module libs/core/src/invoicing/domain/types
 */
import type { InvoiceFailureCode, InvoiceFailureMode, InvoiceStatus } from './invoicing.types';

/**
 * Failure codes that, by their definition, are raised by the adapter BEFORE the
 * provider is contacted - so the document number it carried never left
 * OpenLinker. Adding a code here is a fiscal decision: it must be one whose
 * every producer refuses before anything is sent.
 */
export const NUMBER_NEVER_SENT_FAILURE_CODES: readonly InvoiceFailureCode[] = [
  'connection-setup-incomplete',
  'acknowledgement-required',
];

/**
 * May the attempt that follows `refused` take over its document number?
 *
 * True only for a terminal refusal (`failed` + `rejected`) whose failure code
 * proves the number never reached the provider. Anything else answers `false`,
 * and the caller allocates a fresh number, leaving the refused one as an
 * audited gap.
 */
export function canInheritRefusedDocumentNumber(refused: {
  status: InvoiceStatus;
  failureMode: InvoiceFailureMode | null;
  failureCode: InvoiceFailureCode | null;
}): boolean {
  return (
    refused.status === 'failed' &&
    refused.failureMode === 'rejected' &&
    refused.failureCode !== null &&
    NUMBER_NEVER_SENT_FAILURE_CODES.includes(refused.failureCode)
  );
}
