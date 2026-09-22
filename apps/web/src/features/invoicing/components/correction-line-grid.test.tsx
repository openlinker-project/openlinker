/**
 * CorrectionLineGrid tests (#3090, #3095, PR #3379 review)
 *
 * The grid is the shared rendering path all four provider
 * `InvoiceCorrectionFlow` implementers delegate to once the invoice's content
 * is authoritative — so its own logic (pre-fill, delta detection, the credit
 * total) is covered once here rather than once per provider. Each provider's
 * own `*-invoice-correction-flow.test.tsx` still exercises its submit wiring
 * through the grid, but does not re-derive these cases.
 *
 * **The price-only cases are the load-bearing addition from the PR #3379
 * review.** The Credit column and the footer total used to read the edited
 * quantity only — a price-only edit (qty unchanged) silently rendered
 * `0.00`, even though the grid's own note advertises that exact path ("a
 * lower price credits the difference without anything being returned").
 * `emits a price delta once it crosses the threshold` and `computes the
 * total credit across every changed row` below drive `onChange` for a price
 * change but never assert what the table itself DISPLAYS for one — that gap
 * is what the price-only-edit cases in this file close.
 *
 * @module apps/web/src/features/invoicing/components
 */
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../../test/test-utils';
import type { CorrectionLineInput, IssuedDocumentLine } from '../api/invoicing.types';
import { CorrectionLineGrid, type CorrectionSuggestedLine } from './correction-line-grid';

afterEach(() => cleanup());

function line(overrides: Partial<IssuedDocumentLine> = {}): IssuedDocumentLine {
  return {
    name: 'Widget',
    quantity: 2,
    unitNet: 40.65,
    taxRate: '23',
    net: 81.3,
    tax: 18.7,
    gross: 100,
    ...overrides,
  };
}

function renderGrid(options: {
  lines: IssuedDocumentLine[];
  linesIndexedByCorrection?: boolean;
  suggestedLines?: CorrectionSuggestedLine[];
  onChange?: (lines: CorrectionLineInput[]) => void;
}): { onChange: ReturnType<typeof vi.fn> } {
  const onChange = options.onChange ?? vi.fn();
  const getContent = vi.fn().mockResolvedValue({
    linesIndexedByCorrection: options.linesIndexedByCorrection ?? true,
    lines: options.lines,
  });

  renderWithProviders(
    <CorrectionLineGrid
      invoiceId="ol_invoice_1"
      suggestedLines={options.suggestedLines}
      onChange={onChange}
    />,
    { apiClient: createMockApiClient({ invoicing: { getContent } }) },
  );

  return { onChange: onChange as ReturnType<typeof vi.fn> };
}

describe('CorrectionLineGrid', () => {
  it('renders one row per invoiced line, pre-filled with the invoiced quantity and unit gross', async () => {
    renderGrid({
      lines: [line({ name: 'Alpha', quantity: 2, gross: 100 }), line({ name: 'Beta', quantity: 1, gross: 50 })],
    });

    await screen.findByText('Alpha');
    expect(screen.getByText('Beta')).toBeInTheDocument();

    expect(screen.getByLabelText('Quantity after correction, line 1')).toHaveValue(2);
    expect(screen.getByLabelText('Unit price after correction, line 1')).toHaveValue(50);
    expect(screen.getByLabelText('Quantity after correction, line 2')).toHaveValue(1);
  });

  it('renders nothing while the invoice has no authoritative content', async () => {
    const { onChange } = renderGrid({
      lines: [line()],
      linesIndexedByCorrection: false,
    });

    // Give the query a tick to settle — the grid never mounts a table, so
    // there is nothing to `findBy`; asserting on absence directly would race
    // the loading state and pass for the wrong reason.
    await act(() => Promise.resolve());

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('pre-fills a matched lines quantity from suggestedLines, not the invoiced quantity', async () => {
    renderGrid({
      lines: [line({ name: 'Alpha', quantity: 3, gross: 150 })],
      suggestedLines: [{ originalLineNumber: 1, suggestedQuantity: 1 }],
    });

    // Two of three units are being credited back — the remaining quantity is
    // what the proposal computed, never the as-invoiced 3.
    expect(await screen.findByLabelText('Quantity after correction, line 1')).toHaveValue(1);
  });

  it('marks a line absent from suggestedLines as untouched, and a suggested one as not', async () => {
    renderGrid({
      lines: [line({ name: 'Suggested' }), line({ name: 'Not suggested' })],
      suggestedLines: [{ originalLineNumber: 1, suggestedQuantity: 1 }],
    });

    await screen.findByText('Suggested');
    const rows = screen.getAllByRole('row').slice(1); // drop the header row
    expect(rows[0]?.className).not.toContain('credit-row--untouched');
    expect(rows[1]?.className).toContain('credit-row--untouched');
  });

  it('marks a row untouched by suggestion state as touched once its own value is edited (PR #3379 review)', async () => {
    // `credit-row--untouched` is derived from an actual edit against the
    // invoiced values, not from suggestedLines membership — an
    // operator-edited row that was never suggested must still render as
    // touched (full-emphasis), never dimmed as inert.
    renderGrid({
      lines: [line({ quantity: 2, gross: 100 })],
      suggestedLines: [],
    });

    const qty = await screen.findByLabelText('Quantity after correction, line 1');
    const row = screen.getAllByRole('row')[1];
    expect(row?.className).toContain('credit-row--untouched');

    fireEvent.change(qty, { target: { value: '1' } });

    expect(row?.className).not.toContain('credit-row--untouched');
  });

  it('emits nothing while every row still matches its invoiced values', async () => {
    const { onChange } = renderGrid({ lines: [line({ quantity: 2, gross: 100 })] });

    await screen.findByLabelText('Quantity after correction, line 1');
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('emits a quantity delta only for the row that changed', async () => {
    const { onChange } = renderGrid({
      lines: [line({ name: 'Alpha', quantity: 2, gross: 100 }), line({ name: 'Beta', quantity: 1, gross: 50 })],
    });

    const alphaQty = await screen.findByLabelText('Quantity after correction, line 1');
    fireEvent.change(alphaQty, { target: { value: '0' } });

    expect(onChange).toHaveBeenLastCalledWith([{ originalLineNumber: 1, newQuantity: 0 }]);
  });

  it('does not emit a price delta below the half-grosz threshold', async () => {
    const { onChange } = renderGrid({ lines: [line({ quantity: 1, gross: 100 })] });

    const price = await screen.findByLabelText('Unit price after correction, line 1');
    // Invoiced unit gross is 100.00 — 100.004 is within the 0.005 tolerance
    // and must read as "unchanged", or a rendering rounding artifact would
    // submit a spurious price correction on every untouched row.
    fireEvent.change(price, { target: { value: '100.004' } });

    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('emits a price delta once it crosses the threshold', async () => {
    const { onChange } = renderGrid({ lines: [line({ quantity: 1, gross: 100 })] });

    const price = await screen.findByLabelText('Unit price after correction, line 1');
    fireEvent.change(price, { target: { value: '90.00' } });

    expect(onChange).toHaveBeenLastCalledWith([{ originalLineNumber: 1, newUnitPriceGross: 90 }]);
  });

  it('emits both a quantity and a price delta when both changed on one row', async () => {
    const { onChange } = renderGrid({ lines: [line({ quantity: 2, gross: 100 })] });

    fireEvent.change(await screen.findByLabelText('Quantity after correction, line 1'), {
      target: { value: '1' },
    });
    fireEvent.change(screen.getByLabelText('Unit price after correction, line 1'), {
      target: { value: '40.00' },
    });

    expect(onChange).toHaveBeenLastCalledWith([
      { originalLineNumber: 1, newQuantity: 1, newUnitPriceGross: 40 },
    ]);
  });

  it('computes the total credit across every changed row, crediting only the reduction', async () => {
    renderGrid({
      lines: [line({ name: 'Alpha', quantity: 2, gross: 100 }), line({ name: 'Beta', quantity: 1, gross: 50 })],
    });

    fireEvent.change(await screen.findByLabelText('Quantity after correction, line 1'), {
      target: { value: '0' }, // credits all of line 1's 100.00
    });
    fireEvent.change(screen.getByLabelText('Quantity after correction, line 2'), {
      target: { value: '0' }, // credits all of line 2's 50.00
    });

    // Rendered as a negative figure (a credit reduces what is owed) — the
    // footer cell is the last `.credit-cell--credit` in the table.
    const totalCell = screen.getAllByText((_, el) => el?.className === 'mono-text tabular').at(-1);
    expect(totalCell).toHaveTextContent('-150.00');
  });

  it('credits the price difference in the row cell on a price-only edit, quantity unchanged (PR #3379 review)', async () => {
    // Line: qty 3, unitGross 100.00 (gross 300 / 3). Drop the price to 90.00
    // without touching qty — before the fix the Credit column and the
    // footer total both silently read 0.00 for exactly this edit, despite
    // the grid's own note advertising it as a valid way to credit a return.
    renderGrid({ lines: [line({ quantity: 3, gross: 300, unitNet: 81.3, tax: 56.1, net: 243.9 })] });

    const price = await screen.findByLabelText('Unit price after correction, line 1');
    fireEvent.change(price, { target: { value: '90' } });

    // Expected credit: quantity(3) * unitGross(100) - qty(3) * newPrice(90) = 30.00,
    // rendered negated in the row's Credit cell.
    const rowCredit = await screen.findByText('-30.00', { selector: '.credit-cell--credit span' });
    expect(rowCredit).toBeInTheDocument();
    expect(
      screen.queryByText('0.00', { selector: '.credit-cell--credit span' }),
    ).not.toBeInTheDocument();
  });

  it('carries the price-only credit into the footer total, not 0.00 (PR #3379 review)', async () => {
    renderGrid({ lines: [line({ quantity: 3, gross: 300, unitNet: 81.3, tax: 56.1, net: 243.9 })] });

    fireEvent.change(await screen.findByLabelText('Unit price after correction, line 1'), {
      target: { value: '90' },
    });

    const totalCells = await screen.findAllByText(
      (_, el) => el?.className === 'mono-text tabular',
    );
    expect(totalCells.at(-1)).toHaveTextContent('-30.00');
  });

  it('reports 0.00 credit and renders it as an em dash when nothing changed', async () => {
    renderGrid({ lines: [line({ quantity: 3, gross: 300, unitNet: 81.3, tax: 56.1, net: 243.9 })] });

    await screen.findByText('Widget');

    // Untouched row renders "—" for its credit cell rather than "0.00".
    expect(screen.getByText('—', { selector: '.credit-cell--credit span' })).toBeInTheDocument();
  });

  it('does not clobber an in-progress edit when suggestedLines changes on a later render', async () => {
    const onChange = vi.fn();
    const getContent = vi.fn().mockResolvedValue({
      linesIndexedByCorrection: true,
      lines: [line({ quantity: 3, gross: 150 })],
    });
    const apiClient = createMockApiClient({ invoicing: { getContent } });

    const { rerender } = renderWithProviders(
      <CorrectionLineGrid invoiceId="ol_invoice_1" onChange={onChange} />,
      { apiClient },
    );

    const qty = await screen.findByLabelText('Quantity after correction, line 1');
    fireEvent.change(qty, { target: { value: '2' } }); // an operator's own in-progress edit

    // A suggestion arrives after mount (e.g. the proposal query resolving on
    // a slower connection than the invoice content did). It must not reset
    // what the operator already typed — `suggestedLines` is a one-time
    // starting point, read only on initial load.
    rerender(
      <CorrectionLineGrid
        invoiceId="ol_invoice_1"
        suggestedLines={[{ originalLineNumber: 1, suggestedQuantity: 1 }]}
        onChange={onChange}
      />,
    );

    expect(screen.getByLabelText('Quantity after correction, line 1')).toHaveValue(2);
  });
});
