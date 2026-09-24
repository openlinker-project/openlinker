/**
 * Who already knows an order went out with no sales document (#3340 follow-up)
 *
 * One question, asked by any surface that has to tell somebody an invoice is
 * not coming: **is this order on a list an operator will actually see, or is
 * the person reading this screen the only one who knows?**
 *
 * It exists because the pack bench answered it wrongly, in the reassuring
 * direction. It said, for every reason and for no reason at all:
 *
 * > This one is flagged for the office. It is already on their list of orders
 * > that went out without a document — you do not need to tell anyone.
 *
 * ## The list is real; membership of it is narrower than that copy implies
 *
 * The list is `/orders?invoicing=blocked` and the `salesDocumentBlocked` count
 * beside it. Both are built from core's `SalesDocumentAttentionReasonValues`,
 * which deliberately **excludes** `'trigger-model-manual'` — see
 * `libs/core/src/sales-documents/domain/types/sales-document-reason.types.ts`,
 * which explains why: a manual connection is a deliberate operator choice and
 * is `parseTriggerModel`'s default, so on a manual install EVERY uninvoiced
 * order carries that reason and counting them would put a red
 * "Invoicing blocked 4,312" on a perfectly healthy install.
 *
 * So the commonest reason in the product is on no list and matches no filter.
 * Neither does an order with no recorded reason at all, or one carrying a
 * reason this build does not recognise — a `WHERE reason IN (…)` cannot match
 * either.
 *
 * ## Why the wrong answer is worse than no answer
 *
 * A packer told that somebody already knows does not mention it. If nobody
 * does, nobody ever finds out. Silence would at least leave them free to ask.
 *
 * ## Derived, not hand-listed
 *
 * Built by filtering the mirrored values array exactly as core builds its own,
 * so a reason added to the union is on-the-list by default and opting one out
 * has to be a deliberate edit in both places. The array itself is held against
 * the backend union by `scripts/check-sales-document-reason-mirror.mjs`.
 *
 * @module apps/web/src/features/sales-documents/lib
 */
import {
  SalesDocumentGateBlockReasonValues,
  type SalesDocumentGateBlockReasonValue,
} from '../../orders';

export type InvoiceAbsenceAudience =
  /** An operator sees this order in the blocked count and under the filter. */
  | 'on-office-list'
  /** Nobody is told automatically — this connection issues when asked to. */
  | 'issued-on-request'
  /** Nothing recorded a reason, or one this build cannot place. No list holds it. */
  | 'nobody-told';

const OFFICE_LIST_REASONS: readonly string[] = SalesDocumentGateBlockReasonValues.filter(
  (reason): reason is SalesDocumentGateBlockReasonValue => reason !== 'trigger-model-manual'
);

export function resolveInvoiceAbsenceAudience(
  blockReason: SalesDocumentGateBlockReasonValue | string | null
): InvoiceAbsenceAudience {
  if (blockReason === 'trigger-model-manual') return 'issued-on-request';
  if (blockReason !== null && OFFICE_LIST_REASONS.includes(blockReason)) return 'on-office-list';
  return 'nobody-told';
}
