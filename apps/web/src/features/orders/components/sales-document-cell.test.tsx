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
    expect(screen.getByText('No document')).toBeInTheDocument();
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

  // #2761 review: `aria-label` on the trigger overrides its inner content, so
  // the duplicate has to ride in the label itself or it is invisible to a
  // screen reader - exactly the row where a second fiscal document exists.
  it('carries the duplicate sentence in the trigger aria-label', () => {
    renderCell({
      view: baseView({
        documentKind: 'invoice',
        otherRecords: [{ recordId: 'r2', connectionId: 'c2', kind: 'invoice', blocksFurtherIssuance: true }],
      }),
    });
    expect(
      screen.getByRole('button', {
        name: /Invoice: .*A second document exists for this order/,
      }),
    ).toBeInTheDocument();
  });

  it('pluralises the duplicate sentence past a second record', () => {
    renderCell({
      view: baseView({
        documentKind: 'invoice',
        otherRecords: [
          { recordId: 'r2', connectionId: 'c2', kind: 'invoice', blocksFurtherIssuance: true },
          { recordId: 'r3', connectionId: 'c3', kind: 'invoice', blocksFurtherIssuance: true },
        ],
      }),
    });
    expect(screen.getByTitle('3 documents exist for this order')).toBeInTheDocument();
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

      await user.click(screen.getByRole('button', { name: /^no document$/i }));

      expect(screen.getByRole('link', { name: /set routing/i })).toHaveAttribute(
        'href',
        '/settings/sales-documents',
      );
    });

    it('renders fully outside a scrolled, overflow-clipping ancestor (#2553)', async () => {
      const user = userEvent.setup();
      render(
        <MemoryRouter>
          <div className="data-table__container" style={{ overflowX: 'auto', width: '10px' }}>
            <SalesDocumentCell
              internalOrderId="ol_order_1"
              view={baseView({ documentKind: 'invoice' })}
              layout="stack"
              hasIssuingCapability
            />
          </div>
        </MemoryRouter>,
      );

      await user.click(screen.getByRole('button', { name: /invoice: not issued/i }));

      const link = screen.getByRole('link', { name: /issue invoice/i });
      // The M5 `Popover` primitive portals its content to the document root
      // specifically so a cell-anchored panel is never clipped by the table's
      // `overflow-x: auto` container (see `shared/ui/popover.tsx`) — assert
      // that guarantee holds through THIS component, not just the primitive.
      expect(document.querySelector('.data-table__container')?.contains(link)).toBe(false);
    });

    it('closes on Escape and returns focus to the trigger', async () => {
      const user = userEvent.setup();
      renderCell({ view: baseView({ documentKind: 'invoice' }) });

      const trigger = screen.getByRole('button', { name: /invoice: not issued/i });
      await user.click(trigger);
      expect(screen.getByRole('link', { name: /issue invoice/i })).toBeInTheDocument();

      await user.keyboard('{Escape}');

      expect(screen.queryByRole('link', { name: /issue invoice/i })).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
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
