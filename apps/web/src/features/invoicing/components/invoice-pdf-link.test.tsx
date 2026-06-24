/**
 * InvoicePdfLink — scheme-guard tests (#757)
 *
 * Security invariant (plan §1.9): `pdfUrl` is adapter-controlled and reaches the
 * FE with no server-side scheme validation. The component renders an anchor ONLY
 * for http:/https:; any other scheme degrades to copy-text so a `javascript:`
 * payload can NEVER become an `href`.
 */
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, it, expect } from 'vitest';
import { renderWithProviders } from '../../../test/test-utils';
import { InvoicePdfLink } from './invoice-pdf-link';

afterEach(cleanup);

const NUMBER = 'FV/2026/06/001';

describe('InvoicePdfLink', () => {
  it('https:// pdfUrl ⇒ renders an anchor with target=_blank rel=noopener noreferrer', () => {
    renderWithProviders(
      <InvoicePdfLink invoiceNumber={NUMBER} pdfUrl="https://subiekt.example/inv/1.pdf" />,
    );
    const anchor = screen.getByRole('link');
    expect(anchor).toHaveAttribute('href', 'https://subiekt.example/inv/1.pdf');
    expect(anchor).toHaveAttribute('target', '_blank');
    expect(anchor).toHaveAttribute('rel', 'noopener noreferrer');
    expect(anchor).toHaveTextContent(NUMBER);
  });

  it('http:// pdfUrl ⇒ renders an anchor', () => {
    renderWithProviders(<InvoicePdfLink invoiceNumber={NUMBER} pdfUrl="http://host/x.pdf" />);
    expect(screen.getByRole('link')).toHaveAttribute('href', 'http://host/x.pdf');
  });

  it('javascript:alert(1) pdfUrl ⇒ NO anchor, number as copy-text', () => {
    renderWithProviders(<InvoicePdfLink invoiceNumber={NUMBER} pdfUrl="javascript:alert(1)" />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText(NUMBER)).toBeInTheDocument();
  });

  it('data:text/html,… pdfUrl ⇒ NO anchor, copy-text', () => {
    renderWithProviders(
      <InvoicePdfLink invoiceNumber={NUMBER} pdfUrl="data:text/html,<script>1</script>" />,
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText(NUMBER)).toBeInTheDocument();
  });

  it('whitespace-prefixed "  javascript:alert(1)" ⇒ NO anchor, copy-text', () => {
    renderWithProviders(
      <InvoicePdfLink invoiceNumber={NUMBER} pdfUrl="  javascript:alert(1)" />,
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText(NUMBER)).toBeInTheDocument();
  });

  it('null / malformed pdfUrl ⇒ copy-text fallback', () => {
    renderWithProviders(<InvoicePdfLink invoiceNumber={NUMBER} pdfUrl={null} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText(NUMBER)).toBeInTheDocument();
    cleanup();
    renderWithProviders(<InvoicePdfLink invoiceNumber={NUMBER} pdfUrl="not-a-url" />);
    expect(screen.queryByRole('link')).toBeNull();
  });
});
