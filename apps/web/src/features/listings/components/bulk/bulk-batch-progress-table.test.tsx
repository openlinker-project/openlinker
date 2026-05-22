/**
 * BulkBatchProgressTable tests (#806)
 *
 * Failed rows surface the first error message inline and open a per-record
 * failure dialog with the full structured breakdown; succeeded rows link to
 * the marketplace offer and carry no Details affordance.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../../../test/test-utils';
import { BulkBatchProgressTable } from './bulk-batch-progress-table';
import type { BulkBatchRecordSummary } from '../../api/bulk-listings.types';

// jsdom has no matchMedia; force desktop (table, not card view) for the DataTable.
beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
});

function rec(over: Partial<BulkBatchRecordSummary> = {}): BulkBatchRecordSummary {
  return {
    id: 'r-1',
    internalVariantId: 'ol_variant_abc',
    status: 'failed',
    externalOfferId: null,
    createdAt: '2026-05-21T10:00:00.000Z',
    updatedAt: '2026-05-21T10:01:00.000Z',
    errors: null,
    ...over,
  };
}

describe('BulkBatchProgressTable', () => {
  it('shows the first error message inline for a failed row', () => {
    renderWithProviders(
      <BulkBatchProgressTable
        records={[
          rec({ errors: [{ code: 'INVALID_PRICE', message: 'Price too low for category' }] }),
        ]}
      />,
    );
    expect(screen.getByText('Price too low for category')).toBeInTheDocument();
    // The old static placeholder is gone.
    expect(screen.queryByText(/see record detail/)).not.toBeInTheDocument();
  });

  it('opens the failure dialog with the full structured breakdown on Details', () => {
    renderWithProviders(
      <BulkBatchProgressTable
        records={[
          rec({
            errors: [
              { field: 'price', code: 'INVALID_PRICE', message: 'Price too low for category' },
            ],
          }),
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Failure details/ }));

    expect(screen.getByText('Record failure detail')).toBeInTheDocument();
    // Code + field are dialog-only (the inline cell shows just the message).
    expect(screen.getByText('INVALID_PRICE')).toBeInTheDocument();
    expect(screen.getByText('price')).toBeInTheDocument();
  });

  it('renders every structured error in the dialog list', () => {
    renderWithProviders(
      <BulkBatchProgressTable
        records={[
          rec({
            errors: [
              { field: 'price', code: 'INVALID_PRICE', message: 'Price too low for category' },
              { code: 'MISSING_PARAM', message: 'Required parameter "Brand" is missing' },
            ],
          }),
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Failure details/ }));

    expect(screen.getByText('INVALID_PRICE')).toBeInTheDocument();
    expect(screen.getByText('MISSING_PARAM')).toBeInTheDocument();
    expect(screen.getByText('Required parameter "Brand" is missing')).toBeInTheDocument();
  });

  it('falls back to "Failed" inline when a failed row has no structured errors', () => {
    renderWithProviders(<BulkBatchProgressTable records={[rec({ errors: [] })]} />);
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('links to the marketplace offer and shows no Details button for a succeeded row', () => {
    renderWithProviders(
      <BulkBatchProgressTable
        records={[rec({ status: 'active', externalOfferId: 'ALG-123', errors: null })]}
        buildExternalOfferUrl={(id) => `https://allegro.pl/oferta/${id}`}
      />,
    );

    const link = screen.getByRole('link', { name: /ALG-123/ });
    expect(link).toHaveAttribute('href', 'https://allegro.pl/oferta/ALG-123');
    expect(screen.queryByRole('button', { name: /Failure details/ })).not.toBeInTheDocument();
  });
});
