/**
 * Invoice Lifecycle Steps (#2558)
 *
 * Reduces an `InvoiceRecord` to the steps the shared `DocumentLifecycle`
 * primitive renders: one persisted state each, with the timestamp the record
 * actually carries. No step is invented for a stage the record does not
 * report — a correction is a separate linked document, not a step in this
 * document's own trail, so it is rendered elsewhere.
 *
 * @module apps/web/src/features/invoicing/lib
 */
import type { DocumentLifecycleStep } from '../../../shared/ui/document-lifecycle';
import type { InvoiceRecord } from '../api/invoicing.types';

export function resolveInvoiceLifecycleSteps(invoice: InvoiceRecord): DocumentLifecycleStep[] {
  const issuedStep: DocumentLifecycleStep = {
    id: 'issued',
    label: 'Issued',
    state: invoice.issuedAt ? 'done' : invoice.status === 'failed' ? 'error' : 'active',
    at: invoice.issuedAt,
  };

  // `not-applicable` means this regime clears nothing — there is no second
  // stage to walk (ADR-065), so the trail is one step long.
  if (invoice.regulatoryStatus === 'not-applicable') {
    return [issuedStep];
  }

  const clearanceStep: DocumentLifecycleStep = resolveClearanceStep(invoice);
  return [issuedStep, clearanceStep];
}

function resolveClearanceStep(invoice: InvoiceRecord): DocumentLifecycleStep {
  switch (invoice.regulatoryStatus) {
    case 'pending-submission':
      return { id: 'clearance', label: 'Awaiting the authority', state: 'todo', at: null };
    case 'submitted':
      return { id: 'clearance', label: 'Awaiting the authority', state: 'active', at: null };
    case 'cleared':
    case 'accepted':
      // No dedicated clearance timestamp is persisted — `updatedAt` is the
      // record's own last write, which for a terminal clearance state IS the
      // write that recorded it.
      return { id: 'clearance', label: 'Cleared', state: 'done', at: invoice.updatedAt };
    case 'rejected':
      return { id: 'clearance', label: 'Rejected by the authority', state: 'error', at: invoice.updatedAt };
    default:
      return { id: 'clearance', label: 'Awaiting the authority', state: 'todo', at: null };
  }
}
