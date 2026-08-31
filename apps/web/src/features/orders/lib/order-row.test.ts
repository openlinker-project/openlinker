/**
 * order-row view-model helper tests (#1713).
 */
import { describe, expect, it } from 'vitest';
import type { ParsedOrderInvoice } from '../api/order-snapshot.schema';
import { paymentBadge, invoiceBadge, invoicingBlockedBadge } from './order-row';
import { SalesDocumentGateBlockReasonValues } from '../api/orders.types';
import type { SalesDocumentGateBlockReasonValue } from '../api/orders.types';

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

describe('invoicingBlockedBadge (#2100)', () => {
  const invoice = (blocksIssuanceElsewhere?: boolean): ParsedOrderInvoice => ({
    invoiceId: 'inv-1',
    status: 'failed',
    regulatoryStatus: 'not-applicable',
    ...(blocksIssuanceElsewhere === undefined ? {} : { blocksIssuanceElsewhere }),
  });

  it('suppresses the badge when a document plausibly exists', () => {
    expect(invoicingBlockedBadge('unresolved-routing', undefined, invoice(true))).toBeNull();
  });

  it('keeps the badge behind a terminal rejected failure', () => {
    // The backend gate applies the identical predicate, so it PERSISTS a block
    // here — and the aggregate count has no invoice awareness. Suppressing on the
    // FE would leave a counted, filterable block that no surface explains.
    expect(invoicingBlockedBadge('unresolved-routing', undefined, invoice(false))).toEqual(
      expect.objectContaining({ label: 'No routing' }),
    );
  });

  it('treats a pre-#2100 snapshot without the field as superseding', () => {
    expect(invoicingBlockedBadge('unresolved-routing', undefined, invoice())).toBeNull();
  });

  it('returns null for an unblocked order', () => {
    expect(invoicingBlockedBadge(null)).toBeNull();
    expect(invoicingBlockedBadge(undefined)).toBeNull();
  });

  it('keys on the routing reason paired with the unresolved-routing bridge value', () => {
    const badge = invoicingBlockedBadge('unresolved-routing', 'ambiguous-connection-no-primary');
    // "Routing was unresolved" is not actionable; "two setups apply" is.
    expect(badge).toMatchObject({
      label: 'Two setups apply',
      tone: 'error',
      keepIssueAction: false,
    });
  });

  it('labels every routing reason from the shared copy map', () => {
    // #2534 - before the shared map only `ambiguous-connection-no-primary` had
    // words of its own; every other routing reason collapsed into one generic
    // label that told the operator nothing about their own configuration.
    expect(invoicingBlockedBadge('unresolved-routing', 'no-matching-rule')).toMatchObject({
      label: 'No rule matched',
      tone: 'error',
    });
    expect(invoicingBlockedBadge('unresolved-routing', 'net-priced-order')).toMatchObject({
      label: 'Order is net-priced',
    });
  });

  it('falls back to the generic routing label when no routing reason travelled along', () => {
    expect(invoicingBlockedBadge('unresolved-routing')).toMatchObject({
      label: 'No routing',
      tone: 'error',
    });
  });

  it('renders manual quietly and keeps the Issue invoice action', () => {
    const badge = invoicingBlockedBadge('trigger-model-manual');
    // A deliberate operator setting must not read as a fault, and issuing by hand
    // IS the configured workflow here — so the CTA stays.
    expect(badge).toMatchObject({
      label: 'Issued on request',
      tone: 'neutral',
      keepIssueAction: true,
    });
  });

  it('warns on batched and keeps the action, because nothing collects the order otherwise', () => {
    expect(invoicingBlockedBadge('trigger-model-batched')).toMatchObject({
      label: 'Batched',
      tone: 'warning',
      keepIssueAction: true,
    });
  });

  it('carries copy for the declared-but-unwritten reasons so they render correctly the day they ship', () => {
    expect(invoicingBlockedBadge('missing-required-tax-id')?.label).toBe('No buyer tax ID');
    expect(invoicingBlockedBadge('tax-rate-conflict')?.label).toBe('Tax rate conflict');
  });

  it('returns null for an unrecognised value rather than an unlabelled pill', () => {
    // A newer backend value must degrade to "no badge", not to an empty chip.
    expect(
      invoicingBlockedBadge('some-future-reason' as SalesDocumentGateBlockReasonValue),
    ).toBeNull();
  });

  it('always supplies a hint for every badge it returns', () => {
    for (const reason of SalesDocumentGateBlockReasonValues) {
      const badge = invoicingBlockedBadge(reason, 'ambiguous-connection-no-primary');
      // The row shows the hint as its tooltip — a badge with no hint would be a
      // colour with no explanation, which is exactly what #2100 exists to fix.
      expect(badge?.hint.length).toBeGreaterThan(0);
    }
  });
});
