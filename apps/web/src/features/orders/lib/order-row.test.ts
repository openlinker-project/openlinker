/**
 * order-row view-model helper tests (#1713).
 */
import { describe, expect, it } from 'vitest';
import type { ParsedOrderInvoice } from '../api/order-snapshot.schema';
import { paymentBadge, invoiceBadge } from './order-row';

// `itemsSummary`'s suite went with the helper in #2091: `OrderIdentityCell` owns
// the first-item + `+N` derivation for every list that renders an order
// identity, and its own spec covers the cases this block used to.

describe('paymentBadge', () => {
  it('returns null when the status is absent', () => {
    expect(paymentBadge(undefined)).toBeNull();
  });

  it('maps each payment status to a distinct label + tone', () => {
    expect(paymentBadge('paid')).toEqual({ label: 'Paid', tone: 'success' });
    expect(paymentBadge('cod')).toEqual({ label: 'COD', tone: 'review' });
    expect(paymentBadge('awaiting')).toEqual({ label: 'Awaiting', tone: 'warning' });
    expect(paymentBadge('refunded')).toEqual({ label: 'Refunded', tone: 'neutral' });
  });
});

describe('invoiceBadge', () => {
  const inv = (
    status: ParsedOrderInvoice['status'],
    regulatoryStatus: ParsedOrderInvoice['regulatoryStatus'],
  ): ParsedOrderInvoice => ({ invoiceId: 'inv-1', status, regulatoryStatus });

  it('reports a failed issue as an error', () => {
    expect(invoiceBadge(inv('failed', 'not-applicable'))).toEqual({ label: 'Failed', tone: 'error' });
  });

  it('reports pending/issuing as in-progress', () => {
    expect(invoiceBadge(inv('pending', 'not-applicable'))).toEqual({ label: 'Issuing', tone: 'warning' });
    expect(invoiceBadge(inv('issuing', 'not-applicable'))).toEqual({ label: 'Issuing', tone: 'warning' });
  });

  it('refines an issued invoice by its clearance lifecycle', () => {
    expect(invoiceBadge(inv('issued', 'not-applicable'))).toEqual({ label: 'Issued', tone: 'success' });
    expect(invoiceBadge(inv('issued', 'submitted'))).toEqual({ label: 'Submitted', tone: 'info' });
    expect(invoiceBadge(inv('issued', 'cleared'))).toEqual({ label: 'Cleared', tone: 'success' });
    expect(invoiceBadge(inv('issued', 'accepted'))).toEqual({ label: 'Cleared', tone: 'success' });
    expect(invoiceBadge(inv('issued', 'rejected'))).toEqual({ label: 'Rejected', tone: 'error' });
  });

  it('prefixes correction documents (corrected / credit-note) with "Correction · "', () => {
    expect(invoiceBadge({ ...inv('issued', 'accepted'), documentType: 'corrected' })).toEqual({
      label: 'Correction · Cleared',
      tone: 'success',
    });
    expect(invoiceBadge({ ...inv('issued', 'not-applicable'), documentType: 'credit-note' })).toEqual({
      label: 'Correction · Issued',
      tone: 'success',
    });
  });

  it('keeps the base label for a plain invoice or an unset document type', () => {
    expect(invoiceBadge({ ...inv('issued', 'accepted'), documentType: 'invoice' })).toEqual({
      label: 'Cleared',
      tone: 'success',
    });
    expect(invoiceBadge(inv('issued', 'accepted'))).toEqual({ label: 'Cleared', tone: 'success' });
  });
});
