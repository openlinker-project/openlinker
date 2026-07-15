/**
 * AllegroCreateOfferWizard Tests
 *
 * @module apps/web/src/features/listings/components
 */
import { screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAuthenticatedSessionAdapter,
  renderWithProviders,
  createMockApiClient,
} from '../../../test/test-utils';
import { AllegroCreateOfferWizard } from './AllegroCreateOfferWizard';
// NOTE: tests for the connection-picker UX moved to OfferCreationLauncher.test.tsx
// as part of #608. The wizard is now content-only; the launcher owns the
// Dialog chrome and the connection-pick flow.
import type { Connection } from '../../connections';
import type { Product } from '../../products';
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
      price: null,
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
  // Connection is now a prop (the launcher resolves it before mounting),
  // so we skip the connection-picker wait that the pre-#608 wizard
  // required. Wait for the products query, expand the product row, pick
  // the variant, and move to Step 2.
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

describe('AllegroCreateOfferWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  // Removed in #608:
  //   - "does not render dialog content when closed" — the wizard is now
  //     content-only, mounted on demand by `OfferCreationLauncher`. The
  //     "closed" state is the launcher's responsibility; covered in
  //     `OfferCreationLauncher.test.tsx`.
  //   - "renders step 1 with connection picker and variant search" — the
  //     connection picker moved to the launcher; this assertion is
  //     replaced by the connection-id integrity test below + the
  //     launcher's picker spec.
  //   - "pre-selects the connection when defaultConnectionId is provided"
  //     — auto-skip is now launcher behaviour; covered by
  //     `OfferCreationLauncher.test.tsx` ("auto-skips picker when
  //     defaultConnectionId resolves").

  it('renders step 1 with the variant search and the connection name in the header', async () => {
    const mockApi = defaultMocks();
    renderWithProviders(
      <AllegroCreateOfferWizard
        connection={allegroConnection}
        onCancel={vi.fn()}
        onSubmitted={vi.fn()}
      />,
      { apiClient: mockApi },
    );

    expect(await screen.findByLabelText(/search products/i)).toBeInTheDocument();
    expect(screen.getByText(allegroConnection.name)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^connection$/i)).not.toBeInTheDocument();
  });

  it('cannot advance from step 1 without picking a variant', async () => {
    const mockApi = defaultMocks();
    renderWithProviders(
      <AllegroCreateOfferWizard
        connection={allegroConnection}
        onCancel={vi.fn()}
        onSubmitted={vi.fn()}
      />,
      { apiClient: mockApi },
    );

    // Wizard renders content-only now; wait for Step 1 to be visible
    // before driving the Next button.
    await screen.findByLabelText(/search products/i);
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    // Stays on Step 1 — title field (Step 2) must not be visible
    expect(screen.queryByLabelText(/^title$/i)).not.toBeInTheDocument();
    expect(await screen.findByText(/pick a variant/i)).toBeInTheDocument();
  });

  it('blocks advancement past step 2 until a leaf category is selected', async () => {
    const mockApi = defaultMocks();
    renderWithProviders(
      <AllegroCreateOfferWizard
        connection={allegroConnection}
        onCancel={vi.fn()}
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
      <AllegroCreateOfferWizard
        connection={allegroConnection}
        onCancel={vi.fn()}
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
      <AllegroCreateOfferWizard
        connection={allegroConnection}
        onCancel={vi.fn()}
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
      <AllegroCreateOfferWizard
        connection={allegroConnection}
        onCancel={vi.fn()}
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
      <AllegroCreateOfferWizard
        connection={allegroConnection}
        onCancel={onClose}
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
      <AllegroCreateOfferWizard
        connection={allegroConnection}
        onCancel={vi.fn()}
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
      <AllegroCreateOfferWizard
        connection={allegroConnection}
        onCancel={onClose}
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
    // Wizard body still rendered (the launcher's Dialog wraps it; this
    // spec mounts the wizard directly, so we assert the wizard markup
    // instead of `role="dialog"`).
    expect(screen.getByText('Create Allegro offer')).toBeInTheDocument();
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
        <AllegroCreateOfferWizard
          connection={allegroConnection}
          onCancel={vi.fn()}
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
        <AllegroCreateOfferWizard
          connection={allegroConnection}
          onCancel={vi.fn()}
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
        <AllegroCreateOfferWizard
          connection={allegroConnection}
          onCancel={vi.fn()}
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
      renderWithProviders(
        <AllegroCreateOfferWizard
          connection={allegroConnection}
          onCancel={vi.fn()}
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

      // Unmount the first session, then mount a fresh wizard with
      // `initialValues` (the retry path the launcher exercises). Re-mounting
      // is what mints a fresh idempotency key — `useRef(crypto.randomUUID())`
      // re-runs on a new component instance.
      cleanup();
      renderWithProviders(
        <AllegroCreateOfferWizard
          connection={allegroConnection}
          onCancel={vi.fn()}
          initialValues={initialRequest}
          onSubmitted={vi.fn()}
        />,
        { apiClient: mockApi },
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
        <AllegroCreateOfferWizard
          connection={allegroConnection}
          onCancel={vi.fn()}
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
        <AllegroCreateOfferWizard
          connection={allegroConnection}
          onCancel={vi.fn()}
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
        <AllegroCreateOfferWizard
          connection={allegroConnection}
          onCancel={vi.fn()}
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
        section: 'offer',
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
        section: 'offer',
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
        <AllegroCreateOfferWizard
          connection={allegroConnection}
          onCancel={onClose}
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
              platformParams: expect.objectContaining({ deliveryPolicyId: 'del-1' }),
              parameters: expect.arrayContaining([
                { id: 'p_ean', values: ['5901234567890'], section: 'offer' },
                { id: 'p_stan', valuesIds: ['p_stan_new'], section: 'offer' },
              ]),
            }),
          }),
          expect.objectContaining({ idempotencyKey: expect.stringMatching(/.+/) }),
        ),
      );
      expect(onSubmitted).toHaveBeenCalledWith('rec-1', allegroConnection.id);
    });

    it('tags each parameter with its section on overrides.parameters (#415 / #1071)', async () => {
      // Mixed fixture: p_ean (offer) + p_marka (product). The submit carries a
      // single section-tagged `overrides.parameters` array; the adapter (BE)
      // does the offer/product wire split. Sending a product-section parameter
      // to the offer wire array was the ParameterCategoryException 422 bug —
      // now the section travels with the parameter.
      const mixedFixture: CategoryParameter[] = [
        {
          id: 'p_ean',
          name: 'EAN (GTIN)',
          type: 'string',
          required: false,
          restrictions: { maxLength: 20 },
          section: 'offer',
        },
        {
          id: 'p_marka',
          name: 'Marka',
          type: 'dictionary',
          required: true,
          dictionary: [
            { id: 'p_marka_canon', value: 'Canon' },
            { id: 'p_marka_nikon', value: 'Nikon' },
          ],
          restrictions: {},
          section: 'product',
        },
      ];
      const createOffer = vi
        .fn()
        .mockResolvedValue({ jobId: 'job-prod', offerCreationRecordId: 'rec-prod' });
      const mockApi = defaultMocks({
        listings: {
          createOffer,
          getSellerPolicies: vi.fn().mockResolvedValue(policies),
          getCategoryParameters: vi.fn().mockResolvedValue({ parameters: mixedFixture }),
        },
      });

      renderWithProviders(
        <AllegroCreateOfferWizard
          connection={allegroConnection}
          onCancel={vi.fn()}
          onSubmitted={vi.fn()}
        />,
        { apiClient: mockApi },
      );

      await advanceToStep2();
      await pickFirstLeafCategory();
      fireEvent.change(screen.getByLabelText(/^price$/i), { target: { value: '99.99' } });
      fireEvent.change(screen.getByLabelText(/^stock$/i), { target: { value: '5' } });
      fireEvent.click(screen.getByRole('button', { name: /next/i }));

      // Step 3 — fill both parameters explicitly.
      await screen.findByLabelText(/ean \(gtin\)/i);
      fireEvent.change(screen.getByLabelText(/ean \(gtin\)/i), {
        target: { value: '5901234567890' },
      });
      const markaSelect = screen.getByLabelText<HTMLSelectElement>(/^marka$/i);
      fireEvent.change(markaSelect, { target: { value: 'p_marka_canon' } });

      fireEvent.click(screen.getByRole('button', { name: /next/i }));
      fireEvent.change(await screen.findByLabelText(/delivery policy/i), {
        target: { value: 'del-1' },
      });
      fireEvent.click(screen.getByRole('button', { name: /next/i }));
      fireEvent.click(await screen.findByRole('button', { name: /create offer/i }));

      await waitFor(() => expect(createOffer).toHaveBeenCalledTimes(1));
      const submittedRequest = createOffer.mock.calls[0][1] as {
        overrides: {
          parameters?: Array<{ id: string; section: string }>;
          platformParams?: Record<string, unknown>;
        };
      };
      const { parameters, platformParams } = submittedRequest.overrides;

      // Each parameter carries its section; one flat neutral array.
      expect(parameters).toEqual([
        { id: 'p_ean', values: ['5901234567890'], section: 'offer' },
        { id: 'p_marka', valuesIds: ['p_marka_canon'], section: 'product' },
      ]);
      // platformParams no longer carries category parameters (#1071).
      expect(platformParams).not.toHaveProperty('parameters');
      expect(platformParams).not.toHaveProperty('productParameters');
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
        <AllegroCreateOfferWizard
          connection={allegroConnection}
          onCancel={vi.fn()}
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

    it('blocks advancement past Step 3 when a required PRODUCT-section parameter is empty (#415)', async () => {
      // Marka is product-section + required + has no auto-prefill, so it
      // stays empty until the operator picks a value. The dynamic-Zod gate
      // must reject advancement regardless of section — the section split
      // happens at submit time, validation happens before that.
      const mockApi = defaultMocks({
        listings: {
          createOffer: vi.fn(),
          getSellerPolicies: vi.fn().mockResolvedValue(policies),
          getCategoryParameters: vi.fn().mockResolvedValue({
            parameters: [
              {
                id: 'p_marka',
                name: 'Marka',
                type: 'dictionary',
                required: true,
                dictionary: [{ id: 'p_marka_canon', value: 'Canon' }],
                restrictions: {},
                section: 'product',
              } satisfies CategoryParameter,
            ],
          }),
        },
      });

      renderWithProviders(
        <AllegroCreateOfferWizard
          connection={allegroConnection}
          onCancel={vi.fn()}
          onSubmitted={vi.fn()}
        />,
        { apiClient: mockApi },
      );

      await advanceToStep2();
      await pickFirstLeafCategory();
      fireEvent.change(screen.getByLabelText(/^price$/i), { target: { value: '99.99' } });
      fireEvent.change(screen.getByLabelText(/^stock$/i), { target: { value: '5' } });
      fireEvent.click(screen.getByRole('button', { name: /next/i }));

      // Step 3 — Marka is rendered, empty, required.
      const markaSelect = await screen.findByLabelText<HTMLSelectElement>(/^marka$/i);
      expect(markaSelect.value).toBe('');

      fireEvent.click(screen.getByRole('button', { name: /next/i }));
      // Dynamic validation rejects the advance — policies step does NOT appear.
      expect(await screen.findByText(/marka is required/i)).toBeInTheDocument();
      expect(screen.queryByLabelText(/delivery policy/i)).not.toBeInTheDocument();
    });

    // Note: the "categoryId change clears the parameters slice" effect is
    // small enough to live in the wizard's clearing useEffect, and the
    // wired path is covered by the visibility / serializer / Zod helper
    // unit tests. We deliberately don't add a wizard-level test for it
    // here — driving the CategoryPicker through the picker's "Selected"
    // → re-pick UI is brittle and the marginal coverage is low.
  });

  describe('catalog product match (#635)', () => {
    /**
     * Same shape as the parameters fixture in the #410 block, but the EAN
     * field is unrestricted so the catalog value passes through unchanged
     * and we can assert it was lifted from the catalog response (not the
     * variant fallback). Adding a `Marka` row gives us a parameter that
     * isn't already covered by `autoPrefillParameters`, so the
     * "{N} fields auto-filled" count is unambiguous.
     */
    const catalogParametersFixture: CategoryParameter[] = [
      {
        id: 'p_marka',
        name: 'Marka',
        type: 'dictionary',
        required: true,
        dictionary: [
          { id: 'p_marka_canon', value: 'Canon' },
          { id: 'p_marka_nikon', value: 'Nikon' },
        ],
        restrictions: {},
        section: 'product',
      },
    ];

    it('shows the linked panel and prefills product-section parameters on a unique catalog match', async () => {
      const findProductsByBarcode = vi.fn().mockResolvedValue({
        kind: 'unique',
        product: {
          id: 'cat-1',
          name: 'Canon EOS R5',
          ean: '5901234567890',
          parameters: [
            { parameterId: 'p_marka', name: 'Marka', valueIds: ['p_marka_canon'] },
          ],
        },
      });
      const mockApi = defaultMocks({
        listings: {
          findProductsByBarcode,
          getCategoryParameters: vi.fn().mockResolvedValue({ parameters: catalogParametersFixture }),
        },
      });

      renderWithProviders(
        <AllegroCreateOfferWizard
          connection={allegroConnection}
          onCancel={vi.fn()}
          onSubmitted={vi.fn()}
        />,
        { apiClient: mockApi },
      );

      await advanceToStep2();
      await pickFirstLeafCategory();
      fireEvent.change(screen.getByLabelText(/^price$/i), { target: { value: '99.99' } });
      fireEvent.change(screen.getByLabelText(/^stock$/i), { target: { value: '5' } });
      fireEvent.click(screen.getByRole('button', { name: /next/i }));

      // Catalog lookup fires once category + EAN are both known.
      await waitFor(() =>
        expect(findProductsByBarcode).toHaveBeenCalledWith(
          allegroConnection.id,
          expect.objectContaining({ barcode: '5901234567890', categoryId: '12345' }),
        ),
      );

      // Linked panel renders + 1 field auto-filled.
      expect(await screen.findByText('Canon EOS R5')).toBeInTheDocument();
      expect(await screen.findByText(/1 field auto-filled/)).toBeInTheDocument();

      // The Marka dictionary is now set to the catalog value.
      const markaSelect = screen.getByLabelText<HTMLSelectElement>(/^marka$/i);
      await waitFor(() => expect(markaSelect.value).toBe('p_marka_canon'));
    });

    it('transitions to the unlinked branch on Unlink and exposes Relink', async () => {
      const findProductsByBarcode = vi.fn().mockResolvedValue({
        kind: 'unique',
        product: {
          id: 'cat-1',
          name: 'Canon EOS R5',
          parameters: [
            { parameterId: 'p_marka', name: 'Marka', valueIds: ['p_marka_canon'] },
          ],
        },
      });
      const mockApi = defaultMocks({
        listings: {
          findProductsByBarcode,
          getCategoryParameters: vi.fn().mockResolvedValue({ parameters: catalogParametersFixture }),
        },
      });

      renderWithProviders(
        <AllegroCreateOfferWizard
          connection={allegroConnection}
          onCancel={vi.fn()}
          onSubmitted={vi.fn()}
        />,
        { apiClient: mockApi },
      );

      await advanceToStep2();
      await pickFirstLeafCategory();
      fireEvent.change(screen.getByLabelText(/^price$/i), { target: { value: '99.99' } });
      fireEvent.change(screen.getByLabelText(/^stock$/i), { target: { value: '5' } });
      fireEvent.click(screen.getByRole('button', { name: /next/i }));

      const markaSelect = await screen.findByLabelText<HTMLSelectElement>(/^marka$/i);
      await waitFor(() => expect(markaSelect.value).toBe('p_marka_canon'));

      fireEvent.click(await screen.findByRole('button', { name: /unlink/i }));

      // Panel transitions to the unlinked branch and offers Relink. The
      // parameter-revert path itself is covered by the
      // `prefillFromCatalogProduct` unit tests; here we only assert the UX
      // contract — the panel state changes — because RHF's `Controller`
      // does not reliably re-render off a parent-object `setValue` in
      // JSDOM without a Tab/blur event, which is not a real user gesture
      // we want to depend on in this test.
      expect(await screen.findByRole('button', { name: /relink/i })).toBeInTheDocument();
      expect(screen.getByText(/unlinked/i)).toBeInTheDocument();
    });

    it('renders the ambiguous branch and prefills after the operator picks a product', async () => {
      const findProductsByBarcode = vi.fn().mockResolvedValue({
        kind: 'ambiguous',
        products: [
          { id: 'cat-1', name: 'Canon EOS R5' },
          { id: 'cat-2', name: 'Canon EOS R6' },
        ],
      });
      const getCatalogProduct = vi.fn().mockResolvedValue({
        id: 'cat-2',
        name: 'Canon EOS R6',
        parameters: [
          { parameterId: 'p_marka', name: 'Marka', valueIds: ['p_marka_canon'] },
        ],
      });
      const mockApi = defaultMocks({
        listings: {
          findProductsByBarcode,
          getCatalogProduct,
          getCategoryParameters: vi.fn().mockResolvedValue({ parameters: catalogParametersFixture }),
        },
      });

      renderWithProviders(
        <AllegroCreateOfferWizard
          connection={allegroConnection}
          onCancel={vi.fn()}
          onSubmitted={vi.fn()}
        />,
        { apiClient: mockApi },
      );

      await advanceToStep2();
      await pickFirstLeafCategory();
      fireEvent.change(screen.getByLabelText(/^price$/i), { target: { value: '99.99' } });
      fireEvent.change(screen.getByLabelText(/^stock$/i), { target: { value: '5' } });
      fireEvent.click(screen.getByRole('button', { name: /next/i }));

      // Ambiguous header renders, the picked product isn't fetched yet.
      expect(
        await screen.findByText(/multiple allegro catalog products match/i),
      ).toBeInTheDocument();
      expect(getCatalogProduct).not.toHaveBeenCalled();

      fireEvent.click(screen.getByText('Canon EOS R6'));

      await waitFor(() =>
        expect(getCatalogProduct).toHaveBeenCalledWith(allegroConnection.id, 'cat-2'),
      );

      // Marka is filled from the picked catalog product.
      const markaSelect = screen.getByLabelText<HTMLSelectElement>(/^marka$/i);
      await waitFor(() => expect(markaSelect.value).toBe('p_marka_canon'));
    });

    it('dismisses the ambiguous picker on Skip', async () => {
      const findProductsByBarcode = vi.fn().mockResolvedValue({
        kind: 'ambiguous',
        products: [
          { id: 'cat-1', name: 'Canon EOS R5' },
          { id: 'cat-2', name: 'Canon EOS R6' },
        ],
      });
      const mockApi = defaultMocks({
        listings: {
          findProductsByBarcode,
          getCategoryParameters: vi.fn().mockResolvedValue({ parameters: catalogParametersFixture }),
        },
      });

      renderWithProviders(
        <AllegroCreateOfferWizard
          connection={allegroConnection}
          onCancel={vi.fn()}
          onSubmitted={vi.fn()}
        />,
        { apiClient: mockApi },
      );

      await advanceToStep2();
      await pickFirstLeafCategory();
      fireEvent.change(screen.getByLabelText(/^price$/i), { target: { value: '99.99' } });
      fireEvent.change(screen.getByLabelText(/^stock$/i), { target: { value: '5' } });
      fireEvent.click(screen.getByRole('button', { name: /next/i }));

      // Ambiguous picker visible.
      const ambiguousHeader = await screen.findByText(
        /multiple allegro catalog products match/i,
      );
      expect(ambiguousHeader).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /skip/i }));

      // Picker is gone; parameters step still works.
      await waitFor(() =>
        expect(screen.queryByText(/multiple allegro catalog products match/i)).not.toBeInTheDocument(),
      );
      expect(screen.queryByRole('button', { name: /skip/i })).not.toBeInTheDocument();
      expect(screen.getByLabelText(/^marka$/i)).toBeInTheDocument();
    });

    it('does not render the panel when the catalog returns no_match', async () => {
      // defaultMocks already sets findProductsByBarcode → { kind: 'no_match' }.
      const mockApi = defaultMocks({
        listings: {
          getCategoryParameters: vi.fn().mockResolvedValue({ parameters: catalogParametersFixture }),
        },
      });

      renderWithProviders(
        <AllegroCreateOfferWizard
          connection={allegroConnection}
          onCancel={vi.fn()}
          onSubmitted={vi.fn()}
        />,
        { apiClient: mockApi },
      );

      await advanceToStep2();
      await pickFirstLeafCategory();
      fireEvent.change(screen.getByLabelText(/^price$/i), { target: { value: '99.99' } });
      fireEvent.change(screen.getByLabelText(/^stock$/i), { target: { value: '5' } });
      fireEvent.click(screen.getByRole('button', { name: /next/i }));

      // Marka is rendered (parameters step is live), but the catalog panel is not.
      await screen.findByLabelText(/^marka$/i);
      expect(screen.queryByText(/multiple allegro catalog products/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/matched to allegro catalog product/i)).not.toBeInTheDocument();
    });
  });

  describe('AI suggest (#637)', () => {
    const suggestResult = {
      suggestion: 'AI copy',
      requestId: 'req-1',
      templateKey: 'offer.description.suggest',
      templateVersion: 1,
      templateChannel: 'allegro' as const,
      modelUsed: 'fake',
      latencyMs: 0,
      usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
    };

    it('renders the Suggest button on Step 2 once a variant has been picked on Step 1', async () => {
      const mockApi = defaultMocks();
      renderWithProviders(
        <AllegroCreateOfferWizard
          connection={allegroConnection}
          onCancel={vi.fn()}
          onSubmitted={vi.fn()}
        />,
        { apiClient: mockApi },
      );

      await advanceToStep2();
      expect(screen.getByRole('button', { name: /suggest with ai/i })).toBeInTheDocument();
    });

    // Note: this test does not assert the `shouldDirty: true` flag that the
    // implementation passes to `setValue('description', …)`. The wizard's
    // only dirty-state consumer is the `beforeunload` handler, which isn't
    // user-fireable in JSDOM, and Next-button validation on Step 2 ignores
    // the description field — so `shouldDirty`/`shouldValidate` have no
    // user-visible side effect at the point of apply. Verifying the value
    // gets written + the suggest call shape is what's reachable.
    it('writes the suggestion into the description field when applied', async () => {
      const suggest = vi.fn().mockResolvedValue(suggestResult);
      const mockApi = defaultMocks({ content: { suggest } });
      renderWithProviders(
        <AllegroCreateOfferWizard
          connection={allegroConnection}
          onCancel={vi.fn()}
          onSubmitted={vi.fn()}
        />,
        // Authenticated (admin) session — the "Suggest with AI" trigger is
        // gated on the `ai:suggest` permission (#1379 re-scope), not demo mode.
        { apiClient: mockApi, sessionAdapter: createAuthenticatedSessionAdapter() },
      );

      await advanceToStep2();

      // Session hydration is async — the trigger renders locked until the
      // authenticated (admin) session resolves.
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /suggest with ai/i })).toBeEnabled(),
      );
      fireEvent.click(screen.getByRole('button', { name: /suggest with ai/i }));
      fireEvent.click(await screen.findByRole('button', { name: /^generate$/i }));
      fireEvent.click(await screen.findByRole('button', { name: /apply to editor/i }));

      await waitFor(() => {
        expect(screen.getByLabelText(/description/i)).toHaveValue('AI copy');
      });
      // suggest endpoint was called with the picked product id + resolved channel.
      expect(suggest).toHaveBeenCalledWith(
        product.id,
        expect.objectContaining({ channel: 'allegro' }),
      );
    });

    it('shows a missing-variant hint on Step 2 when mounted via retry initialValues', async () => {
      const initialRequest: CreateOfferRequest = {
        internalVariantId: 'ol_variant_aaaaaaaa',
        stock: 5,
        publishImmediately: false,
        price: { amount: 99.99, currency: 'PLN' },
        overrides: {
          title: 'Original Title',
          categoryId: '12345',
          description: null,
          platformParams: { deliveryPolicyId: 'del-1' },
        },
      };
      const mockApi = defaultMocks();
      renderWithProviders(
        <AllegroCreateOfferWizard
          connection={allegroConnection}
          onCancel={vi.fn()}
          initialValues={initialRequest}
          onSubmitted={vi.fn()}
        />,
        { apiClient: mockApi },
      );

      // Wizard lands on Step 2 (Offer details) — wait for the title input,
      // same way the existing retry-flow tests do.
      await screen.findByLabelText(/^title$/i);

      expect(
        screen.queryByRole('button', { name: /suggest with ai/i }),
      ).not.toBeInTheDocument();
      expect(screen.getByText(/picked variant/i)).toBeInTheDocument();
    });
  });

  describe('Step 2 category auto-prefill (#632)', () => {
    // Two-leaf tree used by the user-override test below; reused for the
    // single-leaf scenarios to keep the auto-fill target stable across cases.
    const resolvedLeaf = {
      id: 'cat-42',
      name: 'Resolved leaf',
      parentId: null,
      leaf: true,
    } as const;
    const otherLeaf = {
      id: 'cat-99',
      name: 'Other leaf',
      parentId: null,
      leaf: true,
    } as const;

    it('auto_detect resolution pre-selects the picker and renders an EAN hint', async () => {
      const mockApi = defaultMocks({
        mappings: {
          getAllegroCategories: vi.fn().mockResolvedValue([resolvedLeaf]),
        },
        listings: {
          resolveCategory: vi.fn().mockResolvedValue({
            allegroCategoryId: 'cat-42',
            method: 'auto_detect',
          }),
        },
      });

      renderWithProviders(
        <AllegroCreateOfferWizard
          connection={allegroConnection}
          onCancel={vi.fn()}
          onSubmitted={vi.fn()}
        />,
        { apiClient: mockApi },
      );

      await advanceToStep2();

      // Picker exposes the auto-selected leaf via the "Selected" button —
      // same affordance the existing `pickFirstLeafCategory()` helper waits
      // on after a manual click.
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /^selected$/i })).toBeInTheDocument(),
      );
      // Hint copy includes the picked variant's EAN; the regex match keeps
      // the assertion resilient to trailing punctuation changes.
      expect(
        screen.getByText(/Matched from EAN 5901234567890/i),
      ).toBeInTheDocument();
      // Sanity check: the BE was called with the variant's EAN and no
      // sourceCategoryIds (the wizard doesn't plumb them today).
      expect(mockApi.listings.resolveCategory).toHaveBeenCalledWith(
        allegroConnection.id,
        { barcode: '5901234567890', sourceCategoryIds: undefined },
      );
    });

    it('category_mapping resolution renders the mapping-attribution hint copy', async () => {
      const mockApi = defaultMocks({
        mappings: {
          getAllegroCategories: vi
            .fn()
            .mockResolvedValue([{ ...resolvedLeaf, id: 'cat-7', name: 'Mapped leaf' }]),
        },
        listings: {
          resolveCategory: vi.fn().mockResolvedValue({
            allegroCategoryId: 'cat-7',
            method: 'category_mapping',
          }),
        },
      });

      renderWithProviders(
        <AllegroCreateOfferWizard
          connection={allegroConnection}
          onCancel={vi.fn()}
          onSubmitted={vi.fn()}
        />,
        { apiClient: mockApi },
      );

      await advanceToStep2();

      await waitFor(() =>
        expect(screen.getByRole('button', { name: /^selected$/i })).toBeInTheDocument(),
      );
      // category_mapping copy must NOT mention the EAN — the attribution is
      // the configured mapping, not the barcode.
      expect(
        screen.getByText(/Matched from configured category mapping/i),
      ).toBeInTheDocument();
      expect(screen.queryByText(/Matched from EAN/i)).not.toBeInTheDocument();
    });

    it('manual outcome leaves the picker empty and renders no hint', async () => {
      // Uses the test-utils default (resolveCategory → null/manual). The
      // picker stays at its empty value; no "Matched from" copy renders.
      const mockApi = defaultMocks();

      renderWithProviders(
        <AllegroCreateOfferWizard
          connection={allegroConnection}
          onCancel={vi.fn()}
          onSubmitted={vi.fn()}
        />,
        { apiClient: mockApi },
      );

      await advanceToStep2();

      // Browser is up and the single leaf row's button still reads "Select"
      // (i.e., nothing was auto-selected).
      await screen.findByRole('button', { name: /^select$/i });
      expect(
        screen.queryByRole('button', { name: /^selected$/i }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(/Matched from/i)).not.toBeInTheDocument();
    });

    it('respects an operator override — no re-prefill, hint hidden', async () => {
      const mockApi = defaultMocks({
        mappings: {
          getAllegroCategories: vi.fn().mockResolvedValue([resolvedLeaf, otherLeaf]),
        },
        listings: {
          resolveCategory: vi.fn().mockResolvedValue({
            allegroCategoryId: 'cat-42',
            method: 'auto_detect',
          }),
        },
      });

      renderWithProviders(
        <AllegroCreateOfferWizard
          connection={allegroConnection}
          onCancel={vi.fn()}
          onSubmitted={vi.fn()}
        />,
        { apiClient: mockApi },
      );

      await advanceToStep2();

      // Wait for the auto-prefill to land (cat-42 becomes "Selected").
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /^selected$/i })).toBeInTheDocument(),
      );
      expect(screen.getByText(/Matched from EAN/i)).toBeInTheDocument();

      // Now the operator picks the OTHER leaf. `<li>` rows have no accessible
      // name attribute — locate each row by its visible name text, then walk
      // up to the `<li>` ancestor so within() can scope the button query.
      const otherRow = (await screen.findByText('Other leaf')).closest('li');
      if (!otherRow) throw new Error('Other leaf <li> not found');
      const otherSelect = within(otherRow as HTMLElement).getByRole('button', {
        name: /^select$/i,
      });
      fireEvent.click(otherSelect);

      // After the override: cat-99 is selected, cat-42 reverts to "Select",
      // and the hint disappears because data.allegroCategoryId no longer
      // matches the form value.
      await waitFor(() => {
        const otherRowAfter = screen.getByText('Other leaf').closest('li');
        if (!otherRowAfter) throw new Error('Other leaf <li> not found');
        expect(
          within(otherRowAfter as HTMLElement).getByRole('button', { name: /^selected$/i }),
        ).toBeInTheDocument();
      });
      const resolvedRow = screen.getByText('Resolved leaf').closest('li');
      if (!resolvedRow) throw new Error('Resolved leaf <li> not found');
      expect(
        within(resolvedRow as HTMLElement).getByRole('button', { name: /^select$/i }),
      ).toBeInTheDocument();
      expect(screen.queryByText(/Matched from/i)).not.toBeInTheDocument();
    });
  });

  describe('demo read-only viewer (#1663)', () => {
    it('reaches the Review step with every field editable but disables the final Create offer submit', async () => {
      const createOffer = vi.fn();
      const mockApi = defaultMocks({
        listings: { createOffer, getSellerPolicies: vi.fn().mockResolvedValue(policies) },
        system: { getConfig: vi.fn().mockResolvedValue({ demoMode: true }) },
      });

      renderWithProviders(
        <AllegroCreateOfferWizard
          connection={allegroConnection}
          onCancel={vi.fn()}
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

      const deliverySelect = await screen.findByLabelText(/delivery policy/i);
      fireEvent.change(deliverySelect, { target: { value: 'del-1' } });
      fireEvent.click(screen.getByRole('button', { name: /next/i }));

      // Review step reached — the wizard was fully walkable in demo mode.
      const submitButton = await screen.findByRole('button', { name: /create offer/i });
      expect(submitButton).toBeDisabled();

      fireEvent.click(submitButton);
      expect(createOffer).not.toHaveBeenCalled();
    });
  });
});
