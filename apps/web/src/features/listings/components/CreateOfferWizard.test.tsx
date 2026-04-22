/**
 * CreateOfferWizard Tests
 *
 * @module apps/web/src/features/listings/components
 */
import { screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../../test/test-utils';
import { CreateOfferWizard } from './CreateOfferWizard';
import type { Connection } from '../../connections/api/connections.types';
import type { Product } from '../../products/api/products.types';
import type { SellerPoliciesResponse } from '../api/listings.types';

const allegroConnection: Connection = {
  id: 'conn_allegro_1',
  name: 'Allegro sandbox',
  platformType: 'allegro',
  status: 'active',
  config: {},
  credentialsBacked: true,
  adapterKey: 'allegro.publicapi.v1',
  enabledCapabilities: ['Marketplace'],
  supportedCapabilities: ['Marketplace'],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const product: Product = {
  id: 'ol_product_abc',
  name: 'Test Shirt',
  sku: 'TS-1',
  price: 49.5,
  description: null,
  images: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  variants: [
    {
      id: 'ol_variant_aaaaaaaa',
      productId: 'ol_product_abc',
      sku: 'TS-1-M',
      attributes: { size: 'M' },
      ean: '5901234567890',
      gtin: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ],
};

const policies: SellerPoliciesResponse = {
  deliveryPolicies: [{ id: 'del-1', name: 'Free shipping' }],
  returnPolicies: [{ id: 'ret-1', name: '14-day returns' }],
  warranties: [{ id: 'war-1', name: '1-year warranty' }],
  impliedWarranties: [{ id: 'iw-1', name: 'Consumer rights' }],
};

function defaultMocks(overrides: Parameters<typeof createMockApiClient>[0] = {}) {
  return createMockApiClient({
    connections: { list: vi.fn().mockResolvedValue([allegroConnection]) },
    products: {
      list: vi.fn().mockResolvedValue({ items: [product], total: 1, limit: 10, offset: 0 }),
      getById: vi.fn().mockResolvedValue(product),
    },
    listings: {
      createOffer: vi
        .fn()
        .mockResolvedValue({ jobId: 'job-1', offerCreationRecordId: 'rec-1' }),
      getSellerPolicies: vi.fn().mockResolvedValue(policies),
    },
    mappings: {
      // Single-leaf root tree for simple happy-path coverage. Individual tests
      // override with deeper trees when they need to exercise drilling.
      getAllegroCategories: vi.fn().mockResolvedValue([
        { id: '12345', name: 'Test Category', parentId: null, leaf: true },
      ]),
    },
    ...overrides,
  });
}

/**
 * Pick the leaf category whose "Select" button is currently visible in the
 * CategoryPicker. Assumes Step 2 is rendered and the picker has loaded.
 */
async function pickFirstLeafCategory(): Promise<void> {
  const selectButton = await screen.findByRole('button', { name: /^select$/i });
  fireEvent.click(selectButton);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /^selected$/i })).toBeInTheDocument(),
  );
}

async function advanceToStep2(): Promise<void> {
  // Wait for the connections query to resolve so the default connection has
  // been pre-selected into the form.
  await waitFor(() => {
    const select = screen.getByLabelText<HTMLSelectElement>(/connection/i);
    expect(select.value).toBe(allegroConnection.id);
  });
  // Wait for the products query to resolve, then expand the product row to
  // reveal its variants.
  await waitFor(() => expect(screen.getByText('Test Shirt')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: /test shirt/i }));
  await waitFor(() => expect(screen.getByText(/test shirt — m/i)).toBeInTheDocument());
  fireEvent.click(screen.getByRole('radio'));
  fireEvent.click(screen.getByRole('button', { name: /next/i }));
  // Confirm Step 2 has rendered before handing back to the caller so that
  // downstream queries are not racing the advance. The "Allegro category"
  // label is now a static span (the picker is a custom control, not an
  // input), so we look for the picker's own markup instead.
  await waitFor(() => expect(screen.getByText('Allegro category')).toBeInTheDocument());
}

describe('CreateOfferWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('does not render dialog content when closed', () => {
    const mockApi = defaultMocks();
    renderWithProviders(
      <CreateOfferWizard
        isOpen={false}
        onClose={vi.fn()}
        defaultConnectionId={allegroConnection.id}
        onSubmitted={vi.fn()}
      />,
      { apiClient: mockApi },
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders step 1 with connection picker and variant search when open', async () => {
    const mockApi = defaultMocks();
    renderWithProviders(
      <CreateOfferWizard
        isOpen={true}
        onClose={vi.fn()}
        defaultConnectionId={allegroConnection.id}
        onSubmitted={vi.fn()}
      />,
      { apiClient: mockApi },
    );

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/connection/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/search products/i)).toBeInTheDocument();
  });

  it('pre-selects the connection when defaultConnectionId is provided', async () => {
    const mockApi = defaultMocks();
    renderWithProviders(
      <CreateOfferWizard
        isOpen={true}
        onClose={vi.fn()}
        defaultConnectionId={allegroConnection.id}
        onSubmitted={vi.fn()}
      />,
      { apiClient: mockApi },
    );

    const connectionSelect = await screen.findByLabelText<HTMLSelectElement>(/connection/i);
    await waitFor(() => expect(connectionSelect.value).toBe(allegroConnection.id));
  });

  it('cannot advance from step 1 without picking a variant', async () => {
    const mockApi = defaultMocks();
    renderWithProviders(
      <CreateOfferWizard
        isOpen={true}
        onClose={vi.fn()}
        defaultConnectionId={allegroConnection.id}
        onSubmitted={vi.fn()}
      />,
      { apiClient: mockApi },
    );

    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    // Stays on Step 1 — title field (Step 2) must not be visible
    expect(screen.queryByLabelText(/^title$/i)).not.toBeInTheDocument();
    expect(await screen.findByText(/pick a variant/i)).toBeInTheDocument();
  });

  it('blocks advancement past step 2 until a leaf category is selected', async () => {
    const mockApi = defaultMocks();
    renderWithProviders(
      <CreateOfferWizard
        isOpen={true}
        onClose={vi.fn()}
        defaultConnectionId={allegroConnection.id}
        onSubmitted={vi.fn()}
      />,
      { apiClient: mockApi },
    );

    await advanceToStep2();
    // Fill the other required Step-2 fields, but leave categoryId unselected.
    fireEvent.change(screen.getByLabelText(/^price$/i), { target: { value: '99.99' } });
    fireEvent.change(screen.getByLabelText(/^stock$/i), { target: { value: '5' } });

    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(
      await screen.findByText(/allegro category id is required/i),
    ).toBeInTheDocument();
    // Still on Step 2 — delivery-policy select (Step 3) is not rendered.
    expect(screen.queryByLabelText(/delivery policy/i)).not.toBeInTheDocument();
  });

  it('validates title ≤ 75 chars on step 2', async () => {
    const mockApi = defaultMocks();
    renderWithProviders(
      <CreateOfferWizard
        isOpen={true}
        onClose={vi.fn()}
        defaultConnectionId={allegroConnection.id}
        onSubmitted={vi.fn()}
      />,
      { apiClient: mockApi },
    );

    await advanceToStep2();
    const titleInput = await screen.findByLabelText(/^title$/i);
    // Pre-fill is on, but maxLength blocks input beyond 75 — use fireEvent.change
    // to bypass the DOM cap and trigger the Zod validation instead.
    fireEvent.change(titleInput, { target: { value: 'x'.repeat(80) } });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(await screen.findByText(/75 characters or fewer/i)).toBeInTheDocument();
  });

  it('requires delivery policy on step 3 when policies are present', async () => {
    const mockApi = defaultMocks();
    renderWithProviders(
      <CreateOfferWizard
        isOpen={true}
        onClose={vi.fn()}
        defaultConnectionId={allegroConnection.id}
        onSubmitted={vi.fn()}
      />,
      { apiClient: mockApi },
    );

    await advanceToStep2();
    // Fill the required Step-2 fields
    await pickFirstLeafCategory();
    fireEvent.change(screen.getByLabelText(/^price$/i), { target: { value: '99.99' } });
    fireEvent.change(screen.getByLabelText(/^stock$/i), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    // Now on Step 3 — try to advance without picking delivery
    await screen.findByLabelText(/delivery policy/i);
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(await screen.findByText(/delivery policy is required/i)).toBeInTheDocument();
  });

  it('informs the operator when the connection has no seller policies', async () => {
    const mockApi = defaultMocks({
      listings: {
        getSellerPolicies: vi.fn().mockResolvedValue({
          deliveryPolicies: [],
          returnPolicies: [],
          warranties: [],
          impliedWarranties: [],
        }),
      },
    });

    renderWithProviders(
      <CreateOfferWizard
        isOpen={true}
        onClose={vi.fn()}
        defaultConnectionId={allegroConnection.id}
        onSubmitted={vi.fn()}
      />,
      { apiClient: mockApi },
    );

    await advanceToStep2();
    await pickFirstLeafCategory();
    fireEvent.change(screen.getByLabelText(/^price$/i), { target: { value: '99.99' } });
    fireEvent.change(screen.getByLabelText(/^stock$/i), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    expect(await screen.findByText(/no seller policies configured/i)).toBeInTheDocument();
  });

  it('submits with the correct payload and a stable idempotency key; calls onSubmitted', async () => {
    const createOffer = vi.fn().mockResolvedValue({ jobId: 'job-42', offerCreationRecordId: 'rec-42' });
    const onSubmitted = vi.fn();
    const onClose = vi.fn();
    const mockApi = defaultMocks({ listings: { createOffer, getSellerPolicies: vi.fn().mockResolvedValue(policies) } });

    renderWithProviders(
      <CreateOfferWizard
        isOpen={true}
        onClose={onClose}
        defaultConnectionId={allegroConnection.id}
        onSubmitted={onSubmitted}
      />,
      { apiClient: mockApi },
    );

    await advanceToStep2();
    await pickFirstLeafCategory();
    fireEvent.change(screen.getByLabelText(/^price$/i), { target: { value: '99.99' } });
    fireEvent.change(screen.getByLabelText(/^stock$/i), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    // Step 3 — pick delivery
    const deliverySelect = await screen.findByLabelText(/delivery policy/i);
    fireEvent.change(deliverySelect, { target: { value: 'del-1' } });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    // Step 4 — submit
    fireEvent.click(await screen.findByRole('button', { name: /create offer/i }));

    await waitFor(() =>
      expect(createOffer).toHaveBeenCalledWith(
        allegroConnection.id,
        expect.objectContaining({
          internalVariantId: 'ol_variant_aaaaaaaa',
          stock: 5,
          publishImmediately: false,
          price: { amount: 99.99, currency: 'PLN' },
          overrides: expect.objectContaining({
            title: expect.any(String),
            categoryId: '12345',
            platformParams: expect.objectContaining({ deliveryPolicyId: 'del-1' }),
          }),
        }),
        expect.objectContaining({ idempotencyKey: expect.stringMatching(/.+/) }),
      ),
    );

    await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith('rec-42', allegroConnection.id));
    expect(onClose).toHaveBeenCalled();
  });

  it('reuses the same idempotency key across retries after a failure', async () => {
    const createOffer = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce({ jobId: 'j', offerCreationRecordId: 'r' });
    const mockApi = defaultMocks({ listings: { createOffer, getSellerPolicies: vi.fn().mockResolvedValue(policies) } });

    renderWithProviders(
      <CreateOfferWizard
        isOpen={true}
        onClose={vi.fn()}
        defaultConnectionId={allegroConnection.id}
        onSubmitted={vi.fn()}
      />,
      { apiClient: mockApi },
    );

    await advanceToStep2();
    await pickFirstLeafCategory();
    fireEvent.change(screen.getByLabelText(/^price$/i), { target: { value: '99.99' } });
    fireEvent.change(screen.getByLabelText(/^stock$/i), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.change(await screen.findByLabelText(/delivery policy/i), { target: { value: 'del-1' } });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    const submit = await screen.findByRole('button', { name: /create offer/i });
    fireEvent.click(submit);
    await waitFor(() => expect(createOffer).toHaveBeenCalledTimes(1));
    // Wait for the error to surface and the button to re-enable
    expect(await screen.findByText(/offer creation failed/i)).toBeInTheDocument();

    // Retry
    fireEvent.click(screen.getByRole('button', { name: /create offer/i }));
    await waitFor(() => expect(createOffer).toHaveBeenCalledTimes(2));

    const firstKey = createOffer.mock.calls[0][2].idempotencyKey;
    const secondKey = createOffer.mock.calls[1][2].idempotencyKey;
    expect(firstKey).toBe(secondKey);
    expect(firstKey).toBeTruthy();
  });

  it('renders inline Alert and keeps the dialog open when submit fails', async () => {
    const createOffer = vi.fn().mockRejectedValue(new Error('Adapter down'));
    const onClose = vi.fn();
    const mockApi = defaultMocks({ listings: { createOffer, getSellerPolicies: vi.fn().mockResolvedValue(policies) } });

    renderWithProviders(
      <CreateOfferWizard
        isOpen={true}
        onClose={onClose}
        defaultConnectionId={allegroConnection.id}
        onSubmitted={vi.fn()}
      />,
      { apiClient: mockApi },
    );

    await advanceToStep2();
    await pickFirstLeafCategory();
    fireEvent.change(screen.getByLabelText(/^price$/i), { target: { value: '99.99' } });
    fireEvent.change(screen.getByLabelText(/^stock$/i), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.change(await screen.findByLabelText(/delivery policy/i), { target: { value: 'del-1' } });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    fireEvent.click(await screen.findByRole('button', { name: /create offer/i }));

    expect(await screen.findByText(/offer creation failed/i)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  describe('variant picker pagination (#308)', () => {
    const page1Product = { ...product, id: 'ol_product_abc', name: 'Test Shirt' };
    const page2Product = { ...product, id: 'ol_product_def', name: 'Page Two Shirt' };

    it('does not render Prev/Next when total <= page size', async () => {
      const list = vi.fn().mockResolvedValue({ items: [page1Product], total: 1, limit: 10, offset: 0 });
      const mockApi = defaultMocks({ products: { list, getById: vi.fn().mockResolvedValue(page1Product) } });
      renderWithProviders(
        <CreateOfferWizard
          isOpen={true}
          onClose={vi.fn()}
          defaultConnectionId={allegroConnection.id}
          onSubmitted={vi.fn()}
        />,
        { apiClient: mockApi },
      );

      await waitFor(() => expect(screen.getByText('Test Shirt')).toBeInTheDocument());
      expect(screen.queryByRole('button', { name: /previous page of products/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /next page of products/i })).not.toBeInTheDocument();
    });

    it('paginates forward and disables Next on the last page', async () => {
      const list = vi
        .fn()
        .mockImplementation((_filters, pagination: { limit?: number; offset?: number } = {}) =>
          Promise.resolve(
            (pagination.offset ?? 0) === 0
              ? { items: [page1Product], total: 15, limit: 10, offset: 0 }
              : { items: [page2Product], total: 15, limit: 10, offset: 10 },
          ),
        );
      const mockApi = defaultMocks({
        products: { list, getById: vi.fn().mockResolvedValue(page1Product) },
      });
      renderWithProviders(
        <CreateOfferWizard
          isOpen={true}
          onClose={vi.fn()}
          defaultConnectionId={allegroConnection.id}
          onSubmitted={vi.fn()}
        />,
        { apiClient: mockApi },
      );

      // Page 1: Prev disabled, Next enabled
      await waitFor(() => expect(screen.getByText('Test Shirt')).toBeInTheDocument());
      const prev = await screen.findByRole('button', { name: /previous page of products/i });
      const next = await screen.findByRole('button', { name: /next page of products/i });
      expect(prev).toBeDisabled();
      expect(next).not.toBeDisabled();

      // Click Next → page 2
      fireEvent.click(next);
      await waitFor(() => expect(screen.getByText('Page Two Shirt')).toBeInTheDocument());
      expect(list).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ offset: 10 }),
      );

      // Page 2 of 15: Prev enabled, Next disabled (10 + 10 >= 15)
      const prevAfter = screen.getByRole('button', { name: /previous page of products/i });
      const nextAfter = screen.getByRole('button', { name: /next page of products/i });
      expect(prevAfter).not.toBeDisabled();
      expect(nextAfter).toBeDisabled();
    });

    it('resets offset to 0 when the search input changes', async () => {
      const list = vi
        .fn()
        .mockImplementation((filters: { search?: string } = {}, pagination: { offset?: number } = {}) =>
          Promise.resolve(
            filters.search
              ? { items: [page2Product], total: 1, limit: 10, offset: 0 }
              : (pagination.offset ?? 0) === 0
                ? { items: [page1Product], total: 15, limit: 10, offset: 0 }
                : { items: [], total: 15, limit: 10, offset: 10 },
          ),
        );
      const mockApi = defaultMocks({
        products: { list, getById: vi.fn().mockResolvedValue(page1Product) },
      });
      renderWithProviders(
        <CreateOfferWizard
          isOpen={true}
          onClose={vi.fn()}
          defaultConnectionId={allegroConnection.id}
          onSubmitted={vi.fn()}
        />,
        { apiClient: mockApi },
      );

      // Advance to page 2
      await waitFor(() => expect(screen.getByText('Test Shirt')).toBeInTheDocument());
      fireEvent.click(await screen.findByRole('button', { name: /next page of products/i }));
      await waitFor(() =>
        expect(list).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ offset: 10 })),
      );

      // Type in search — offset must reset to 0 (last call after debounce)
      const searchInput = screen.getByLabelText(/search products/i);
      fireEvent.change(searchInput, { target: { value: 'page two' } });
      await waitFor(
        () => {
          const lastCall = list.mock.calls[list.mock.calls.length - 1];
          expect(lastCall[0]).toEqual(expect.objectContaining({ search: 'page two' }));
          expect(lastCall[1]).toEqual(expect.objectContaining({ offset: 0 }));
        },
        { timeout: 1000 },
      );
    });
  });
});
