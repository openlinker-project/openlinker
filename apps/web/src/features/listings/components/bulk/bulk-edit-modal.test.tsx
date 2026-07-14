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
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders, createMockApiClient } from '../../../../test/test-utils';
import { BulkEditModal } from './bulk-edit-modal';
import type { BulkWizardRow } from './bulk-wizard.types';
import type { EanMatchCandidate } from '../../api/listings.types';
import type { Product, ProductVariant } from '../../../products';
import type { Connection } from '../../../connections';

vi.mock('../CategoryPicker', () => ({
  CategoryPicker: ({ value }: { value: string | null }) => (
    <div data-testid="category-picker">{value ?? 'none'}</div>
  ),
}));
// Mutable so a test can drive the category-parameters query result (#1367).
let mockCategoryParameters: unknown[] = [];
vi.mock('../../hooks/use-category-parameters-query', () => ({
  useCategoryParametersQuery: () => ({
    data: mockCategoryParameters,
    isLoading: false,
    error: null,
  }),
}));
vi.mock('../../../content', () => ({ SuggestionDialog: () => null }));
vi.mock('../category-parameters-step', () => ({
  CategoryParametersStep: () => <div data-testid="category-parameters-step" />,
}));

const DEFAULTS = { stock: 5, publishImmediately: true, priceAmount: '12.00', priceCurrency: 'PLN' };

// Allegro connection — no per-row platform section, so the modal renders only
// host-generic fields (these tests predate the per-row platform slot, #1096).
const connection: Connection = {
  id: 'conn_1',
  name: 'My Allegro',
  platformType: 'allegro',
  status: 'active',
  config: {},
  credentialsBacked: true,
  enabledCapabilities: ['OfferManager'],
  supportedCapabilities: ['OfferManager'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

// Erli connection — advertises DeliveryPriceListReader so the modal renders the
// per-row delivery-price-list override field (#1530).
const erliConnection: Connection = {
  ...connection,
  id: 'conn_erli',
  name: 'My Erli',
  platformType: 'erli',
  enabledCapabilities: ['OfferManager'],
  supportedCapabilities: ['OfferManager', 'DeliveryPriceListReader'],
};

function erliApiClient() {
  return createMockApiClient({
    listings: {
      getDeliveryPriceLists: vi.fn().mockResolvedValue({
        deliveryPriceLists: [
          { id: '1', name: '*' },
          { id: '2', name: 'Kurier' },
        ],
      }),
    },
  });
}

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
  beforeEach(() => {
    mockCategoryParameters = [];
  });

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
        connection={connection}
        canBrowseCategories={true}
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
        connection={connection}
        canBrowseCategories={true}
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
        connection={connection}
        canBrowseCategories={true}
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
        connection={connection}
        canBrowseCategories={true}
        defaults={DEFAULTS}
        onSave={() => undefined}
      />,
    );

    expect(screen.getByDisplayValue('Widget')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Changed name')).not.toBeInTheDocument();
  });

  it('threads the picked candidate product card into the saved override (#810)', async () => {
    const onSave = vi.fn();
    renderWithProviders(
      <BulkEditModal
        open
        onOpenChange={() => undefined}
        row={makeRow({
          candidates: [{ allegroCategoryId: 'cat-B', productCardId: 'card-B', name: 'Books' }],
        })}
        connection={connection}
        canBrowseCategories={true}
        defaults={DEFAULTS}
        onSave={onSave}
      />,
    );

    // Pick the candidate → category + card move together; fill the required
    // description so the form passes validation.
    fireEvent.click(screen.getByRole('button', { name: 'Books' }));
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'A fine description' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save row' }));

    await waitFor(() => { expect(onSave).toHaveBeenCalledTimes(1); });
    const override = onSave.mock.calls[0][1] as {
      overrides?: { categoryId?: string; productCardId?: string };
    };
    expect(override.overrides?.categoryId).toBe('cat-B');
    expect(override.overrides?.productCardId).toBe('card-B');
  });

  // #1096 — a `borrows` destination (Erli) can't browse a category tree; the
  // operator enters the reused Allegro id manually (or leaves it blank to
  // resolve at submit).
  it('renders a manual category-id input instead of the tree picker when the destination cannot browse', () => {
    renderWithProviders(
      <BulkEditModal
        open
        onOpenChange={() => undefined}
        row={makeRow()}
        connection={connection}
        canBrowseCategories={false}
        defaults={DEFAULTS}
        onSave={() => undefined}
      />,
    );

    expect(screen.getByLabelText('Allegro category ID')).toBeInTheDocument();
    expect(screen.queryByTestId('category-picker')).not.toBeInTheDocument();
  });

  it('omits a blank category from the saved override so the backend resolves it at submit (#1096)', async () => {
    const onSave = vi.fn();
    renderWithProviders(
      <BulkEditModal
        open
        onOpenChange={() => undefined}
        row={makeRow()}
        connection={connection}
        canBrowseCategories={false}
        defaults={DEFAULTS}
        onSave={onSave}
      />,
    );

    // Leave the category blank; fill only the required description.
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'A fine description' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save row' }));

    await waitFor(() => { expect(onSave).toHaveBeenCalledTimes(1); });
    const override = onSave.mock.calls[0][1] as { overrides?: { categoryId?: string } };
    expect(override.overrides?.categoryId).toBeUndefined();
  });

  // #1367 — a browsable-taxonomy destination (Allegro, whose manifest advertises
  // the `CategoryBrowser` sub-capability) must render the per-category parameter
  // step so required offer params like "Stan" can be set; a borrows-taxonomy
  // destination (Erli) must not.
  it('renders the category-parameter step for a browsable destination once a category is resolved (#1367)', () => {
    mockCategoryParameters = [{ id: '11323', name: 'Stan', type: 'dictionary', required: true }];
    renderWithProviders(
      <BulkEditModal
        open
        onOpenChange={() => undefined}
        row={{ ...makeRow(), resolvedCategoryId: 'cat-1' }}
        connection={connection}
        canBrowseCategories={true}
        defaults={DEFAULTS}
        onSave={() => undefined}
      />,
    );

    expect(screen.getByText('Category parameters')).toBeInTheDocument();
    expect(screen.getByTestId('category-parameters-step')).toBeInTheDocument();
  });

  it('hides the category-parameter step for a borrows destination even with required params (#1367)', () => {
    mockCategoryParameters = [{ id: '11323', name: 'Stan', type: 'dictionary', required: true }];
    renderWithProviders(
      <BulkEditModal
        open
        onOpenChange={() => undefined}
        row={{ ...makeRow(), resolvedCategoryId: 'cat-1' }}
        connection={connection}
        canBrowseCategories={false}
        defaults={DEFAULTS}
        onSave={() => undefined}
      />,
    );

    expect(screen.queryByText('Category parameters')).not.toBeInTheDocument();
    expect(screen.queryByTestId('category-parameters-step')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Allegro category ID')).toBeInTheDocument();
  });

  // #1530 — per-row delivery-price-list override in the bulk edit modal.
  describe('delivery price list override (#1530)', () => {
    it('inherits the batch default and saves no per-row override when left unchanged', async () => {
      const onSave = vi.fn();
      renderWithProviders(
        <BulkEditModal
          open
          onOpenChange={() => undefined}
          row={makeRow()}
          connection={erliConnection}
          canBrowseCategories={false}
          defaults={DEFAULTS}
          batchDeliveryPriceList="*"
          onSave={onSave}
        />,
        { apiClient: erliApiClient() },
      );

      // Wait for the live options to load, then assert the field inherits the
      // batch default value + shows the inherit label.
      await screen.findByRole('option', { name: 'Kurier' }, { timeout: 4000 });
      expect(screen.getByLabelText('Delivery price list')).toHaveValue('*');
      expect(screen.getByText('Batch default')).toBeInTheDocument();

      // Fill the required description so the form passes validation.
      fireEvent.change(screen.getByLabelText('Description'), {
        target: { value: 'A fine description' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save row' }));

      await waitFor(() => { expect(onSave).toHaveBeenCalledTimes(1); });
      const override = onSave.mock.calls[0][1] as {
        overrides?: { platformParams?: Record<string, unknown> };
      };
      // No per-row override written → the row inherits the batch default at submit.
      expect(override.overrides?.platformParams?.deliveryPriceList).toBeUndefined();
    });

    it('writes the per-row override so it wins over the batch default', async () => {
      const onSave = vi.fn();
      renderWithProviders(
        <BulkEditModal
          open
          onOpenChange={() => undefined}
          row={makeRow()}
          connection={erliConnection}
          canBrowseCategories={false}
          defaults={DEFAULTS}
          batchDeliveryPriceList="*"
          onSave={onSave}
        />,
        { apiClient: erliApiClient() },
      );

      await screen.findByRole('option', { name: 'Kurier' }, { timeout: 4000 });
      fireEvent.change(screen.getByLabelText('Delivery price list'), {
        target: { value: 'Kurier' },
      });

      // Once changed it reads as overridden with a reset affordance.
      expect(screen.getByRole('button', { name: 'Reset to batch default' })).toBeInTheDocument();

      // Fill the required description so the form passes validation.
      fireEvent.change(screen.getByLabelText('Description'), {
        target: { value: 'A fine description' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save row' }));

      await waitFor(() => { expect(onSave).toHaveBeenCalledTimes(1); });
      const override = onSave.mock.calls[0][1] as {
        overrides?: { platformParams?: Record<string, unknown> };
      };
      expect(override.overrides?.platformParams?.deliveryPriceList).toBe('Kurier');
    });
  });
});
