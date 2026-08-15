/**
 * CorrectionLinePicker tests (#2076)
 *
 * The load-bearing assertion is `emits the picked row's 1-based position` — that
 * equivalence is the entire fix. The rest guards the degrade path, which must
 * never block a correction.
 *
 * @module apps/web/src/features/invoicing/components
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../../test/test-utils';
import { ApiError } from '../../../shared/api/api-error';
import type { IssuedDocumentLine } from '../api/invoicing.types';
import { CorrectionLinePicker, unitGrossOf } from './correction-line-picker';

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

describe('CorrectionLinePicker', () => {
  it('emits the picked rows 1-based position', async () => {
    const onChange = vi.fn();
    const getContent = vi.fn().mockResolvedValue({
      linesIndexedByCorrection: true,
      lines: [line({ name: 'First' }), line({ name: 'Second' }), line({ name: 'Third' })],
    });

    renderWithProviders(
      <CorrectionLinePicker
        invoiceId="ol_invoice_1"
        value=""
        onChange={onChange}
        ariaLabel="Line number 1"
      />,
      { apiClient: createMockApiClient({ invoicing: { getContent } }) },
    );

    // Await the loaded options: while loading, the control is a live number
    // input under the same accessible name, so firing a select-style change too
    // early would set a value rather than pick a row.
    await screen.findByRole('option', { name: /Second/ });
    fireEvent.change(screen.getByLabelText('Line number 1'), { target: { value: '2' } });

    // 1-based position of the chosen row — what `originalLineNumber` addresses.
    // The picked line is deliberately NOT handed back: prefilling a price from
    // a rounded `gross` would be lossy and would submit a price delta the
    // operator never asked for.
    expect(onChange).toHaveBeenCalledWith('2');
  });

  it('renders one option per line, labelled with its position and unit gross', async () => {
    const getContent = vi.fn().mockResolvedValue({
      linesIndexedByCorrection: true,
      lines: [line({ name: 'Alpha', quantity: 2, gross: 100 })],
    });

    renderWithProviders(
      <CorrectionLinePicker
        invoiceId="ol_invoice_1"
        value=""
        onChange={vi.fn()}
        ariaLabel="Line number 1"
      />,
      { apiClient: createMockApiClient({ invoicing: { getContent } }) },
    );

    // Unit gross (100 / 2 = 50.00), NOT unitNet (40.65) — the form asks for gross.
    expect(await screen.findByRole('option', { name: '1. Alpha — 2 × 50.00' })).toBeInTheDocument();
  });

  it('distinguishes two lines of the same product by position', async () => {
    const onChange = vi.fn();
    const getContent = vi.fn().mockResolvedValue({
      linesIndexedByCorrection: true,
      lines: [
        line({ name: 'Same', quantity: 1, gross: 100 }),
        line({ name: 'Same', quantity: 1, gross: 80 }),
      ],
    });

    renderWithProviders(
      <CorrectionLinePicker
        invoiceId="ol_invoice_1"
        value=""
        onChange={onChange}
        ariaLabel="Line number 1"
      />,
      { apiClient: createMockApiClient({ invoicing: { getContent } }) },
    );

    // The duplicate-product case from #2076: both rows are pickable and the
    // differing price is visible, so the operator can tell them apart.
    expect(await screen.findByRole('option', { name: '1. Same — 1 × 100.00' })).toBeInTheDocument();
    expect(await screen.findByRole('option', { name: '2. Same — 1 × 80.00' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Line number 1'), { target: { value: '2' } });
    expect(onChange).toHaveBeenCalledWith('2');
  });

  it('falls back to manual entry with a warning when the invoice has no content snapshot', async () => {
    const getContent = vi
      .fn()
      .mockRejectedValue(new ApiError('No content snapshot', 409, {}));

    renderWithProviders(
      <CorrectionLinePicker
        invoiceId="ol_invoice_1"
        value=""
        onChange={vi.fn()}
        ariaLabel="Line number 1"
      />,
      { apiClient: createMockApiClient({ invoicing: { getContent } }) },
    );

    // Degrades, never blocks — a correction must stay possible on these rows.
    await screen.findByText(/Line list unavailable/i);
    expect(screen.getByLabelText('Line number 1')).toHaveAttribute('type', 'number');
  });

  it('refuses to offer a picker when a correction will not index these lines', async () => {
    // An invoice issued between the `documentContent` and `issuedLineSnapshot`
    // migrations: content exists (so no 409) but a correction rebuilds the
    // original document from the ORDER instead. Picking a position here would
    // address an array the server never sees — the #2076 defect, reintroduced.
    const getContent = vi.fn().mockResolvedValue({
      linesIndexedByCorrection: false,
      lines: [line({ name: 'Alpha' }), line({ name: 'Beta' })],
    });

    renderWithProviders(
      <CorrectionLinePicker
        invoiceId="ol_invoice_1"
        value=""
        onChange={vi.fn()}
        ariaLabel="Line number 1"
      />,
      { apiClient: createMockApiClient({ invoicing: { getContent } }) },
    );

    await screen.findByText(/cannot be matched to the stored copy/i);
    expect(screen.getByLabelText('Line number 1')).toHaveAttribute('type', 'number');
    expect(screen.queryByRole('option', { name: /Alpha/ })).not.toBeInTheDocument();
  });

  it('distinguishes a transient fetch failure from "no line list"', async () => {
    const getContent = vi.fn().mockRejectedValue(new ApiError('Boom', 500, {}));

    renderWithProviders(
      <CorrectionLinePicker
        invoiceId="ol_invoice_1"
        value=""
        onChange={vi.fn()}
        ariaLabel="Line number 1"
      />,
      { apiClient: createMockApiClient({ invoicing: { getContent } }) },
    );

    // Saying "this invoice has no line list" would be a false claim about the
    // operator's data when the read simply failed. Longer timeout: unlike a
    // 409, a transient failure is retried once, so settling takes a backoff.
    await screen.findByText(/Could not load/i, undefined, { timeout: 5000 });
    expect(screen.queryByText(/Line list unavailable/i)).not.toBeInTheDocument();
  });

  it('clears a line number that indexes no line once the lines load', async () => {
    const onChange = vi.fn();
    // Typed during the loading window; the invoice turns out to have 2 lines.
    const getContent = vi.fn().mockResolvedValue({
      linesIndexedByCorrection: true,
      lines: [line(), line()],
    });

    renderWithProviders(
      <CorrectionLinePicker
        invoiceId="ol_invoice_1"
        value="3"
        onChange={onChange}
        ariaLabel="Line number 1"
      />,
      { apiClient: createMockApiClient({ invoicing: { getContent } }) },
    );

    // Must not stay submittable: Subiekt passes originalLineNumber straight
    // through to `lp` with no server-side range guard.
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(''));
  });

  it('does not retry a 409', async () => {
    const getContent = vi
      .fn()
      .mockRejectedValue(new ApiError('No content snapshot', 409, {}));

    renderWithProviders(
      <CorrectionLinePicker
        invoiceId="ol_invoice_1"
        value=""
        onChange={vi.fn()}
        ariaLabel="Line number 1"
      />,
      { apiClient: createMockApiClient({ invoicing: { getContent } }) },
    );

    await screen.findByText(/Line list unavailable/i);
    // A 409 is a stable fact about the invoice; retrying is pointless load.
    expect(getContent).toHaveBeenCalledTimes(1);
  });
});

describe('unitGrossOf', () => {
  it('derives unit gross from the line total and quantity', () => {
    expect(unitGrossOf(line({ gross: 100, quantity: 4 }))).toBe(25);
  });

  it('returns undefined rather than Infinity for a zero quantity', () => {
    expect(unitGrossOf(line({ gross: 100, quantity: 0 }))).toBeUndefined();
  });

  it('returns undefined for a non-finite gross', () => {
    expect(unitGrossOf(line({ gross: Number.NaN, quantity: 2 }))).toBeUndefined();
  });
});
