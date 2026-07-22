/**
 * InvoiceTimeline — component tests (#1240 A3)
 *
 * Verifies lane rendering, node states per invoice status, fiscal-safety node
 * labels (Accepted ≠ Cleared), and the clearance lane hide/show gate.
 */
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, it, expect } from 'vitest';
import { renderWithProviders } from '../../../test/test-utils';
import type { InvoiceRecord } from '../api/invoicing.types';
import { InvoiceTimeline } from './invoice-timeline';

afterEach(cleanup);

function makeInvoice(over: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id: 'inv_1',
    connectionId: 'conn_1',
    orderId: 'ord_1',
    providerType: 'subiekt',
    documentType: 'invoice',
    status: 'issued',
    providerInvoiceId: 'pi_1',
    providerInvoiceNumber: 'FV/2026/06/001',
    regulatoryStatus: 'not-applicable',
    clearanceReference: null,
    pdfUrl: null,
    failureMode: null,
    failureCode: null,
    failureReason: null,
    issuedAt: '2026-06-02T10:00:00.000Z',
    createdAt: '2026-06-02T09:00:00.000Z',
    updatedAt: '2026-06-02T10:00:00.000Z',
    ...over,
  };
}

describe('InvoiceTimeline — issuance lane', () => {
  it('null invoice ⇒ single Created (pending) node, no clearance lane', () => {
    renderWithProviders(<InvoiceTimeline invoice={null} />);
    expect(screen.getByText('Created')).toBeInTheDocument();
    expect(screen.queryByText(/regulatory clearance/i)).toBeNull();
  });

  it('issued ⇒ Created + Issued nodes, both done, no clearance lane', () => {
    renderWithProviders(<InvoiceTimeline invoice={makeInvoice()} />);
    expect(screen.getByText('Created')).toBeInTheDocument();
    expect(screen.getByText('Issued')).toBeInTheDocument();
    expect(screen.queryByText(/regulatory clearance/i)).toBeNull();
  });

  it('pending ⇒ Created (done) + Pending (active) nodes', () => {
    renderWithProviders(<InvoiceTimeline invoice={makeInvoice({ status: 'pending' })} />);
    const createdEl = screen.getByText('Created').closest('li');
    const pendingEl = screen.getByText('Pending').closest('li');
    expect(createdEl).toHaveClass('invoice-tl-node--done');
    expect(pendingEl).toHaveClass('invoice-tl-node--active');
  });

  it('issuing ⇒ Issuing node with locked state and hint', () => {
    renderWithProviders(<InvoiceTimeline invoice={makeInvoice({ status: 'issuing' })} />);
    const node = screen.getByText('Issuing').closest('li');
    expect(node).toHaveClass('invoice-tl-node--locked');
    expect(screen.getByText(/in progress.*locked/i)).toBeInTheDocument();
  });

  it('failed + rejected ⇒ Failed (error) node with safe-to-retry hint', () => {
    renderWithProviders(
      <InvoiceTimeline
        invoice={makeInvoice({ status: 'failed', failureMode: 'rejected', failureCode: 'provider-rejected' })}
      />,
    );
    const node = screen.getByText('Failed').closest('li');
    expect(node).toHaveClass('invoice-tl-node--error');
    expect(screen.getByText(/safe to retry/i)).toBeInTheDocument();
  });

  it('failed + in-doubt ⇒ Uncertain (warning) node with check-provider hint', () => {
    renderWithProviders(
      <InvoiceTimeline
        invoice={makeInvoice({ status: 'failed', failureMode: 'in-doubt', failureCode: 'transport-timeout' })}
      />,
    );
    const node = screen.getByText('Uncertain').closest('li');
    expect(node).toHaveClass('invoice-tl-node--warning');
    expect(screen.getByText(/check provider/i)).toBeInTheDocument();
  });
});

describe('InvoiceTimeline — clearance lane', () => {
  it('not-applicable ⇒ no clearance lane', () => {
    renderWithProviders(<InvoiceTimeline invoice={makeInvoice({ regulatoryStatus: 'not-applicable' })} />);
    expect(screen.queryByText(/regulatory clearance/i)).toBeNull();
  });

  it('pending-submission ⇒ Awaiting KSeF (active), NEVER a "Submitted" done node (#1585)', () => {
    renderWithProviders(
      <InvoiceTimeline invoice={makeInvoice({ regulatoryStatus: 'pending-submission' })} />,
    );
    expect(screen.getByText(/regulatory clearance/i)).toBeInTheDocument();
    const awaitingNode = screen.getByText(/awaiting ksef submission/i).closest('li');
    expect(awaitingNode).toHaveClass('invoice-tl-node--active');
    // Nothing was transmitted — the lane must NOT claim a "Submitted" step.
    expect(screen.queryByText('Submitted')).toBeNull();
  });

  it('submitted ⇒ Submitted (done) + Awaiting acceptance (active)', () => {
    renderWithProviders(
      <InvoiceTimeline invoice={makeInvoice({ regulatoryStatus: 'submitted' })} />,
    );
    expect(screen.getByText(/regulatory clearance/i)).toBeInTheDocument();
    const submittedNode = screen.getByText('Submitted').closest('li');
    expect(submittedNode).toHaveClass('invoice-tl-node--done');
    const awaitingNode = screen.getByText(/awaiting acceptance/i).closest('li');
    expect(awaitingNode).toHaveClass('invoice-tl-node--active');
  });

  it('accepted ⇒ Submitted (done) + Accepted (done), NOT "Cleared"', () => {
    renderWithProviders(
      <InvoiceTimeline invoice={makeInvoice({ regulatoryStatus: 'accepted' })} />,
    );
    // Terminal success must read "Accepted", never "Cleared"
    expect(screen.getByText('Accepted')).toBeInTheDocument();
    expect(screen.queryByText(/cleared/i)).toBeNull();
    const acceptedNode = screen.getByText('Accepted').closest('li');
    expect(acceptedNode).toHaveClass('invoice-tl-node--done');
  });

  it('rejected clearance ⇒ Submitted (done) + Rejected by authority (error)', () => {
    renderWithProviders(
      <InvoiceTimeline invoice={makeInvoice({ regulatoryStatus: 'rejected' })} />,
    );
    const rejectedNode = screen.getByText(/rejected by authority/i).closest('li');
    expect(rejectedNode).toHaveClass('invoice-tl-node--error');
  });
});
