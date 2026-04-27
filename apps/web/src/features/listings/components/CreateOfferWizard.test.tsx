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
import type {
  CategoryParameter,
  CreateOfferRequest,
  SellerPoliciesResponse,
} from '../api/listings.types';

const allegroConnection: Connection = {
  id: 'conn_allegro_1',
  name: 'Allegro sandbox',
  platformType: 'allegro',
  status: 'active',
  config: {},
  credentialsBacked: true,
  adapterKey: 'allegro.publicapi.v1',
  enabledCapabilities: ['OfferManager'],
  supportedCapabilities: ['OfferManager'],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const product: Product = {
  id: 'ol_product_abc',
  name: 'Test Shirt',
  sku: 'TS-1',
  price: 49.5,
  currency: null,
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
      // Default the category-parameters fetch to "no parameters" so the step
      // renders a friendly empty message and the existing happy-path tests
      // can advance past it with a single Next click. Individual tests
      // override when they exercise parameter rendering / validation.
      getCategoryParameters: vi.fn().mockResolvedValue({ parameters: [] }),
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

/**
 * Advance through the (empty by default) Step-3 "Category parameters" step,
 * landing on Step-4 "Policies". Used by the existing tests that don't care
 * about parameter rendering — keeps them readable while the new step still
 * gets traversed.
 */
async function advanceThroughEmptyParameters(): Promise<void> {
  expect(
    await screen.findByText(/no additional parameters required/i),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /next/i }));
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
    // Still on Step 2 — neither the parameters step (#410) nor the
    // delivery-policy select (Step 4) are rendered.
    expect(screen.queryByText(/no additional parameters required/i)).not.toBeInTheDocument();
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

  it('requires delivery policy on the policies step when policies are present', async () => {
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

    // Step 3 (#410) — no parameters for this category in the default mock.
    await advanceThroughEmptyParameters();

    // Now on Step 4 — try to advance without picking delivery
    await screen.findByLabelText(/delivery policy/i);
    // #406: implied-warranty / warranty coupling hint is visible on the policies step.
    expect(
      screen.getByText(/Allegro requires a Warranty selection alongside Implied warranty/i),
    ).toBeInTheDocument();
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
    await advanceThroughEmptyParameters();

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
    await advanceThroughEmptyParameters();

    // Step 4 — pick delivery
    const deliverySelect = await screen.findByLabelText(/delivery policy/i);
    fireEvent.change(deliverySelect, { target: { value: 'del-1' } });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    // Step 5 — submit
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
    await advanceThroughEmptyParameters();
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
    await advanceThroughEmptyParameters();
    fireEvent.change(await screen.findByLabelText(/delivery policy/i), { target: { value: 'del-1' } });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    fireEvent.click(await screen.findByRole('button', { name: /create offer/i }));

    expect(await screen.findByText(/offer creation failed/i)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  describe('retry with initialValues (#307)', () => {
    const initialRequest: CreateOfferRequest = {
      internalVariantId: 'ol_variant_aaaaaaaa',
      stock: 5,
      publishImmediately: false,
      price: { amount: 99.99, currency: 'PLN' },
      overrides: {
        title: 'Original Title',
        categoryId: '12345',
        description: null,
        platformParams: {
          deliveryPolicyId: 'del-1',
          returnPolicyId: 'ret-1',
        },
      },
    };

    it('renders the retry hint on Step 1 after Back when opened with initialValues', async () => {
      const mockApi = defaultMocks();
      renderWithProviders(
        <CreateOfferWizard
          isOpen={true}
          onClose={vi.fn()}
          defaultConnectionId={allegroConnection.id}
          initialValues={initialRequest}
          onSubmitted={vi.fn()}
        />,
        { apiClient: mockApi },
      );

      // Lands on Step 2; no hint yet since Step 1 is not rendered.
      await screen.findByLabelText(/^title$/i);
      // Step back to 1 — the hint should now be visible.
      fireEvent.click(screen.getByRole('button', { name: /back/i }));
      expect(await screen.findByText(/prior attempt re-loaded/i)).toBeInTheDocument();
    });

    it('does not render the retry hint on a fresh open', async () => {
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

      await screen.findByLabelText(/search products/i);
      expect(screen.queryByText(/prior attempt re-loaded/i)).not.toBeInTheDocument();
    });

    it('opens on step 2 with fields pre-filled from initialValues', async () => {
      const mockApi = defaultMocks();
      renderWithProviders(
        <CreateOfferWizard
          isOpen={true}
          onClose={vi.fn()}
          defaultConnectionId={allegroConnection.id}
          initialValues={initialRequest}
          onSubmitted={vi.fn()}
        />,
        { apiClient: mockApi },
      );

      // Step 2 is visible (not Step 1's search products field).
      expect(await screen.findByLabelText(/^title$/i)).toHaveValue('Original Title');
      // The CategoryPicker renders the pre-filled categoryId in its
      // "Current category ID" fallback view rather than as an input value.
      expect(screen.getByText('Current category ID')).toBeInTheDocument();
      expect(screen.getByText('12345')).toBeInTheDocument();
      expect(screen.getByLabelText<HTMLInputElement>(/^price$/i).value).toBe('99.99');
      expect(screen.getByLabelText<HTMLInputElement>(/^stock$/i).value).toBe('5');
      expect(screen.queryByLabelText(/search products/i)).not.toBeInTheDocument();
    });

    it('mints a fresh idempotency key on retry open (old failed record untouched)', async () => {
      const createOffer = vi
        .fn()
        .mockResolvedValueOnce({ jobId: 'job-a', offerCreationRecordId: 'rec-a' })
        .mockResolvedValueOnce({ jobId: 'job-b', offerCreationRecordId: 'rec-b' });
      const mockApi = defaultMocks({
        listings: { createOffer, getSellerPolicies: vi.fn().mockResolvedValue(policies) },
      });

      // First wizard session: normal flow through all four steps.
      const { rerender } = renderWithProviders(
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
      await advanceThroughEmptyParameters();
      fireEvent.change(await screen.findByLabelText(/delivery policy/i), {
        target: { value: 'del-1' },
      });
      fireEvent.click(screen.getByRole('button', { name: /next/i }));
      fireEvent.click(await screen.findByRole('button', { name: /create offer/i }));
      await waitFor(() => expect(createOffer).toHaveBeenCalledTimes(1));
      const firstKey = createOffer.mock.calls[0][2].idempotencyKey;

      // Close the wizard, then reopen it with initialValues (the retry path).
      rerender(
        <CreateOfferWizard
          isOpen={false}
          onClose={vi.fn()}
          defaultConnectionId={allegroConnection.id}
          onSubmitted={vi.fn()}
        />,
      );
      rerender(
        <CreateOfferWizard
          isOpen={true}
          onClose={vi.fn()}
          defaultConnectionId={allegroConnection.id}
          initialValues={initialRequest}
          onSubmitted={vi.fn()}
        />,
      );

      // We land on Step 2 pre-filled; advance through the empty parameters
      // step (#410) and the policies step → submit.
      await screen.findByLabelText(/^title$/i);
      fireEvent.click(screen.getByRole('button', { name: /next/i }));
      await advanceThroughEmptyParameters();
      // Delivery policy pre-fills from initialValues; just advance.
      await screen.findByLabelText(/delivery policy/i);
      fireEvent.click(screen.getByRole('button', { name: /next/i }));
      fireEvent.click(await screen.findByRole('button', { name: /create offer/i }));
      await waitFor(() => expect(createOffer).toHaveBeenCalledTimes(2));

      const secondKey = createOffer.mock.calls[1][2].idempotencyKey;
      expect(firstKey).toBeTruthy();
      expect(secondKey).toBeTruthy();
      expect(secondKey).not.toBe(firstKey);
    });
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

  describe('category parameters step (#410)', () => {
    /**
     * Two-parameter fixture covering the auto-prefill, dynamic-validation,
     * and serialiser branches in one shot:
     *  - `p_ean` is an EAN-class string field (matches the auto-prefill
     *    `EAN_NAME_PATTERNS` list).
     *  - `p_stan` is a required dictionary that contains a "Nowy" entry,
     *    so the auto-prefill defaults it to `p_stan_new`.
     */
    const parametersFixture: CategoryParameter[] = [
      {
        id: 'p_ean',
        name: 'EAN (GTIN)',
        type: 'string',
        required: false,
        restrictions: { maxLength: 20 },
      },
      {
        id: 'p_stan',
        name: 'Stan',
        type: 'dictionary',
        required: true,
        dictionary: [
          { id: 'p_stan_new', value: 'Nowy' },
          { id: 'p_stan_used', value: 'Używany' },
        ],
        restrictions: {},
      },
    ];

    it('auto-prefills EAN from variant + Stan default and serialises both into the submit payload', async () => {
      const createOffer = vi
        .fn()
        .mockResolvedValue({ jobId: 'job-1', offerCreationRecordId: 'rec-1' });
      const onSubmitted = vi.fn();
      const onClose = vi.fn();
      const mockApi = defaultMocks({
        listings: {
          createOffer,
          getSellerPolicies: vi.fn().mockResolvedValue(policies),
          getCategoryParameters: vi
            .fn()
            .mockResolvedValue({ parameters: parametersFixture }),
        },
      });

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

      // Step 3 (parameters) — required EAN field is rendered and pre-filled
      // from the variant's EAN; Stan defaults to "Nowy".
      const eanInput = await screen.findByLabelText(/ean \(gtin\)/i);
      await waitFor(() => expect(eanInput).toHaveValue('5901234567890'));
      const stanSelect = screen.getByLabelText<HTMLSelectElement>(/^stan$/i);
      await waitFor(() => expect(stanSelect.value).toBe('p_stan_new'));

      // Advance — dynamic Zod validation passes because Stan is filled.
      fireEvent.click(screen.getByRole('button', { name: /next/i }));
      await screen.findByLabelText(/delivery policy/i);
      fireEvent.change(screen.getByLabelText(/delivery policy/i), {
        target: { value: 'del-1' },
      });
      fireEvent.click(screen.getByRole('button', { name: /next/i }));
      fireEvent.click(await screen.findByRole('button', { name: /create offer/i }));

      await waitFor(() =>
        expect(createOffer).toHaveBeenCalledWith(
          allegroConnection.id,
          expect.objectContaining({
            overrides: expect.objectContaining({
              platformParams: expect.objectContaining({
                deliveryPolicyId: 'del-1',
                parameters: expect.arrayContaining([
                  { id: 'p_ean', values: ['5901234567890'] },
                  { id: 'p_stan', valuesIds: ['p_stan_new'] },
                ]),
              }),
            }),
          }),
          expect.objectContaining({ idempotencyKey: expect.stringMatching(/.+/) }),
        ),
      );
      expect(onSubmitted).toHaveBeenCalledWith('rec-1', allegroConnection.id);
    });

    it('blocks advancement past Step 3 when a required dictionary parameter is empty', async () => {
      // Same fixture, but tests that clearing Stan rejects advancement.
      const mockApi = defaultMocks({
        listings: {
          createOffer: vi.fn(),
          getSellerPolicies: vi.fn().mockResolvedValue(policies),
          // Stan has no "Nowy" entry → autoprefill leaves it empty,
          // exercising the required-when-visible Zod rule.
          getCategoryParameters: vi.fn().mockResolvedValue({
            parameters: [
              {
                ...parametersFixture[1],
                dictionary: [{ id: 'p_stan_used', value: 'Używany' }],
              },
            ],
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

      // Step 3 — Stan is rendered, empty, required.
      const stanSelect = await screen.findByLabelText<HTMLSelectElement>(/^stan$/i);
      expect(stanSelect.value).toBe('');

      fireEvent.click(screen.getByRole('button', { name: /next/i }));
      // The dynamic-validation message is set on the form, and the policies
      // step (Step 4) does not appear.
      expect(await screen.findByText(/stan is required/i)).toBeInTheDocument();
      expect(screen.queryByLabelText(/delivery policy/i)).not.toBeInTheDocument();
    });

    // Note: the "categoryId change clears the parameters slice" effect is
    // small enough to live in the wizard's clearing useEffect, and the
    // wired path is covered by the visibility / serializer / Zod helper
    // unit tests. We deliberately don't add a wizard-level test for it
    // here — driving the CategoryPicker through the picker's "Selected"
    // → re-pick UI is brittle and the marginal coverage is low.
  });
});
