/**
 * Bundle form (#3624). The things an operator can get wrong are asserted by
 * what they READ: the refusal for nesting, the unknown-availability sentence
 * (never a zero), the gift mark landing on the saved definition, and a viewer
 * who sees everything and can change nothing.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

function product(id: string, name: string, sku: string, price: number, over: Partial<Product> = {}): Product {
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
        items: ALL.filter((p) => p.name.toLowerCase().includes((filters.search ?? '').toLowerCase())),
        limit: 8,
        offset: 0,
      })),
      getById: vi.fn().mockImplementation(async (id: string) => ALL.find((p) => p.id === id)),
      getVariant: vi.fn(),
      ...over.products,
    },
    bundles: {
      create: vi.fn().mockResolvedValue({ variantId: 'set', version: 1, components: [], releasedOrders: 0 }),
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

async function ready(): Promise<void> {
  // The session resolves after the first paint; until then the form is read-only.
  await waitFor(() => {
    expect(screen.getByTestId('bundle-form-component-search')).toBeEnabled();
  });
}

async function pick(user: ReturnType<typeof userEvent.setup>, testId: string, text: string, sku: string): Promise<void> {
  await user.type(screen.getByTestId(testId), text);
  await user.click(await screen.findByTestId(`${testId}-result-${sku}`, undefined, { timeout: 5000 }));
}

describe('BundleForm (#3624)', () => {
  it('should save a new bundle with the gift mark on the component it was set on', async () => {
    const apiClient = api();
    const user = userEvent.setup();
    renderWithProviders(<BundleForm />, { apiClient, sessionAdapter: createAuthenticatedSessionAdapter() });
    await ready();

    await pick(user, 'bundle-form-product-search', 'Zestaw poranny', 'ZES-PORANNY');
    expect(screen.getByTestId('bundle-form-sku')).toHaveTextContent('ZES-PORANNY');

    await pick(user, 'bundle-form-component-search', 'Kubek', 'KUB-350-BI');
    await pick(user, 'bundle-form-component-search', 'Lyz', 'LYZ-KAW');
    await user.click(await screen.findByTestId('bundle-form-component-toggle-gift-LYZ-KAW'));
    expect(screen.getByTestId('bundle-form-component-gift-LYZ-KAW')).toBeInTheDocument();

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
      expect.stringContaining('variantIds=set'),
    );
  });

  it('should say which component limits the bundle in one line', async () => {
    const user = userEvent.setup();
    renderWithProviders(<BundleForm />, { apiClient: api(), sessionAdapter: createAuthenticatedSessionAdapter() });
    await ready();
    await pick(user, 'bundle-form-component-search', 'Kubek', 'KUB-350-BI');
    await pick(user, 'bundle-form-component-search', 'Lyz', 'LYZ-KAW');
    expect(screen.getByTestId('bundle-form-availability')).toHaveTextContent(
      'Available: 1 pcs, limited by Lyzeczka',
    );
  });

  it('should read an unknown component as unknown availability, never zero', async () => {
    const unknownMug = product('mug', 'Kubek ceramiczny', 'KUB-350-BI', 40, { availableToPromise: null });
    const apiClient = api({
      products: {
        listRows: vi.fn().mockResolvedValue({ items: [unknownMug], limit: 8, offset: 0 }),
        getById: vi.fn().mockResolvedValue(unknownMug),
      },
    });
    const user = userEvent.setup();
    renderWithProviders(<BundleForm />, { apiClient, sessionAdapter: createAuthenticatedSessionAdapter() });
    await ready();
    await pick(user, 'bundle-form-component-search', 'Kubek', 'KUB-350-BI');
    const line = screen.getByTestId('bundle-form-availability');
    expect(line).toHaveTextContent('Availability unknown');
    expect(line).not.toHaveTextContent('0 pcs');
  });

  it('should refuse a bundle as a component inline and not add it', async () => {
    const user = userEvent.setup();
    renderWithProviders(<BundleForm />, { apiClient: api(), sessionAdapter: createAuthenticatedSessionAdapter() });
    await ready();
    await pick(user, 'bundle-form-component-search', 'Zestaw do', 'ZES-PARZENIE');
    expect(await screen.findByTestId('bundle-form-nested-error')).toHaveTextContent('is a bundle');
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
      { apiClient, sessionAdapter: createAuthenticatedSessionAdapter() },
    );
    await ready();
    await pick(user, 'bundle-form-product-search', 'Zestaw poranny', 'ZES-PORANNY');
    await pick(user, 'bundle-form-component-search', 'Kubek', 'KUB-350-BI');
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
      bundles: { create: vi.fn().mockRejectedValue(new ApiError('nope', status, { code: 'OTHER' })) },
    });
    const user = userEvent.setup();
    renderWithProviders(<BundleForm />, { apiClient, sessionAdapter: createAuthenticatedSessionAdapter() });
    await ready();
    await pick(user, 'bundle-form-product-search', 'Zestaw poranny', 'ZES-PORANNY');
    await pick(user, 'bundle-form-component-search', 'Kubek', 'KUB-350-BI');
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
    const apiClient = api({ bundles: { get: vi.fn().mockReturnValue(new Promise(() => undefined)) } });
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
            new ApiError('refused', 409, { code: 'BUNDLE_NESTING_REFUSED', reason: 'variant-is-component' }),
          ),
      },
    });
    const user = userEvent.setup();
    renderWithProviders(<BundleForm />, { apiClient, sessionAdapter: createAuthenticatedSessionAdapter() });
    await ready();
    await pick(user, 'bundle-form-product-search', 'Zestaw poranny', 'ZES-PORANNY');
    await pick(user, 'bundle-form-component-search', 'Kubek', 'KUB-350-BI');
    await user.click(screen.getByTestId('bundle-form-save'));
    expect(await screen.findByTestId('bundle-form-nested-error')).toHaveTextContent('already a component');
  });

  it('should show the price split only on demand, and say when a price is missing', async () => {
    const noPrice = product('mug', 'Kubek ceramiczny', 'KUB-350-BI', 40, {
      price: null,
      variants: [{ ...variant('mug', 'KUB-350-BI', 40), price: null }],
    });
    const apiClient = api({
      products: {
        listRows: vi.fn().mockImplementation(async (f: { search?: string }) => ({
          items: [SET, COFFEE, noPrice].filter((p) => p.name.toLowerCase().includes((f.search ?? '').toLowerCase())),
          limit: 8,
          offset: 0,
        })),
        getById: vi.fn().mockImplementation(async (id: string) => [SET, COFFEE, noPrice].find((p) => p.id === id)),
      },
    });
    const user = userEvent.setup();
    renderWithProviders(<BundleForm />, { apiClient, sessionAdapter: createAuthenticatedSessionAdapter() });
    await ready();
    await pick(user, 'bundle-form-product-search', 'Zestaw poranny', 'ZES-PORANNY');
    await pick(user, 'bundle-form-component-search', 'Kawa', 'KAW-250-ETI');
    expect(screen.queryByTestId('bundle-form-price-split')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Show price split/ }));
    const split = screen.getByTestId('bundle-form-price-split');
    expect(within(split).getByTestId('bundle-form-price-split-line-KAW-250-ETI')).toHaveTextContent('65');

    await pick(user, 'bundle-form-component-search', 'Kubek', 'KUB-350-BI');
    expect(await screen.findByTestId('bundle-form-price-share-alert')).toHaveTextContent('has no price');
  });

  it('should write the next version when editing, and say how many open orders keep the old one', async () => {
    const detail: BundleDetail = {
      variantId: 'set',
      version: 2,
      bundle: { name: 'Zestaw poranny', sku: 'ZES-PORANNY', price: 65, currency: 'PLN', imageUrl: null },
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
          summary: { name: 'Kubek ceramiczny', sku: 'KUB-350-BI', price: 40, currency: 'PLN', imageUrl: null },
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
    expect(screen.getByTestId('bundle-form-open-orders-note')).toHaveTextContent('3 open orders keep the old composition');
    await user.click(screen.getByTestId('bundle-form-save'));
    await waitFor(() => {
      expect(apiClient.bundles.update).toHaveBeenCalledWith('set', [{ variantId: 'mug', quantity: 1 }]);
    });
    expect(apiClient.bundles.create).not.toHaveBeenCalled();
    // The list-offer link has the product id of the bundle, read from the detail.
    expect(await screen.findByTestId('bundle-form-list-offer')).toHaveAttribute(
      'href',
      expect.stringContaining('productIds=p-set'),
    );
  });

  describe('sync composition from the master (#3932)', () => {
    const baseDetail: BundleDetail = {
      variantId: 'set',
      version: 2,
      bundle: { name: 'Zestaw poranny', sku: 'ZES-PORANNY', price: 65, currency: 'PLN', imageUrl: null },
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
      const syncFromMaster = vi.fn().mockResolvedValue({ variantId: 'set', version: 3, components: [] });
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
      bundle: { name: 'Zestaw poranny', sku: 'ZES-PORANNY', price: 65, currency: 'PLN', imageUrl: null },
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
            componentSummaries: [{ name: 'Kubek', sku: 'KUB', price: 1, currency: 'PLN', imageUrl: null }],
          },
          {
            variantId: 'set',
            version: 1,
            current: false,
            createdAt: '2026-10-02T10:00:00Z',
            openOrders: 3,
            components: [{ variantId: 'mug', productId: 'p-mug', quantity: 1 }],
            componentSummaries: [{ name: 'Kubek', sku: 'KUB', price: 1, currency: 'PLN', imageUrl: null }],
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

  it('should let a viewer see the form with every write disabled and the reason on screen', async () => {
    renderWithProviders(<BundleForm />, {
      apiClient: api(),
      sessionAdapter: createAuthenticatedSessionAdapter({ ...VIEWER, permissions: [...VIEWER.permissions] }),
    });
    expect(await screen.findByTestId('bundle-form-readonly-notice')).toHaveTextContent('admin or operator role');
    expect(screen.getByTestId('bundle-form-save')).toBeDisabled();
    expect(screen.getByTestId('bundle-form-save')).toHaveAttribute('title', expect.stringContaining('admin or operator'));
    expect(screen.getByTestId('bundle-form-component-search')).toBeDisabled();
  });
});
