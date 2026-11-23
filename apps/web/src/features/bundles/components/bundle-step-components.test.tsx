/**
 * Step 1 of the bundle form: the picker is a combobox that keeps the focus,
 * says up front what cannot be added, and a removed row can be taken back.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useFieldArray, useForm, type UseFormReturn } from 'react-hook-form';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import type { Product, ProductVariant } from '../../products';
import type { BundleFormValues, ParsedRow } from '../lib/bundle-form-model';
import { BundleStepComponents } from './bundle-step-components';

function variant(id: string, sku: string, attrs: Record<string, string> | null = null): ProductVariant {
  return {
    id,
    productId: `p-${id}`,
    sku,
    attributes: attrs,
    ean: null,
    gtin: null,
    price: 10,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    isStale: false,
    staleAt: null,
  } as ProductVariant;
}

function product(id: string, name: string, sku: string, variants: ProductVariant[], over: Partial<Product> = {}): Product {
  return {
    id: `p-${id}`,
    name,
    sku,
    price: 10,
    currency: 'PLN',
    description: null,
    images: null,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    variants,
    availableToPromise: 10,
    variantCount: variants.length,
    ...over,
  } as Product;
}

const MUG = product('mug', 'Kubek', 'KUB', [variant('mug', 'KUB')]);
const TEA = product('tea', 'Herbata', 'HER', [variant('tea250', 'HER-250', { size: '250 g' }), variant('tea500', 'HER-500', { size: '500 g' })]);
const PACK = product('pack', 'Kubek zestaw', 'KUB-Z', [variant('pack', 'KUB-Z')], {
  bundle: { variantId: 'pack', componentCount: 2, limitedBy: null, unknownComponent: null },
});
const ALL = [MUG, TEA, PACK];

function api(): ReturnType<typeof createMockApiClient> {
  return createMockApiClient({
    products: {
      listRows: vi.fn().mockImplementation(async (filters: { search?: string }) => ({
        items: ALL.filter((p) => p.name.toLowerCase().includes((filters.search ?? '').toLowerCase())),
        limit: 6,
        offset: 0,
      })),
      count: vi.fn().mockResolvedValue({ total: 3 }),
      getById: vi.fn().mockImplementation(async (id: string) => ALL.find((p) => p.id === id)),
    },
    inventory: {
      availability: vi.fn().mockResolvedValue({
        items: [
          { productVariantId: 'mug', availableToPromise: 8 },
          { productVariantId: 'tea250', availableToPromise: 0 },
          { productVariantId: 'tea500', availableToPromise: 3 },
          { productVariantId: 'pack', availableToPromise: 4 },
        ],
      }),
    },
  });
}

function Host({ onForm }: { onForm?: (form: UseFormReturn<BundleFormValues>) => void }): ReactElement {
  const form = useForm<BundleFormValues>({ defaultValues: { components: [] }, mode: 'onChange' });
  const components = useFieldArray({ control: form.control, name: 'components' });
  onForm?.(form);
  const rows = form.watch('components');
  const parsedRows: ParsedRow[] = rows.map((row) => ({ ...row, qty: /^[1-9]\d*$/.test(row.quantity) ? Number(row.quantity) : 0 }));
  return (
    <BundleStepComponents
      form={form}
      components={components}
      rows={rows}
      parsedRows={parsedRows}
      readOnly={false}
      limitedName={null}
      showErrors={false}
      onAdd={(choice) => {
        components.append({ ...choice, imageUrl: null, ean: choice.ean ?? null, attributes: choice.attributes ?? null, quantity: '1', gift: false, documentForm: '' });
      }}
    />
  );
}

const SEARCH = 'bundle-form-component-search';

describe('BundleStepComponents (step 1)', () => {
  it('should add the highlighted result with the keyboard and keep the focus in the search', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Host />, { apiClient: api() });
    const input = screen.getByTestId(SEARCH);
    expect(input).toHaveAttribute('role', 'combobox');
    await user.type(input, 'Kubek');
    await screen.findByTestId(`${SEARCH}-result-KUB`);
    await waitFor(() => {
      expect(screen.getByTestId(`${SEARCH}-result-KUB`)).toHaveTextContent('8 pcs');
    });
    await user.keyboard('{ArrowDown}{Enter}');
    expect(await screen.findByTestId('bundle-form-component-row-KUB')).toBeInTheDocument();
    await waitFor(() => {
      expect(input).toHaveFocus();
    });
    expect(input).toHaveValue('');
  });

  it('should show a bundle as disabled with the reason and explain a click inline', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Host />, { apiClient: api() });
    await user.type(screen.getByTestId(SEARCH), 'Kubek');
    const why = await screen.findByTestId(`${SEARCH}-why-KUB-Z`);
    expect(why).toHaveTextContent(/bundle/i);
    await user.click(screen.getByTestId(`${SEARCH}-result-KUB-Z`));
    expect(screen.getByTestId(`${SEARCH}-rejection`)).toHaveAttribute('role', 'alert');
    expect(screen.queryByTestId('bundle-form-component-row-KUB-Z')).not.toBeInTheDocument();
    await user.type(screen.getByTestId(SEARCH), 'x');
    expect(screen.queryByTestId(`${SEARCH}-rejection`)).not.toBeInTheDocument();
  });

  it('should explain what is searched when nothing matches', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Host />, { apiClient: api() });
    await user.type(screen.getByTestId(SEARCH), 'axa');
    const empty = await screen.findByTestId(`${SEARCH}-empty`);
    expect(empty).toHaveTextContent('“axa”');
    expect(empty).toHaveTextContent(/name and SKU/i);
  });

  it('should ask for the stock once, after every product detail has settled', async () => {
    const user = userEvent.setup();
    const client = api();
    renderWithProviders(<Host />, { apiClient: client });
    await user.type(screen.getByTestId(SEARCH), 'e');
    await user.type(screen.getByTestId(SEARCH), 'r');
    await screen.findByTestId(`${SEARCH}-result-HER-250`);
    await waitFor(() => {
      expect(client.inventory.availability).toHaveBeenCalled();
    });
    const calls = (client.inventory.availability as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.every((call) => (call[0] as string[]).length >= 2)).toBe(true);
  });

  it('should step the quantity with the buttons and warn when it exceeds the stock', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Host />, { apiClient: api() });
    await user.type(screen.getByTestId(SEARCH), 'Kubek');
    await user.click(await screen.findByTestId(`${SEARCH}-result-KUB`));
    const qty = await screen.findByTestId('bundle-form-component-qty-KUB');
    await user.click(screen.getByRole('button', { name: /Increase quantity/i }));
    expect(qty).toHaveValue(2);
    await user.clear(qty);
    await user.type(qty, '9');
    const row = screen.getByTestId('bundle-form-component-row-KUB');
    await waitFor(() => {
      expect(within(row).getByText(/only have 8 pcs/i)).toBeInTheDocument();
    });
    await user.clear(qty);
    await user.type(qty, '0');
    await waitFor(() => {
      expect(within(row).getByRole('alert')).toHaveTextContent(/at least 1/i);
    });
  });

  it('should take a removed component back with Undo at the same place', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Host />, { apiClient: api() });
    await user.type(screen.getByTestId(SEARCH), 'Kubek');
    await user.click(await screen.findByTestId(`${SEARCH}-result-KUB`));
    await user.type(screen.getByTestId(SEARCH), 'Herbata');
    await user.click(await screen.findByTestId(`${SEARCH}-result-HER-500`));
    await user.click(screen.getByTestId('bundle-form-component-remove-KUB'));
    await waitFor(() => {
      expect(screen.queryByTestId('bundle-form-component-row-KUB')).not.toBeInTheDocument();
    });
    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    const rows = await screen.findAllByTestId(/^bundle-form-component-row-/);
    expect(rows[0]).toHaveAttribute('data-testid', 'bundle-form-component-row-KUB');
  });
});

