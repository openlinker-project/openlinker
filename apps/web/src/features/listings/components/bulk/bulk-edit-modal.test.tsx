/**
 * BulkEditModal tests (#792 PR 3)
 *
 * Multi-match candidate chips + snapshot pre-fill (the form binds to a
 * one-time snapshot of the row at open and does not re-bind when a background
 * row update changes the `row` prop mid-edit).
 *
 * The category picker, parameters query, parameters step, and AI suggestion
 * dialog are stubbed so the test isolates the modal's own logic from their
 * data dependencies.
 */
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../../test/test-utils';
import { BulkEditModal } from './bulk-edit-modal';
import type { BulkWizardRow } from './bulk-wizard.types';
import type { EanMatchCandidate } from '../../api/listings.types';
import type { Product, ProductVariant } from '../../../products';

vi.mock('../CategoryPicker', () => ({
  CategoryPicker: ({ value }: { value: string | null }) => (
    <div data-testid="category-picker">{value ?? 'none'}</div>
  ),
}));
vi.mock('../../hooks/use-category-parameters-query', () => ({
  useCategoryParametersQuery: () => ({ data: [], isLoading: false, error: null }),
}));
vi.mock('../../../content', () => ({ SuggestionDialog: () => null }));
vi.mock('../category-parameters-step', () => ({ CategoryParametersStep: () => null }));

const DEFAULTS = { stock: 5, publishImmediately: true, priceAmount: '12.00', priceCurrency: 'PLN' };

function makeRow(opts: {
  name?: string;
  candidates?: EanMatchCandidate[];
} = {}): BulkWizardRow {
  const variant: ProductVariant = {
    id: 'var_1',
    productId: 'prod_1',
    sku: 'SKU',
    attributes: null,
    ean: '590',
    gtin: null,
    price: 12,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const product: Product = {
    id: 'prod_1',
    name: opts.name ?? 'Widget',
    sku: 'SKU',
    price: 12,
    currency: 'PLN',
    description: null,
    images: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  return {
    productId: 'prod_1',
    product,
    primaryVariant: variant,
    blockers: [],
    resolvedCategoryId: null,
    resolvedProductCardId: null,
    resolutionMethod: null,
    masterPrice: 12,
    masterStock: 5,
    masterCurrency: 'PLN',
    categoryCandidates: opts.candidates ?? [],
    override: {},
  };
}

describe('BulkEditModal', () => {
  it('renders a suggested-category chip per multi-match candidate, falling back to the id', () => {
    renderWithProviders(
      <BulkEditModal
        open
        onOpenChange={() => undefined}
        row={makeRow({
          candidates: [
            { allegroCategoryId: 'cat-B', productCardId: 'card-B', name: 'Books' },
            { allegroCategoryId: 'cat-C', productCardId: 'card-C' },
          ],
        })}
        connectionId="conn_1"
        defaults={DEFAULTS}
        onSave={() => undefined}
      />,
    );

    expect(screen.getByRole('button', { name: 'Books' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'cat-C' })).toBeInTheDocument();
  });

  it('does not render the suggestion chip row when there are no candidates', () => {
    renderWithProviders(
      <BulkEditModal
        open
        onOpenChange={() => undefined}
        row={makeRow()}
        connectionId="conn_1"
        defaults={DEFAULTS}
        onSave={() => undefined}
      />,
    );
    expect(screen.queryByText(/Suggested categories/)).not.toBeInTheDocument();
  });

  it('pre-fills the title from a snapshot and does not re-bind when the row prop changes mid-edit', () => {
    const { rerender } = renderWithProviders(
      <BulkEditModal
        open
        onOpenChange={() => undefined}
        row={makeRow({ name: 'Widget' })}
        connectionId="conn_1"
        defaults={DEFAULTS}
        onSave={() => undefined}
      />,
    );

    expect(screen.getByDisplayValue('Widget')).toBeInTheDocument();

    // A background availability refetch upstream produces a structurally-new
    // row object with a changed product name. The modal must keep the snapshot.
    rerender(
      <BulkEditModal
        open
        onOpenChange={() => undefined}
        row={makeRow({ name: 'Changed name' })}
        connectionId="conn_1"
        defaults={DEFAULTS}
        onSave={() => undefined}
      />,
    );

    expect(screen.getByDisplayValue('Widget')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Changed name')).not.toBeInTheDocument();
  });
});
