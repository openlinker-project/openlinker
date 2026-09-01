import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SalesDocumentCell } from './sales-document-cell';
import type { SalesDocumentView } from '../api/orders.types';

function baseView(over: Partial<SalesDocumentView> = {}): SalesDocumentView {
  return {
    orderId: 'ol_order_1',
    documentKind: null,
    document: null,
    blockReason: null,
    unresolvedReason: null,
    blockDetail: null,
    otherRecords: [],
    ...over,
  };
}

function renderCell(props: Partial<Parameters<typeof SalesDocumentCell>[0]> = {}) {
  return render(
    <MemoryRouter>
      <SalesDocumentCell
        internalOrderId="ol_order_1"
        view={undefined}
        layout="stack"
        hasIssuingCapability
        {...props}
      />
    </MemoryRouter>,
  );
}

describe('SalesDocumentCell (#2552/#2553)', () => {
  it('renders exactly one line for a row with no routed document', () => {
    renderCell();
    expect(screen.getByText('No routing')).toBeInTheDocument();
  });

  it('renders the tick for a finished (done) document, plain ink', () => {
    const { container } = renderCell({
      view: baseView({
        documentKind: 'invoice',
        document: {
          kind: 'invoice',
          documentType: 'vat',
          status: 'issued',
          failureMode: null,
          failureCode: null,
          failureReason: null,
          regulatoryStatus: 'accepted',
          clearanceReference: null,
          identity: {
            recordId: 'r1',
            connectionId: 'c1',
            providerType: null,
            documentNumber: null,
            createdAt: '2026-01-01T00:00:00.000Z',
            completedAt: '2026-01-01T00:05:00.000Z',
            inFlightUntil: null,
          },
        },
      }),
    });
    expect(screen.getByText('Issued')).toBeInTheDocument();
    expect(container.querySelector('.sales-doc__tick')).toBeInTheDocument();
    expect(container.querySelector('.sales-doc--done')).toBeInTheDocument();
    expect(container.querySelector('.sales-doc--error')).not.toBeInTheDocument();
  });

  it('shows a duplicate count badge when other records exist', () => {
    renderCell({
      view: baseView({
        documentKind: 'invoice',
        otherRecords: [{ recordId: 'r2', connectionId: 'c2', kind: 'invoice', blocksFurtherIssuance: true }],
      }),
    });
    expect(screen.getByTitle('A second document exists for this order')).toBeInTheDocument();
  });

  it('renders an attention tone for an authority-rejected invoice', () => {
    const { container } = renderCell({
      view: baseView({
        documentKind: 'invoice',
        document: {
          kind: 'invoice',
          documentType: 'vat',
          status: 'issued',
          failureMode: null,
          failureCode: null,
          failureReason: null,
          regulatoryStatus: 'rejected',
          clearanceReference: null,
          identity: {
            recordId: 'r1',
            connectionId: 'c1',
            providerType: null,
            documentNumber: null,
            createdAt: '2026-01-01T00:00:00.000Z',
            completedAt: null,
            inFlightUntil: null,
          },
        },
      }),
    });
    expect(screen.getByText('Authority rejected')).toBeInTheDocument();
    expect(container.querySelector('.sales-doc--error')).toBeInTheDocument();
  });

  describe('popover (#2553)', () => {
    it('opens the popover on click and shows the persisted reason', async () => {
      const user = userEvent.setup();
      renderCell({
        view: baseView({
          documentKind: 'invoice',
          blockReason: 'unresolved-routing',
          unresolvedReason: 'ambiguous-connection-no-primary',
        }),
      });

      await user.click(screen.getByRole('button', { name: /invoice: two setups apply/i }));

      expect(
        screen.getByText(
          /more than one setup could issue this document/i,
        ),
      ).toBeInTheDocument();
    });

    it('offers the action when the state keeps it and a connection can issue', async () => {
      const user = userEvent.setup();
      renderCell({
        view: baseView({ documentKind: 'invoice' }),
        hasIssuingCapability: true,
      });

      await user.click(screen.getByRole('button', { name: /invoice: not issued/i }));

      expect(screen.getByRole('link', { name: /issue invoice/i })).toHaveAttribute(
        'href',
        '/orders/ol_order_1#invoicing',
      );
    });

    it('withholds the action when no connection can issue', async () => {
      const user = userEvent.setup();
      renderCell({
        view: baseView({ documentKind: 'invoice' }),
        hasIssuingCapability: false,
      });

      await user.click(screen.getByRole('button', { name: /invoice: not issued/i }));

      expect(screen.queryByRole('link', { name: /issue invoice/i })).not.toBeInTheDocument();
    });

    it('offers "Set routing" instead of an issuing action when nothing is routed', async () => {
      const user = userEvent.setup();
      renderCell({ view: baseView() });

      await user.click(screen.getByRole('button', { name: /no document: no routing/i }));

      expect(screen.getByRole('link', { name: /set routing/i })).toHaveAttribute(
        'href',
        '/settings/sales-documents',
      );
    });

    it('warns when another connection holds a document for the same order', async () => {
      const user = userEvent.setup();
      renderCell({
        view: baseView({
          documentKind: 'invoice',
          document: {
            kind: 'invoice',
            documentType: 'vat',
            status: 'issued',
            failureMode: null,
            failureCode: null,
            failureReason: null,
            regulatoryStatus: 'accepted',
            clearanceReference: null,
            identity: {
              recordId: 'r1',
              connectionId: 'c1',
              providerType: null,
              documentNumber: null,
              createdAt: '2026-01-01T00:00:00.000Z',
              completedAt: null,
              inFlightUntil: null,
            },
          },
          otherRecords: [{ recordId: 'r2', connectionId: 'conn_other', kind: 'invoice', blocksFurtherIssuance: true }],
        }),
      });

      await user.click(screen.getByRole('button', { name: /invoice: issued/i }));

      expect(screen.getByText(/also holds a document for this sale/i)).toBeInTheDocument();
    });
  });
});
