import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DocumentKindGlyph } from './document-kind-glyph';

describe('DocumentKindGlyph', () => {
  afterEach(cleanup);

  it('should name itself when it renders alone', () => {
    // Rendered without adjacent text the glyph IS the statement of the kind, so
    // a screen reader has nothing else to go on.
    render(<DocumentKindGlyph kind="invoice" />);
    expect(screen.getByRole('img', { name: 'Invoice' })).toBeInTheDocument();
  });

  it('should name a receipt as a receipt', () => {
    render(<DocumentKindGlyph kind="fiscal-receipt" />);
    expect(screen.getByRole('img', { name: 'Fiscal receipt' })).toBeInTheDocument();
  });

  it('should name the absence of a routing decision without calling it unknown', () => {
    render(<DocumentKindGlyph kind={null} />);
    expect(screen.getByRole('img', { name: 'No document' })).toBeInTheDocument();
  });

  it('should hide itself from assistive technology when the kind is already stated', () => {
    const { container } = render(<DocumentKindGlyph kind="invoice" decorative />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('should give each kind a different silhouette', () => {
    // The two are told apart across a list without reading a word, so their
    // outlines have to differ - not only their inner detail.
    const invoice = render(<DocumentKindGlyph kind="invoice" />).container.innerHTML;
    cleanup();
    const receipt = render(<DocumentKindGlyph kind="fiscal-receipt" />).container.innerHTML;
    expect(invoice).not.toBe(receipt);
  });

  it('should carry no colour of its own, because kind is not health', () => {
    const { container } = render(<DocumentKindGlyph kind="invoice" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('class')).toBe('document-glyph');
    // Every stroke inherits, so the glyph can never state a status.
    for (const stroked of Array.from(container.querySelectorAll('[stroke]'))) {
      expect(stroked.getAttribute('stroke')).toBe('currentColor');
    }
  });

  it('should accept an overriding accessible name', () => {
    render(<DocumentKindGlyph kind="invoice" label="Invoice FA/2026/08/0144" />);
    expect(screen.getByRole('img', { name: 'Invoice FA/2026/08/0144' })).toBeInTheDocument();
  });
});
