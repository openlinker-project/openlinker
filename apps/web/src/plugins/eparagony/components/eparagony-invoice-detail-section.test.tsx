/**
 * EparagonyInvoiceDetailSection tests (#3192)
 *
 * The load-bearing assertion here is a NEGATIVE one: the waiting region
 * renders no retry control. The provider publishes no call that triggers or
 * re-triggers transmission, so a control would be an affordance that reaches
 * nothing - and an operator who presses it concludes the push happened. That
 * is asserted structurally (no button anywhere in the section) rather than by
 * naming the labels a retry button might carry, because the next author's
 * wording is not knowable from here.
 *
 * @module plugins/eparagony/components
 */
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithProviders, sampleConnection } from '../../../test/test-utils';
import type { InvoiceRecord } from '../../../features/invoicing';
import { EparagonyInvoiceDetailSection } from './eparagony-invoice-detail-section';

const eparagonyConnection = { ...sampleConnection, platformType: 'eparagony' };

function makeInvoice(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id: 'ol_invoice_test',
    connectionId: eparagonyConnection.id,
    orderId: 'ol_order_test',
    providerType: 'eparagony',
    documentType: 'invoice',
    status: 'issued',
    providerInvoiceId: 'doc-token-1',
    providerInvoiceNumber: 'FV2026/09/546',
    regulatoryStatus: 'not-applicable',
    clearanceReference: null,
    pdfUrl: null,
    failureMode: null,
    failureCode: null,
    failureReason: null,
    issuedAt: '2026-09-15T09:41:00.000Z',
    createdAt: '2026-09-15T09:40:00.000Z',
    updatedAt: '2026-09-15T21:45:00.000Z',
    orderSummary: null,
    ...overrides,
  };
}

function renderSection(overrides: Partial<InvoiceRecord> = {}): void {
  renderWithProviders(
    <EparagonyInvoiceDetailSection
      invoice={makeInvoice(overrides)}
      connection={eparagonyConnection}
    />,
  );
}

afterEach(cleanup);

describe('EparagonyInvoiceDetailSection', () => {
  it('renders nothing when there is neither a waiting clearance nor a document link', () => {
    const { container } = renderWithProviders(
      <EparagonyInvoiceDetailSection
        invoice={makeInvoice()}
        connection={eparagonyConnection}
      />,
    );
    expect(container.querySelector('.invoice-detail-section')).toBeNull();
  });

  describe('awaiting submission', () => {
    it('states that OpenLinker cannot push the document on', () => {
      renderSection({ regulatoryStatus: 'pending-submission' });

      const alert = screen.getByTestId('clearance-cannot-retry');
      expect(alert).toBeInTheDocument();
      expect(alert.textContent).toContain('OpenLinker cannot push this');
      expect(alert.textContent).toContain('no call that triggers or re-triggers submission');
    });

    // THE acceptance criterion. Structural rather than label-matching: a
    // future "Send again" under any wording fails this, which is the point.
    it('renders NO control of any kind beside that statement', () => {
      const { container } = renderWithProviders(
        <EparagonyInvoiceDetailSection
          invoice={makeInvoice({
            regulatoryStatus: 'pending-submission',
            pdfUrl: 'https://hub.sandbox.example/view/abc',
          })}
          connection={eparagonyConnection}
        />,
      );

      const section = container.querySelector<HTMLElement>('.invoice-detail-section');
      if (section === null) throw new Error('the provider section did not render');
      // Covers `<button>` and anything wearing `role="button"` alike.
      expect(within(section).queryAllByRole('button')).toHaveLength(0);
      expect(section.querySelectorAll('button')).toHaveLength(0);
      // The one interactive element is the document link, and it navigates.
      expect(within(section).getAllByRole('link')).toHaveLength(1);
    });

    // The document is issued with legal effect before it is transmitted, so
    // its visualisation must be reachable while it waits - not only once a
    // terminal clearance value arrives.
    it('offers the document link while the document is still waiting', () => {
      renderSection({
        regulatoryStatus: 'pending-submission',
        pdfUrl: 'https://hub.sandbox.example/view/abc',
      });

      expect(screen.getByTestId('sales-document-open-visualisation')).toHaveAttribute(
        'href',
        'https://hub.sandbox.example/view/abc',
      );
    });
  });

  describe('the issued-document link', () => {
    it('never promises a PDF, in the visible copy or the accessible name', () => {
      renderSection({
        regulatoryStatus: 'accepted',
        pdfUrl: 'https://hub.sandbox.example/view/abc',
      });

      const link = screen.getByTestId('sales-document-open-visualisation');
      expect(link.textContent).toBe('Open');
      expect(link.getAttribute('aria-label')).toMatch(/visualisation/i);
      expect(link.getAttribute('aria-label')).not.toMatch(/pdf/i);
      expect(
        screen.getByText(/An HTML view published by the provider, not a PDF\./),
      ).toBeInTheDocument();
    });

    it('opens in a new tab without leaking the opener', () => {
      renderSection({
        regulatoryStatus: 'accepted',
        pdfUrl: 'https://hub.sandbox.example/view/abc',
      });

      const link = screen.getByTestId('sales-document-open-visualisation');
      expect(link).toHaveAttribute('target', '_blank');
      expect(link.getAttribute('rel')).toContain('noopener');
    });

    // `pdfUrl` is adapter-controlled and reaches the FE with no server-side
    // scheme validation, so a `javascript:` value must never become an href.
    it('renders no link at all for a non-http URL', () => {
      const { container } = renderWithProviders(
        <EparagonyInvoiceDetailSection
          invoice={makeInvoice({ pdfUrl: 'javascript:alert(1)' })}
          connection={eparagonyConnection}
        />,
      );

      expect(screen.queryByTestId('sales-document-open-visualisation')).toBeNull();
      // Nothing else to show for a `not-applicable` document, so the whole
      // region withdraws rather than rendering an empty card.
      expect(container.querySelector('.invoice-detail-section')).toBeNull();
    });

    it('still withholds the link on a waiting document whose URL is unsafe', () => {
      renderSection({
        regulatoryStatus: 'pending-submission',
        pdfUrl: 'javascript:alert(1)',
      });

      expect(screen.getByTestId('clearance-cannot-retry')).toBeInTheDocument();
      expect(screen.queryByTestId('sales-document-open-visualisation')).toBeNull();
    });
  });

  it('withholds the cannot-push statement once the document is no longer waiting', () => {
    renderSection({
      regulatoryStatus: 'accepted',
      pdfUrl: 'https://hub.sandbox.example/view/abc',
    });

    expect(screen.queryByTestId('clearance-cannot-retry')).toBeNull();
  });
});
