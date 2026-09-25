/**
 * CorrectionLineGrid tests (#3090, PR #3379 review)
 *
 * The load-bearing assertion is the price-only row: the Credit column and the
 * footer total must reflect an edited unit price even when the quantity is
 * left untouched, because the grid's own note advertises that exact path
 * ("a lower price credits the difference without anything being returned").
 * Prior to this fix both figures silently read `0.00` for a price-only edit.
 *
 * @module apps/web/src/features/invoicing/components
 */
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../../test/test-utils';
import type { IssuedDocumentLine } from '../api/invoicing.types';
import { CorrectionLineGrid } from './correction-line-grid';

afterEach(() => cleanup());

function line(overrides: Partial<IssuedDocumentLine> = {}): IssuedDocumentLine {
  return {
    name: 'Widget',
    quantity: 3,
    unitNet: 81.3,
    taxRate: '23',
    net: 243.9,
    tax: 56.1,
    gross: 300,
    ...overrides,
  };
}

describe('CorrectionLineGrid', () => {
  it('credits the price difference on a price-only edit, quantity unchanged', async () => {
    const onChange = vi.fn();
    const getContent = vi.fn().mockResolvedValue({
      linesIndexedByCorrection: true,
      lines: [line()],
    });

    renderWithProviders(
      <CorrectionLineGrid invoiceId="ol_invoice_1" onChange={onChange} />,
      { apiClient: createMockApiClient({ invoicing: { getContent } }) },
    );

    await screen.findByText('Widget');

    // Unit gross is 100.00 (300 / 3). Drop it to 90.00 without touching qty.
    fireEvent.change(screen.getByLabelText('Unit price after correction, line 1'), {
      target: { value: '90' },
    });

    // Expected credit: quantity(3) * unitGross(100) - qty(3) * newPrice(90) = 30.00,
    // rendered negated (a credit note reduces the invoice), so it must NOT be 0.00.
    const cells = await screen.findAllByText(/30\.00/);
    expect(cells.length).toBeGreaterThan(0);
    expect(screen.queryByText('0.00')).not.toBeInTheDocument();
  });

  it('still credits the whole line on a quantity-only edit (byte-identical to pre-fix behaviour)', async () => {
    const onChange = vi.fn();
    const getContent = vi.fn().mockResolvedValue({
      linesIndexedByCorrection: true,
      lines: [line()],
    });

    renderWithProviders(
      <CorrectionLineGrid invoiceId="ol_invoice_1" onChange={onChange} />,
      { apiClient: createMockApiClient({ invoicing: { getContent } }) },
    );

    await screen.findByText('Widget');

    fireEvent.change(screen.getByLabelText('Quantity after correction, line 1'), {
      target: { value: '0' },
    });

    // Full line credited: 3 * 100.00 - 0 * 100.00 = 300.00
    const cells = await screen.findAllByText(/300\.00/);
    expect(cells.length).toBeGreaterThan(0);
  });

  it('reports 0.00 credit and renders it as an em dash when nothing changed', async () => {
    const getContent = vi.fn().mockResolvedValue({
      linesIndexedByCorrection: true,
      lines: [line()],
    });

    renderWithProviders(
      <CorrectionLineGrid invoiceId="ol_invoice_1" onChange={vi.fn()} />,
      { apiClient: createMockApiClient({ invoicing: { getContent } }) },
    );

    await screen.findByText('Widget');

    // Untouched row renders "—" for its credit cell rather than "0.00".
    expect(screen.getByText('—', { selector: '.credit-cell--credit span' })).toBeInTheDocument();
  });
});
