/**
 * QrCode tests
 *
 * Verifies the headless QR-logic library produces a real, non-empty module
 * matrix rendered as inline SVG, that colours stay theme-fixed (dark-on-light
 * for scannability), and that an empty value renders nothing.
 *
 * @module shared/ui
 */
import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { QrCode } from './qr-code';

describe('QrCode', () => {
  it('should render an inline SVG with dark modules on a white background', () => {
    const { container } = render(
      <QrCode value="https://ksef.mf.gov.pl/invoice/1234567890/01-07-2026/abc" ariaLabel="QR" />,
    );
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.getAttribute('aria-label')).toBe('QR');
    // White background rect + a non-empty dark module path.
    expect(container.querySelector('rect')?.getAttribute('fill')).toBe('#ffffff');
    const path = container.querySelector('path');
    expect(path?.getAttribute('fill')).toBe('#000000');
    expect((path?.getAttribute('d') ?? '').length).toBeGreaterThan(0);
  });

  it('should render nothing for an empty value', () => {
    const { container } = render(<QrCode value="" />);
    expect(container.querySelector('svg')).toBeNull();
  });
});
