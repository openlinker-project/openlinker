/**
 * `OrderInvoicingCell` unit tests (#2100).
 *
 * The component's contract is a truth table — three independent parts over
 * {invoice shape} × {block reason} × {invoicing capability} — and driving it
 * through `OrdersListPage` costs a mock API client, a paginated fixture and a
 * viewport mock per case, so the sparse cells went untested. That is how the
 * round-4 defect survived: the page tests covered the common rows, and the
 * combination that mattered (a terminal rejected failure beside a live block)
 * was in a cell nothing exercised.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { OrderInvoicingCell } from './order-invoicing-cell';
import type { ParsedOrderInvoice } from '../api/order-snapshot.schema';

function invoice(over: Partial<ParsedOrderInvoice> = {}): ParsedOrderInvoice {
  return {
    invoiceId: 'inv-1',
    status: 'issued',
    regulatoryStatus: 'accepted',
    blocksIssuanceElsewhere: true,
    ...over,
  };
}

/** A terminal rejection: the provider is known to have created nothing. */
const rejected = invoice({
  status: 'failed',
  regulatoryStatus: 'not-applicable',
  blocksIssuanceElsewhere: false,
});

function renderCell(props: Partial<Parameters<typeof OrderInvoicingCell>[0]> = {}) {
  return render(
    <MemoryRouter>
      <OrderInvoicingCell
        internalOrderId="ol_order_1"
        invoice={null}
        blockReason={null}
        unresolvedReason={null}
        hasInvoicingCapability
        layout="stack"
        emptyFallback={<span>{'—'}</span>}
        {...props}
      />
    </MemoryRouter>,
  );
}

const cta = () => screen.queryByRole('link', { name: /issue invoice/i });

describe('OrderInvoicingCell (#2100)', () => {
  describe('no invoice', () => {
    it('offers the CTA when nothing blocks and a connection can issue', () => {
      renderCell();
      expect(cta()).toBeInTheDocument();
    });

    it('falls back to the em dash with no invoicing capability', () => {
      renderCell({ hasInvoicingCapability: false });
      expect(cta()).toBeNull();
      expect(screen.getByText('—')).toBeInTheDocument();
    });

    it('replaces the CTA with the badge for a blocking reason', () => {
      renderCell({ blockReason: 'missing-tax-rate' });
      expect(screen.getByText('Tax rate missing')).toBeInTheDocument();
      expect(cta()).toBeNull();
    });

    it('keeps the CTA on a batched connection, because nothing else will issue it', () => {
      // Batched issuing is not implemented, so no run will ever collect this
      // order; removing the manual route would strand it (#2534).
      renderCell({ blockReason: 'trigger-model-batched' });
      expect(screen.getByText('Batched')).toBeInTheDocument();
      expect(cta()).toBeInTheDocument();
    });

    it('keeps the CTA beside a manual-only badge — the click IS the workflow', () => {
      renderCell({ blockReason: 'trigger-model-manual' });
      expect(screen.getByText('Issued on request')).toBeInTheDocument();
      expect(cta()).toBeInTheDocument();
    });

    it('drops the manual CTA when no connection can issue', () => {
      renderCell({ blockReason: 'trigger-model-manual', hasInvoicingCapability: false });
      expect(screen.getByText('Issued on request')).toBeInTheDocument();
      expect(cta()).toBeNull();
    });

    it('offers the CTA for a reason this build does not recognise', () => {
      // The aggregate's `IN (…)` cannot match it either, so the two agree: an
      // unknown reason is neither counted nor rendered as a blocked row.
      renderCell({ blockReason: 'from-a-future-build' as never });
      expect(cta()).toBeInTheDocument();
    });
  });

  describe('with an invoice', () => {
    it('shows the pill and never the CTA — the next step is Retry in the panel', () => {
      renderCell({ invoice: invoice() });
      expect(screen.getByText('Cleared')).toBeInTheDocument();
      expect(cta()).toBeNull();
    });

    it('hides the block badge behind a document that plausibly exists', () => {
      renderCell({ invoice: invoice(), blockReason: 'trigger-model-batched' });
      expect(screen.queryByText('Batched')).toBeNull();
    });

    it('hides the block badge behind an in-doubt failure', () => {
      // `in-doubt` means OL does not know whether a document exists, so the gate
      // reports `none` and this surface must not claim otherwise.
      renderCell({
        invoice: invoice({
          status: 'failed',
          regulatoryStatus: 'not-applicable',
          blocksIssuanceElsewhere: true,
        }),
        blockReason: 'unresolved-routing',
        unresolvedReason: 'ambiguous-connection-no-primary',
      });
      expect(screen.queryByText('Two setups apply')).toBeNull();
    });

    it('shows the badge BESIDE the pill for a terminal rejected failure', () => {
      // The one cell the ternary made unreachable, and the one the backend gate,
      // the aggregate count and the filter all keep blocked.
      renderCell({
        invoice: rejected,
        blockReason: 'unresolved-routing',
        unresolvedReason: 'ambiguous-connection-no-primary',
      });
      expect(screen.getByText('Failed')).toBeInTheDocument();
      expect(screen.getByText('Two setups apply')).toBeInTheDocument();
      expect(cta()).toBeNull();
    });

    it('does not resurrect the CTA for a rejected failure on a manual connection', () => {
      renderCell({ invoice: rejected, blockReason: 'trigger-model-manual' });
      expect(screen.getByText('Issued on request')).toBeInTheDocument();
      expect(cta()).toBeNull();
    });

    it('carries the reason in an aria-label, not colour alone', () => {
      renderCell({
        invoice: rejected,
        blockReason: 'unresolved-routing',
        unresolvedReason: 'ambiguous-connection-no-primary',
      });
      expect(
        screen.getByLabelText(/Two setups apply: More than one setup could issue/i),
      ).toBeInTheDocument();
    });
  });

  describe('layout', () => {
    it('wraps in a row for the mobile card so a <dd> gets one child', () => {
      const { container } = renderCell({ blockReason: 'trigger-model-manual', layout: 'row' });
      const row = container.querySelector('.ds-row');
      expect(row).not.toBeNull();
      expect(row?.querySelector('.orders-row-cta')).not.toBeNull();
    });

    it('emits the parts unwrapped for the desktop stack', () => {
      const { container } = renderCell({ blockReason: 'trigger-model-manual', layout: 'stack' });
      expect(container.querySelector('.ds-row')).toBeNull();
    });
  });
});
