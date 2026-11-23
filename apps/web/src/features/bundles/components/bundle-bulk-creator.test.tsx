/**
 * Bulk multipack creator: nothing is created on load, rows are created one
 * after another with a status each, a failure stays on its row and only the
 * failed rows are retried (without making a second product).
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../shared/api/api-error';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../../test/test-utils';
import type { Product } from '../../products';
import type { BundleCreated, CreateBundleProductInput, CreatedBundleProduct } from '../api/bundles.types';
import { earlierDuplicateOf, packName, packPriceText, packSku, parsePackSize, uniquifyName } from '../lib/bundle-bulk-model';
import { BundleBulkCreator } from './bundle-bulk-creator';

function product(id: string, name: string, sku: string | null, price: number, over: Partial<Product> = {}): Product {
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
    variants: [
      {
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
      },
    ],
    availableToPromise: 10,
    ...over,
  } as Product;
}

const MUG = product('mug', 'Kubek ceramiczny', 'KUB-1', 40);
const COFFEE = product('coffee', 'Kawa ziarnista', 'KAW-1', 35);
const MULTI = { ...product('multi', 'Koszulka', 'KOS', 50), variants: [] } as Product;
const SET = product('set', 'Zestaw kubek', 'SET-1', 60, { bundle: { variantId: 'set', componentCount: 2 } } as Partial<Product>);
const DUP = product('dup', 'Kubek ceramiczny', 'KUB-2', 41);
const ALL = [MUG, COFFEE, MULTI, SET, DUP];
const SHOP = { connectionId: 'shop', connectionName: 'PrestaShop', platformType: 'prestashop', creationMode: 'simple-product' as const };

type CreateFn = (input: CreateBundleProductInput) => Promise<CreatedBundleProduct>;
type SaveFn = (variantId: string, components: unknown) => Promise<BundleCreated>;
const SAVED: BundleCreated = { variantId: 'x', version: 1, components: [], releasedOrders: 0 };

function setup(
  createProduct: ReturnType<typeof vi.fn<CreateFn>>,
  save: ReturnType<typeof vi.fn<SaveFn>> = vi.fn<SaveFn>().mockResolvedValue(SAVED),
  ids: string[] = ['p-mug', 'p-coffee', 'p-multi'],
): { createProduct: typeof createProduct; save: typeof save } {
  const apiClient = createMockApiClient({
    products: {
      getById: vi.fn().mockImplementation(async (id: string) => ALL.find((p) => p.id === id)),
      listRows: vi.fn().mockImplementation(async (filters: { productId?: string; search?: string }) => ({
        items: ALL.filter((p) => p.id === filters.productId),
      })),
    },
    bundles: { creationTargets: vi.fn().mockResolvedValue([SHOP]), createProduct, create: save },
  });
  renderWithProviders(<BundleBulkCreator productIds={ids} />, {
    apiClient,
    sessionAdapter: createAuthenticatedSessionAdapter(),
  });
  return { createProduct, save };
}

const made = (variantId: string): CreatedBundleProduct => ({ productId: `np-${variantId}`, variantId, name: 'n', sku: 's', adopted: false });

describe('bundle bulk model', () => {
  it('should clamp the pack size and derive the suggestions', () => {
    expect(parsePackSize('1')).toBeNull();
    expect(parsePackSize('2.7')).toBeNull();
    expect(parsePackSize('100')).toBeNull();
    expect(parsePackSize('')).toBeNull();
    expect(parsePackSize('12')).toBe(12);
    expect(packName('Kubek ceramiczny', 3)).toBe('Kubek ceramiczny x3');
    expect(packName('Kubek ceramiczny 300 ml Silver Monkey', 3)).toBe('Kubek ceramiczny 300 ml Silver Monkey x3');
    expect(earlierDuplicateOf(['A', ' a ', '', 'B', ''])).toEqual([null, 0, null, null, null]);
    expect(uniquifyName('Kubek x3', 'K-2', new Set(['kubek x3']))).toBe('Kubek x3 (K-2)');
    expect(packSku('KUB-1', 3)).toBe('KUB-1-x3');
    expect(packSku(null, 3)).toBe('');
    expect(packPriceText(39.9, 3)).toBe('119.70');
  });
});

describe('BundleBulkCreator', () => {
  it('should show a row per single-variant product, list the others as skipped, and create nothing on load', async () => {
    const { createProduct } = setup(vi.fn<CreateFn>());
    expect(await screen.findByTestId('bulk-row-p-mug')).toBeInTheDocument();
    expect(screen.getByTestId('bulk-row-p-coffee')).toBeInTheDocument();
    expect(within(screen.getByTestId('bulk-skipped')).getByText('Koszulka')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Kubek ceramiczny x3')).toBeInTheDocument();
    expect(screen.getByDisplayValue('KUB-1-x3')).toBeInTheDocument();
    expect(screen.getByDisplayValue('120.00')).toBeInTheDocument();
    expect(createProduct).not.toHaveBeenCalled();
  });

  it('should keep a failed row, say why, and retry only that row without creating its product twice', async () => {
    const createProduct = vi
      .fn<CreateFn>()
      .mockResolvedValueOnce(made('v1'))
      .mockResolvedValueOnce(made('v2'));
    const save = vi
      .fn<SaveFn>()
      .mockRejectedValueOnce(new ApiError('refused', 400, { message: 'zly sklad' }))
      .mockResolvedValue({ ...SAVED, variantId: 'v2' });
    setup(createProduct, save);
    const user = userEvent.setup();
    await screen.findByTestId('bulk-row-p-mug');
    await user.click(await screen.findByTestId('bulk-submit'));

    await waitFor(() => expect(screen.getByRole('button', { name: /Retry failed \(1\)/ })).toBeEnabled());
    expect(within(screen.getByTestId('bulk-row-p-mug')).getByText(/zly sklad/)).toBeInTheDocument();
    expect(within(screen.getByTestId('bulk-row-p-coffee')).getByText('Created')).toBeInTheDocument();
    expect(createProduct).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole('button', { name: /Retry failed \(1\)/ }));
    await waitFor(() => expect(within(screen.getByTestId('bulk-row-p-mug')).getByText('Created')).toBeInTheDocument());
    expect(createProduct).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledTimes(3);
  });

  it('should show a refusal from the shop on the row that was refused', async () => {
    const createProduct = vi
      .fn<CreateFn>()
      .mockRejectedValueOnce(new ApiError('refused', 422, { message: 'SKU zajete' }))
      .mockResolvedValue(made('v2'));
    setup(createProduct);
    const user = userEvent.setup();
    await screen.findByTestId('bulk-row-p-mug');
    await user.click(await screen.findByTestId('bulk-submit'));
    await waitFor(() => expect(within(screen.getByTestId('bulk-row-p-mug')).getByText(/SKU zajete/)).toBeInTheDocument());
    expect(within(screen.getByTestId('bulk-row-p-coffee')).getByText('Created')).toBeInTheDocument();
  });

  it('should skip a product that is already a bundle and name it in the skipped list', async () => {
    setup(vi.fn<CreateFn>(), undefined, ['p-mug', 'p-set']);
    expect(await screen.findByTestId('bulk-row-p-mug')).toBeInTheDocument();
    expect(screen.queryByTestId('bulk-row-p-set')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('bulk-skipped')).getByText('Zestaw kubek')).toBeInTheDocument();
  });

  it('should give two products with the same name different auto names and block a repeated SKU', async () => {
    setup(vi.fn<CreateFn>(), undefined, ['p-mug', 'p-dup']);
    await screen.findByTestId('bulk-row-p-mug');
    expect(screen.getByDisplayValue('Kubek ceramiczny x3')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Kubek ceramiczny x3 (KUB-2-x3)')).toBeInTheDocument();
    const user = userEvent.setup();
    const skus = screen.getAllByRole('textbox', { name: /SKU/ });
    await user.clear(skus[1]);
    await user.type(skus[1], ' kub-1-X3');
    expect(within(screen.getByTestId('bulk-row-p-dup')).getByText(/repeats in the table/)).toBeInTheDocument();
    expect(screen.getByTestId('bulk-submit')).toBeDisabled();
  });

  it('should apply one pack size to every row', async () => {
    setup(vi.fn<CreateFn>(), undefined, ['p-mug', 'p-coffee']);
    await screen.findByTestId('bulk-row-p-mug');
    const user = userEvent.setup();
    const all = screen.getByLabelText('Pieces per pack for all');
    await user.clear(all);
    await user.type(all, '6');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByDisplayValue('Kubek ceramiczny x6')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Kawa ziarnista x6')).toBeInTheDocument();
  });

  it('should stop after a shop-wide failure instead of repeating it for every row', async () => {
    const createProduct = vi.fn<CreateFn>().mockRejectedValue(new ApiError('no', 422, { reason: 'master-cannot-create-products' }));
    setup(createProduct);
    const user = userEvent.setup();
    await screen.findByTestId('bulk-row-p-mug');
    await user.click(await screen.findByTestId('bulk-submit'));
    await waitFor(() => expect(screen.getByText(/Stopped after the first shop error/)).toBeInTheDocument());
    expect(createProduct).toHaveBeenCalledTimes(1);
    expect(within(screen.getByTestId('bulk-row-p-coffee')).getByText('Waiting')).toBeInTheDocument();
  });
});
