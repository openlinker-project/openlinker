/**
 * Bundle form (#3624). The things an operator can get wrong are asserted by
 * what they READ: the refusal for nesting, the unknown-availability sentence
 * (never a zero), the gift mark landing on the saved definition, and a viewer
 * who sees everything and can change nothing.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useLocation } from 'react-router-dom';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../../test/test-utils';
import { ApiError } from '../../../shared/api/api-error';
import type { Product, ProductVariant } from '../../products';
import type { BundleDetail } from '../api/bundles.types';
import { BundleForm } from './bundle-form';

function variant(id: string, sku: string, price: number): ProductVariant {
  return {
    id,
    productId: `p-${id}`,
    sku,
    attributes: null,
    ean: null,
    gtin: null,
    price,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    isStale: false,
    staleAt: null,
  };
}

function product(
  id: string,
  name: string,
  sku: string,
  price: number,
  over: Partial<Product> = {}
): Product {
  return {
    id: `p-${id}`,
    name,
    sku,
    price,
    currency: 'PLN',
    description: null,
    images: null,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    variants: [variant(id, sku, price)],
    availableToPromise: 10,
    variantCount: 1,
    ...over,
  } as Product;
}

const MUG = product('mug', 'Kubek ceramiczny', 'KUB-350-BI', 40);
const COFFEE = product('coffee', 'Kawa ziarnista', 'KAW-250-ETI', 35, { availableToPromise: 128 });
const SPOON = product('spoon', 'Lyzeczka', 'LYZ-KAW', 15, { availableToPromise: 1 });
const SET = product('set', 'Zestaw poranny', 'ZES-PORANNY', 65);
const OTHER_BUNDLE = product('bundle2', 'Zestaw do parzenia', 'ZES-PARZENIE', 139, {
  bundle: { variantId: 'bundle2', componentCount: 2, limitedBy: null, unknownComponent: null },
});
const ALL = [MUG, COFFEE, SPOON, SET, OTHER_BUNDLE];

function api(over: { bundles?: Record<string, unknown>; products?: Record<string, unknown> } = {}) {
  return createMockApiClient({
    products: {
      listRows: vi.fn().mockImplementation(async (filters: { search?: string }) => ({
        items: ALL.filter(
          (p) =>
            p.name.toLowerCase().includes((filters.search ?? '').toLowerCase()) ||
            (p.sku ?? '').toLowerCase() === (filters.search ?? '').toLowerCase()
        ),
        limit: 8,
        offset: 0,
      })),
      getById: vi.fn().mockImplementation(async (id: string) => ALL.find((p) => p.id === id)),
      getVariant: vi.fn(),
      ...over.products,
    },
    inventory: {
      availability: vi.fn().mockResolvedValue({ items: [] }),
    },
    bundles: {
      creationTargets: vi.fn().mockResolvedValue([]),
      create: vi
        .fn()
        .mockResolvedValue({ variantId: 'set', version: 1, components: [], releasedOrders: 0 }),
      update: vi.fn().mockResolvedValue({ variantId: 'set', version: 2, components: [] }),
      ...over.bundles,
    },
  });
}

const VIEWER = {
  id: 'u2',
  username: 'viewer',
  email: null,
  role: 'viewer',
  permissions: ['products:read'],
  analyticsConsent: true,
} as const;

function LocationProbe() {
  return <span data-testid="location-probe">{useLocation().pathname}</span>;
}

function LocationSearchProbe(): ReactElement {
  return <span data-testid="location-search-probe">{useLocation().search}</span>;
}

async function ready(): Promise<void> {
  // The session resolves after the first paint; until then the form is read-only.
  await waitFor(() => {
    expect(screen.getByTestId('bundle-form-component-search')).toBeEnabled();
  });
}

async function pick(
  user: ReturnType<typeof userEvent.setup>,
  testId: string,
  text: string,
  sku: string
): Promise<void> {
  await user.type(screen.getByTestId(testId), text);
  await user.click(await screen.findByTestId(`${testId}-result-${sku}`, undefined, { timeout: 5000 }));
}

/** Leaves the components step and opens the product step. */
async function toProductStep(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  // One product in a quantity of one is not a bundle, so a lone component is made a x2 pack first.
  const pack = screen.queryByTestId('bundle-form-multipack-2');
  if (pack !== null) await user.click(pack);
  await user.click(screen.getByTestId('bundle-form-next'));
  await screen.findByTestId('bundle-form-step-product');
}

/** From the product step to the last one, where Save lives. */
async function toReview(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByTestId('bundle-form-next'));
  await screen.findByTestId('bundle-form-step-gifts');
  await user.click(screen.getByTestId('bundle-form-next'));
  await screen.findByTestId('bundle-form-step-review');
}

async function pickProduct(
  user: ReturnType<typeof userEvent.setup>,
  text: string,
  sku: string
): Promise<void> {
  await user.type(screen.getByTestId('bundle-form-product-search'), text);
  await user.click(await screen.findByTestId(`bundle-form-product-search-result-${sku}`));
}

describe('BundleForm (#3624)', () => {
  it('should save a new bundle with the gift mark on the component it was set on', async () => {
    const apiClient = api();
    const user = userEvent.setup();
    renderWithProviders(<BundleForm />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });
    await ready();

    await pick(user, 'bundle-form-component-search', 'Kubek', 'KUB-350-BI');
    await pick(user, 'bundle-form-component-search', 'Lyz', 'LYZ-KAW');
    await user.click(await screen.findByTestId('bundle-form-component-toggle-gift-LYZ-KAW'));
    expect(screen.getByTestId('bundle-form-component-gift-LYZ-KAW')).toBeInTheDocument();

    await toProductStep(user);
    await pickProduct(user, 'Zestaw poranny', 'ZES-PORANNY');
    expect(screen.getByTestId('bundle-form-sku')).toHaveTextContent('ZES-PORANNY');
    await toReview(user);
    await user.click(screen.getByTestId('bundle-form-save'));

    await waitFor(() => {
      expect(apiClient.bundles.create).toHaveBeenCalledWith('set', [
        { variantId: 'mug', quantity: 1 },
        { variantId: 'spoon', quantity: 1, giftSlot: true },
      ]);
    });
    expect(await screen.findByTestId('bundle-form-saved-alert')).toBeInTheDocument();
    expect(screen.getByTestId('bundle-form-list-offer')).toHaveAttribute(
      'href',
      expect.stringContaining('variantIds=set')
    );
  });

  it('should say which component limits the bundle in one line', async () => {
    const user = userEvent.setup();
    renderWithProviders(<BundleForm />, {
      apiClient: api(),
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });
    await ready();
    await pick(user, 'bundle-form-component-search', 'Kubek', 'KUB-350-BI');
    await pick(user, 'bundle-form-component-search', 'Lyz', 'LYZ-KAW');
    expect(screen.getByTestId('bundle-form-availability')).toHaveTextContent(
      'Lowest stock: Lyzeczka'
    );
  });

  it('should read an unknown component as unknown availability, never zero', async () => {
    const unknownMug = product('mug', 'Kubek ceramiczny', 'KUB-350-BI', 40, {
      availableToPromise: null,
    });
    const apiClient = api({
      products: {
        listRows: vi.fn().mockResolvedValue({ items: [unknownMug], limit: 8, offset: 0 }),
        getById: vi.fn().mockResolvedValue(unknownMug),
      },
    });
    const user = userEvent.setup();
    renderWithProviders(<BundleForm />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });
    await ready();
    await pick(user, 'bundle-form-component-search', 'Kubek', 'KUB-350-BI');
    const line = screen.getByTestId('bundle-form-availability');
    expect(line).toHaveTextContent('Availability unknown');
    expect(line).not.toHaveTextContent('0 pcs');
  });

  it('should refuse a bundle as a component inline and not add it', async () => {
    const user = userEvent.setup();
    renderWithProviders(<BundleForm />, {
      apiClient: api(),
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });
    await ready();
    await pick(user, 'bundle-form-component-search', 'Zestaw do', 'ZES-PARZENIE');
    // The row says why it cannot be added up front; clicking it explains under the search.
    expect(
      await screen.findByTestId('bundle-form-component-search-why-ZES-PARZENIE')
    ).toHaveTextContent('bundle cannot be a component');
    expect(await screen.findByTestId('bundle-form-component-search-rejection')).toHaveTextContent(
      'Zestaw do parzenia'
    );
    expect(screen.queryByTestId('bundle-form-component-row-ZES-PARZENIE')).not.toBeInTheDocument();
  });

  it('should move to the edit route after creating, so a second Save is an update', async () => {
    const apiClient = api();
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <BundleForm />
        <LocationProbe />
      </>,
      { apiClient, sessionAdapter: createAuthenticatedSessionAdapter() }
    );
    await ready();
    await pick(user, 'bundle-form-component-search', 'Kubek', 'KUB-350-BI');
    await toProductStep(user);
    await pickProduct(user, 'Zestaw poranny', 'ZES-PORANNY');
    await toReview(user);
    await user.click(screen.getByTestId('bundle-form-save'));
    await waitFor(() => {
      expect(screen.getByTestId('location-probe')).toHaveTextContent('/products/bundles/set');
    });
  });

  it.each([
    [409, 'already exists or was changed'],
    [400, 'not valid'],
    [404, 'no longer exists'],
    [500, 'could not be saved'],
    [0, 'could not be saved'],
  ])('should say so when the save fails with status %s', async (status, text) => {
    const apiClient = api({
      bundles: {
        create: vi.fn().mockRejectedValue(new ApiError('nope', status, { code: 'OTHER' })),
      },
    });
    const user = userEvent.setup();
    renderWithProviders(<BundleForm />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });
    await ready();
    await pick(user, 'bundle-form-component-search', 'Kubek', 'KUB-350-BI');
    await toProductStep(user);
    await pickProduct(user, 'Zestaw poranny', 'ZES-PORANNY');
    await toReview(user);
    await user.click(screen.getByTestId('bundle-form-save'));
    expect(await screen.findByTestId('bundle-form-save-error')).toHaveTextContent(text);
  });

  it('should let an operator (bundles:write, no products:write) save', async () => {
    const apiClient = api();
    renderWithProviders(<BundleForm />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter({
        id: 'u3',
        username: 'op',
        email: null,
        role: 'operator',
        permissions: ['products:read', 'bundles:write'],
        analyticsConsent: true,
      }),
    });
    await ready();
    expect(screen.queryByTestId('bundle-form-readonly-notice')).toBeNull();
  });

  it('should not say Saving... while the bundle is loading', () => {
    const apiClient = api({
      bundles: { get: vi.fn().mockReturnValue(new Promise(() => undefined)) },
    });
    renderWithProviders(<BundleForm bundleVariantId="set" />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });
    expect(screen.getByText('Loading the bundle...')).toBeInTheDocument();
    expect(screen.queryByText('Saving...')).toBeNull();
  });

  it('should show the refusal the server sends when nesting is caught on save', async () => {
    const apiClient = api({
      bundles: {
        create: vi
          .fn()
          .mockRejectedValue(
            new ApiError('refused', 409, {
              code: 'BUNDLE_NESTING_REFUSED',
              reason: 'variant-is-component',
            })
          ),
      },
    });
    const user = userEvent.setup();
    renderWithProviders(<BundleForm />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });
    await ready();
    await pick(user, 'bundle-form-component-search', 'Kubek', 'KUB-350-BI');
    await toProductStep(user);
    await pickProduct(user, 'Zestaw poranny', 'ZES-PORANNY');
    await toReview(user);
    await user.click(screen.getByTestId('bundle-form-save'));
    expect(await screen.findByTestId('bundle-form-nested-error')).toHaveTextContent(
      'already a component'
    );
  });

  it('should show the price split only on demand, and say when a price is missing', async () => {
    const noPrice = product('mug', 'Kubek ceramiczny', 'KUB-350-BI', 40, {
      price: null,
      variants: [{ ...variant('mug', 'KUB-350-BI', 40), price: null }],
    });
    const apiClient = api({
      products: {
        listRows: vi.fn().mockImplementation(async (f: { search?: string }) => ({
          items: [SET, COFFEE, noPrice].filter((p) =>
            p.name.toLowerCase().includes((f.search ?? '').toLowerCase())
          ),
          limit: 8,
          offset: 0,
        })),
        getById: vi
          .fn()
          .mockImplementation(async (id: string) =>
            [SET, COFFEE, noPrice].find((p) => p.id === id)
          ),
      },
    });
    const user = userEvent.setup();
    renderWithProviders(<BundleForm />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });
    await ready();
    await pick(user, 'bundle-form-component-search', 'Kawa', 'KAW-250-ETI');
    await toProductStep(user);
    await pickProduct(user, 'Zestaw poranny', 'ZES-PORANNY');
    await toReview(user);
    expect(screen.queryByTestId('bundle-form-price-split')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Show price split/ }));
    const split = screen.getByTestId('bundle-form-price-split');
    expect(within(split).getByTestId('bundle-form-price-split-line-KAW-250-ETI')).toHaveTextContent(
      '65'
    );

    // Back to the components step to add the one with no price.
    await user.click(screen.getByTestId('bundle-form-stepper-button-1'));
    await screen.findByTestId('bundle-form-step-components');
    await pick(user, 'bundle-form-component-search', 'Kubek', 'KUB-350-BI');
    await toProductStep(user);
    await toReview(user);
    await user.click(screen.getByRole('button', { name: /Show price split|Hide price split/ }));
    expect(await screen.findByTestId('bundle-form-price-share-alert')).toHaveTextContent(
      'has no price'
    );
  });

  it('should write the next version when editing, and say how many open orders keep the old one', async () => {
    const detail: BundleDetail = {
      variantId: 'set',
      version: 2,
      bundle: {
        name: 'Zestaw poranny',
        sku: 'ZES-PORANNY',
        price: 65,
        currency: 'PLN',
        imageUrl: null,
      },
      openOrdersOnOlderComposition: 3,
      bundlesAvailable: 1,
      composedByMaster: null,
      productId: 'p-set',
      components: [],
      componentAvailability: [
        {
          variantId: 'mug',
          productId: 'p-mug',
          quantity: 1,
          summary: {
            name: 'Kubek ceramiczny',
            sku: 'KUB-350-BI',
            price: 40,
            currency: 'PLN',
            imageUrl: null,
          },
          availableToPromise: 78,
          bundlesSupported: 78,
        },
      ],
    };
    const apiClient = api({ bundles: { get: vi.fn().mockResolvedValue(detail) } });
    const user = userEvent.setup();
    renderWithProviders(<BundleForm bundleVariantId="set" />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    expect(await screen.findByTestId('bundle-form-component-row-KUB-350-BI')).toBeInTheDocument();
    expect(screen.getByTestId('bundle-form-open-orders-note')).toHaveTextContent(
      /3 open orders/
    );
    // Nothing changed yet, so there is nothing to save.
    expect(screen.getByTestId('bundle-form-save')).toBeDisabled();
    const qty = screen.getByTestId('bundle-form-component-qty-KUB-350-BI');
    await user.clear(qty);
    await user.type(qty, '2');
    await user.click(screen.getByTestId('bundle-form-save'));
    await waitFor(() => {
      expect(apiClient.bundles.update).toHaveBeenCalledWith('set', [
        { variantId: 'mug', quantity: 2 },
      ]);
    });
    expect(apiClient.bundles.create).not.toHaveBeenCalled();
    // The list-offer link has the product id of the bundle, read from the detail.
    expect(await screen.findByTestId('bundle-form-list-offer')).toHaveAttribute(
      'href',
      expect.stringContaining('productIds=p-set')
    );
  });

  describe('sync composition from the master (#3932)', () => {
    const baseDetail: BundleDetail = {
      variantId: 'set',
      version: 2,
      bundle: {
        name: 'Zestaw poranny',
        sku: 'ZES-PORANNY',
        price: 65,
        currency: 'PLN',
        imageUrl: null,
      },
      openOrdersOnOlderComposition: 0,
      bundlesAvailable: 1,
      composedByMaster: null,
      productId: 'p-set',
      components: [],
      componentAvailability: [],
    };

    it('should not offer the action when no master can read bundles', async () => {
      const apiClient = api({ bundles: { get: vi.fn().mockResolvedValue(baseDetail) } });
      renderWithProviders(<BundleForm bundleVariantId="set" />, {
        apiClient,
        sessionAdapter: createAuthenticatedSessionAdapter(),
      });
      expect(await screen.findByTestId('bundle-form')).toBeInTheDocument();
      expect(screen.queryByTestId('bundle-form-sync-from-master')).not.toBeInTheDocument();
    });

    it('should call the sync endpoint only when the operator clicks', async () => {
      const detail: BundleDetail = {
        ...baseDetail,
        composedByMaster: { connectionId: 'c1', connectionName: 'PrestaShop' },
      };
      const syncFromMaster = vi
        .fn()
        .mockResolvedValue({ variantId: 'set', version: 3, components: [] });
      const apiClient = api({
        bundles: { get: vi.fn().mockResolvedValue(detail), syncFromMaster },
      });
      const user = userEvent.setup();
      renderWithProviders(<BundleForm bundleVariantId="set" />, {
        apiClient,
        sessionAdapter: createAuthenticatedSessionAdapter(),
      });
      const button = await screen.findByTestId('bundle-form-sync-from-master');
      expect(button).toHaveTextContent('Sync composition from PrestaShop');
      expect(syncFromMaster).not.toHaveBeenCalled();
      await user.click(button);
      await waitFor(() => {
        expect(syncFromMaster).toHaveBeenCalledWith('set');
      });
    });
  });

  it('should list the history newest first, with the open orders on each version', async () => {
    const detail: BundleDetail = {
      variantId: 'set',
      version: 2,
      bundle: {
        name: 'Zestaw poranny',
        sku: 'ZES-PORANNY',
        price: 65,
        currency: 'PLN',
        imageUrl: null,
      },
      openOrdersOnOlderComposition: 0,
      bundlesAvailable: 1,
      composedByMaster: null,
      productId: 'p-set',
      components: [],
      componentAvailability: [],
    };
    const apiClient = api({
      bundles: {
        get: vi.fn().mockResolvedValue(detail),
        history: vi.fn().mockResolvedValue([
          {
            variantId: 'set',
            version: 2,
            current: true,
            createdAt: '2026-11-02T10:00:00Z',
            openOrders: 0,
            components: [{ variantId: 'mug', productId: 'p-mug', quantity: 1 }],
            componentSummaries: [
              { name: 'Kubek', sku: 'KUB', price: 1, currency: 'PLN', imageUrl: null },
            ],
          },
          {
            variantId: 'set',
            version: 1,
            current: false,
            createdAt: '2026-10-02T10:00:00Z',
            openOrders: 3,
            components: [{ variantId: 'mug', productId: 'p-mug', quantity: 1 }],
            componentSummaries: [
              { name: 'Kubek', sku: 'KUB', price: 1, currency: 'PLN', imageUrl: null },
            ],
          },
        ]),
      },
    });
    renderWithProviders(<BundleForm bundleVariantId="set" />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });
    const first = await screen.findByTestId('bundle-form-history-entry-1');
    expect(first).toHaveTextContent('3 open orders have this composition');
    expect(screen.getByTestId('bundle-form-history-entry-2')).toBeInTheDocument();
  });

  it('should replace the create wizard with a notice and a way back for a viewer', async () => {
    renderWithProviders(<BundleForm />, {
      apiClient: api(),
      sessionAdapter: createAuthenticatedSessionAdapter({
        ...VIEWER,
        permissions: [...VIEWER.permissions],
      }),
    });
    await waitFor(() => {
      expect(screen.getByTestId('bundle-form-readonly-notice')).toHaveTextContent('Ask an administrator');
    });
    expect(screen.queryByTestId('bundle-form-save')).toBeNull();
    expect(screen.queryByTestId('bundle-form-component-search')).toBeNull();
    expect(screen.getByRole('link', { name: /products/i })).toHaveAttribute(
      'href',
      '/products?bundles=only'
    );
  });

  it('should name what is missing and focus the field when Next is refused', async () => {
    const user = userEvent.setup();
    renderWithProviders(<BundleForm />, {
      apiClient: api(),
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });
    await ready();
    const next = screen.getByTestId('bundle-form-next');
    expect(next).toHaveAttribute('aria-disabled', 'true');
    expect(next).toHaveAttribute('title', expect.stringContaining('at least one component'));
    await user.click(next);
    expect(screen.getByTestId('bundle-form-component-search')).toHaveFocus();
  });

  it('should put the step in the URL, move focus to its heading and announce it', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <BundleForm />
        <LocationSearchProbe />
      </>,
      { apiClient: api(), sessionAdapter: createAuthenticatedSessionAdapter() }
    );
    await ready();
    await pick(user, 'bundle-form-component-search', 'Kubek', 'KUB-350-BI');
    await toProductStep(user);
    expect(screen.getByTestId('location-search-probe')).toHaveTextContent('krok=product');
    await waitFor(() => {
      expect(screen.getByTestId('bundle-form-step-announce')).toHaveTextContent(/Step 2 of 4/);
    });
    expect(document.getElementById('bf-step-heading')).toHaveFocus();
    await user.click(screen.getByTestId('bundle-form-back'));
    await screen.findByTestId('bundle-form-step-components');
    expect(screen.getByTestId('location-search-probe')).toHaveTextContent('krok=components');
  });

  it('should explain a refused jump to a later step', async () => {
    const user = userEvent.setup();
    renderWithProviders(<BundleForm />, {
      apiClient: api(),
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });
    await ready();
    await pick(user, 'bundle-form-component-search', 'Kubek', 'KUB-350-BI');
    await toProductStep(user);
    await user.click(screen.getByTestId('bundle-form-back'));
    await user.clear(await screen.findByTestId('bundle-form-component-qty-KUB-350-BI'));
    await user.click(screen.getByTestId('bundle-form-stepper-button-2'));
    expect(await screen.findByTestId('bundle-form-blocked-note')).toHaveTextContent('step 1');
  });

  it('should not create the product twice when the composition write fails and is retried', async () => {
    const createProduct = vi.fn().mockResolvedValue({
      productId: 'p-new',
      variantId: 'new-variant',
      name: 'Zestaw nowy',
      sku: 'KUB-350-BI-SET',
      adopted: false,
    });
    const create = vi
      .fn()
      .mockRejectedValueOnce(new ApiError('nope', 500, {}))
      .mockResolvedValue({ variantId: 'new-variant', version: 1, components: [], releasedOrders: 0 });
    const apiClient = api({
      bundles: {
        creationTargets: vi.fn().mockResolvedValue([
          { connectionId: 'master-1', connectionName: 'PrestaShop', platformType: 'prestashop', creationMode: 'simple-product' },
        ]),
        createProduct,
        create,
      },
    });
    const user = userEvent.setup();
    renderWithProviders(<BundleForm />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });
    await ready();
    await pick(user, 'bundle-form-component-search', 'Kubek', 'KUB-350-BI');
    await toProductStep(user);
    await user.click(await screen.findByTestId('bundle-form-mode-create'));
    const nameInput = await screen.findByTestId('bundle-form-new-name');
    await user.clear(nameInput);
    await waitFor(() => {
      expect(screen.getByTestId('bundle-form-new-name')).toHaveValue('');
    });
    await user.type(screen.getByTestId('bundle-form-new-name'), 'Zestaw nowy');
    await toReview(user);
    await user.click(screen.getByTestId('bundle-form-save'));
    expect(await screen.findByTestId('bundle-form-partial-warning')).toHaveTextContent('Zestaw nowy');
    await user.click(screen.getByTestId('bundle-form-save'));
    await waitFor(() => {
      expect(create).toHaveBeenCalledTimes(2);
    });
    expect(createProduct).toHaveBeenCalledTimes(1);
  });

  it('should not leave the components step until there is a component with a valid quantity', async () => {
    const user = userEvent.setup();
    renderWithProviders(<BundleForm />, {
      apiClient: api(),
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });
    await ready();
    await user.click(screen.getByTestId('bundle-form-next'));
    expect(screen.getByTestId('bundle-form-step-components')).toBeInTheDocument();
    expect(screen.queryByTestId('bundle-form-step-product')).not.toBeInTheDocument();
  });

  it('should create the product at the master first, then write the composition on it', async () => {
    const createProduct = vi.fn().mockResolvedValue({
      productId: 'p-new',
      variantId: 'new-variant',
      name: 'Zestaw nowy',
      sku: 'KUB-350-BI-SET',
      adopted: false,
    });
    const apiClient = api({
      bundles: {
        creationTargets: vi.fn().mockResolvedValue([
          {
            connectionId: 'master-1',
            connectionName: 'PrestaShop',
            platformType: 'prestashop',
            creationMode: 'simple-product',
          },
        ]),
        createProduct,
      },
    });
    const user = userEvent.setup();
    renderWithProviders(<BundleForm />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });
    await ready();
    await pick(user, 'bundle-form-component-search', 'Kubek', 'KUB-350-BI');
    await toProductStep(user);
    await user.click(await screen.findByTestId('bundle-form-mode-create'));
    const nameInput = await screen.findByTestId('bundle-form-new-name');
    await user.clear(nameInput);
    await waitFor(() => {
      expect(screen.getByTestId('bundle-form-new-name')).toHaveValue('');
    });
    // The restore-suggestion button shares the label, so a click on the field would press it.
    await user.type(screen.getByTestId('bundle-form-new-name'), 'Zestaw nowy', { skipClick: true });
    // The price starts as the sum of the paid components and says what the customer saves.
    expect(screen.getByTestId('bundle-form-new-price')).toHaveValue('80.00');
    await toReview(user);
    await user.click(screen.getByTestId('bundle-form-save'));

    await waitFor(() => {
      expect(createProduct).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionId: 'master-1',
          name: 'Zestaw nowy',
          sku: 'KUB-350-BI-SET',
          price: 80,
          rateSourceVariantId: 'mug',
        })
      );
    });
    await waitFor(() => {
      expect(apiClient.bundles.create).toHaveBeenCalledWith('new-variant', [
        { variantId: 'mug', quantity: 2 },
      ]);
    });
  });

  it('should say before the form is filled in that no shop can create the product', async () => {
    const user = userEvent.setup();
    renderWithProviders(<BundleForm />, {
      apiClient: api({
        bundles: {
          creationTargets: vi.fn().mockResolvedValue([
            { connectionId: 'm', connectionName: 'Shoper', platformType: 'shoper', creationMode: null },
          ]),
        },
      }),
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });
    await ready();
    await pick(user, 'bundle-form-component-search', 'Kubek', 'KUB-350-BI');
    await toProductStep(user);
    expect(await screen.findByTestId('bundle-form-no-creators')).toBeInTheDocument();
    expect(screen.getByTestId('bundle-form-mode-create')).toBeDisabled();
  });
  describe('R3 behaviour', () => {
    const creators = [
      { connectionId: 'master-1', connectionName: 'PrestaShop', platformType: 'prestashop', creationMode: 'simple-product' },
    ];

    it('should keep the name following the components, and a chosen mode, across revisits of step 2', async () => {
      const apiClient = api({ bundles: { creationTargets: vi.fn().mockResolvedValue(creators) } });
      const user = userEvent.setup();
      renderWithProviders(<BundleForm />, { apiClient, sessionAdapter: createAuthenticatedSessionAdapter() });
      await ready();
      await pick(user, 'bundle-form-component-search', 'Kubek', 'KUB-350-BI');
      await pick(user, 'bundle-form-component-search', 'Kawa', 'KAW-250-ETI');
      await toProductStep(user);
      await waitFor(() => {
        expect(screen.getByTestId<HTMLInputElement>('bundle-form-new-name').value).toMatch(
          /Kubek ceramiczny \+ Kawa ziarnista$/
        );
      });

      await user.click(screen.getByTestId('bundle-form-back'));
      await screen.findByTestId('bundle-form-step-components');
      await pick(user, 'bundle-form-component-search', 'Lyz', 'LYZ-KAW');
      await toProductStep(user);
      await waitFor(() => {
        expect(screen.getByTestId<HTMLInputElement>('bundle-form-new-name').value).toMatch(
          /Kubek \+ Kawa \+ Lyzeczka$/
        );
      });

      await user.click(screen.getByTestId('bundle-form-mode-existing'));
      await user.click(screen.getByTestId('bundle-form-back'));
      await user.click(await screen.findByTestId('bundle-form-next'));
      expect(await screen.findByTestId('bundle-form-mode-existing')).toBeChecked();
    });

    it('should block a bundle whose every component is a gift, and say why', async () => {
      const user = userEvent.setup();
      renderWithProviders(<BundleForm />, { apiClient: api(), sessionAdapter: createAuthenticatedSessionAdapter() });
      await ready();
      await pick(user, 'bundle-form-component-search', 'Kubek', 'KUB-350-BI');
      await pick(user, 'bundle-form-component-search', 'Lyz', 'LYZ-KAW');
      await user.click(await screen.findByTestId('bundle-form-component-toggle-gift-KUB-350-BI'));
      await user.click(screen.getByTestId('bundle-form-component-toggle-gift-LYZ-KAW'));

      expect(screen.getByTestId('bundle-form-composition-note')).toHaveTextContent(/paid|płatny/i);
      expect(screen.getByTestId('bundle-form-next')).toHaveAttribute('aria-disabled', 'true');
    });

    it('should not accept one product in a quantity of one as a bundle', async () => {
      const user = userEvent.setup();
      renderWithProviders(<BundleForm />, { apiClient: api(), sessionAdapter: createAuthenticatedSessionAdapter() });
      await ready();
      await pick(user, 'bundle-form-component-search', 'Kubek', 'KUB-350-BI');

      expect(screen.getByTestId('bundle-form-composition-note')).toBeInTheDocument();
      expect(screen.getByTestId('bundle-form-next')).toHaveAttribute('aria-disabled', 'true');
      await user.click(screen.getByTestId('bundle-form-multipack-3'));
      expect(screen.queryByTestId('bundle-form-composition-note')).not.toBeInTheDocument();
      expect(screen.getByTestId('bundle-form-next')).not.toHaveAttribute('aria-disabled');
    });

    it('should block Next on a SKU that is a variant SKU of an existing product', async () => {
      const taken = product('old', 'Stary produkt', 'OTHER', 5, {
        variants: [variant('old', 'KUB-350-BI-SET', 5)],
      });
      const apiClient = api({
        bundles: { creationTargets: vi.fn().mockResolvedValue(creators) },
        products: {
          listRows: vi.fn().mockImplementation(async (filters: { search?: string }) => ({
            items: (filters.search ?? '') === 'KUB-350-BI-SET' ? [taken] : ALL.filter((p) =>
              p.name.toLowerCase().includes((filters.search ?? '').toLowerCase())
            ),
            limit: 20,
            offset: 0,
          })),
        },
      });
      const user = userEvent.setup();
      renderWithProviders(<BundleForm />, { apiClient, sessionAdapter: createAuthenticatedSessionAdapter() });
      await ready();
      await pick(user, 'bundle-form-component-search', 'Kubek', 'KUB-350-BI');
      await toProductStep(user);
      await user.type(await screen.findByTestId('bundle-form-new-name'), 'Nowy');

      expect(await screen.findByTestId('bundle-form-sku-taken')).toBeInTheDocument();
      expect(screen.getByTestId('bundle-form-next')).toHaveAttribute('aria-disabled', 'true');
    });

    it('should rewrite a ?krok= deep link to the step that is actually open and say so', async () => {
      renderWithProviders(
        <>
          <BundleForm />
          <LocationSearchProbe />
        </>,
        { apiClient: api(), sessionAdapter: createAuthenticatedSessionAdapter(), route: '/?krok=product' }
      );

      await waitFor(() => {
        expect(screen.getByTestId('location-search-probe')).toHaveTextContent('krok=components');
      });
      expect(await screen.findByTestId('bundle-form-blocked-note')).toBeInTheDocument();
    });

    it('should add every exact SKU pasted into the search and report what was not found', async () => {
      const user = userEvent.setup();
      renderWithProviders(<BundleForm />, { apiClient: api(), sessionAdapter: createAuthenticatedSessionAdapter() });
      await ready();
      const search = screen.getByTestId('bundle-form-component-search');
      await user.click(search);
      await user.paste('KUB-350-BI, KAW-250-ETI;NOPE-1');

      expect(await screen.findByTestId('bundle-form-component-search-bulk-result')).toHaveTextContent(
        /Added 2.*not found 1: NOPE-1|Dodano 2.*nie znaleziono 1: NOPE-1/
      );
      expect(screen.getByTestId('bundle-form-component-row-KUB-350-BI')).toBeInTheDocument();
      expect(screen.getByTestId('bundle-form-component-row-KAW-250-ETI')).toBeInTheDocument();
    });

    it('should go to the next step on Ctrl+Enter when the step is valid', async () => {
      const user = userEvent.setup();
      renderWithProviders(<BundleForm />, { apiClient: api(), sessionAdapter: createAuthenticatedSessionAdapter() });
      await ready();
      await pick(user, 'bundle-form-component-search', 'Kubek', 'KUB-350-BI');
      await user.click(screen.getByTestId('bundle-form-multipack-2'));
      await user.keyboard('{Control>}{Enter}{/Control}');

      expect(await screen.findByTestId('bundle-form-step-product')).toBeInTheDocument();
    });

    it('should start a duplicate from the components of an existing bundle', async () => {
      const source = {
        variantId: 'set',
        productId: 'p-set',
        bundle: { name: 'Zestaw poranny', sku: 'ZES', price: 65, currency: 'PLN' },
        bundlesAvailable: 5,
        componentAvailability: [
          { variantId: 'mug', productId: 'p-mug', quantity: 2, giftSlot: false, availableToPromise: 10, summary: { name: 'Kubek ceramiczny', sku: 'KUB-350-BI', price: 40, currency: 'PLN', imageUrl: null } },
        ],
        openOrdersOnOlderComposition: 0,
        version: 1,
      };
      renderWithProviders(<BundleForm duplicateFrom="set" />, {
        apiClient: api({ bundles: { get: vi.fn().mockResolvedValue(source) } }),
        sessionAdapter: createAuthenticatedSessionAdapter(),
      });

      expect(await screen.findByTestId('bundle-form-duplicate-note')).toHaveTextContent('Zestaw poranny');
      expect(await screen.findByTestId('bundle-form-component-qty-KUB-350-BI')).toHaveValue(2);
    });
  });
});

describe('BundleForm round 5 (seed, examples, pack size)', () => {
  it('should seed what resolved and warn about the rest, instead of opening empty', async () => {
    renderWithProviders(
      <BundleForm
        seedComponents={[
          { productId: 'p-mug', quantity: 2 },
          { productId: 'p-unknown', quantity: 1 },
          { productId: 'p-bundle2', quantity: 1 },
        ]}
      />,
      { apiClient: api(), sessionAdapter: createAuthenticatedSessionAdapter() }
    );
    expect(await screen.findByTestId('bundle-form-component-row-KUB-350-BI')).toBeInTheDocument();
    const warning = screen.getByTestId('bundle-form-seed-failed');
    expect(warning).toHaveTextContent('p-unknown');
    expect(warning).toHaveTextContent('p-bundle2');
    expect(screen.queryByTestId('bundle-form-component-row-ZES-PARZENIE')).not.toBeInTheDocument();
  });

  it('should say when the page changed a seeded quantity', async () => {
    renderWithProviders(
      <BundleForm
        seedComponents={[{ productId: 'p-mug', quantity: 9999 }]}
        seedAdjustments={[{ kind: 'clamped', id: 'p-mug', to: 9999 }]}
      />,
      { apiClient: api(), sessionAdapter: createAuthenticatedSessionAdapter() }
    );
    expect(await screen.findByTestId('bundle-form-seed-adjusted')).toHaveTextContent('9999');
  });

  it('should show two example cards on an empty step 1, and the multipack one pre-selects x3', async () => {
    const user = userEvent.setup();
    renderWithProviders(<BundleForm />, {
      apiClient: api(),
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });
    await ready();
    expect(screen.getByTestId('bundle-form-example-mix')).toBeInTheDocument();
    await user.click(screen.getByTestId('bundle-form-example-multipack'));
    await pick(user, 'bundle-form-component-search', 'Kubek', 'KUB-350-BI');
    await waitFor(() => {
      expect(screen.getByTestId('bundle-form-component-qty-KUB-350-BI')).toHaveValue(3);
    });
    expect(screen.queryByTestId('bundle-form-examples')).not.toBeInTheDocument();
  });

  it('should warn when the name says x3 but the only component is held once', async () => {
    const user = userEvent.setup();
    const apiClient = api({
      bundles: {
        creationTargets: vi.fn().mockResolvedValue([
          { connectionId: 'master-1', connectionName: 'PrestaShop', platformType: 'prestashop', creationMode: 'simple-product' },
        ]),
      },
    });
    renderWithProviders(<BundleForm />, { apiClient, sessionAdapter: createAuthenticatedSessionAdapter() });
    await ready();
    await pick(user, 'bundle-form-component-search', 'Kubek', 'KUB-350-BI');
    await toProductStep(user);
    await user.click(await screen.findByTestId('bundle-form-mode-create'));
    expect(screen.queryByTestId('bundle-form-pack-mismatch')).not.toBeInTheDocument();
    const name = await screen.findByTestId('bundle-form-new-name');
    await user.clear(name);
    await user.type(name, 'Kubek x5', { skipClick: true });
    expect(await screen.findByTestId('bundle-form-pack-mismatch')).toHaveTextContent('x5');
  });
});
