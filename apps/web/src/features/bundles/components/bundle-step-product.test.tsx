/**
 * Bundle form step 2 (#3935): create comes first and is the default, the name
 * follows the components until typed over, and every failure names a way out.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import {
  EMPTY_PRODUCT_DRAFT,
  type NewProductDraft,
  type ParsedRow,
} from '../lib/bundle-form-model';
import {
  BundleStepProduct,
  suggestedBundleName,
  type BundleStepProductProps,
} from './bundle-step-product';

function row(name: string, variantId: string): ParsedRow {
  return {
    variantId,
    productId: `p-${variantId}`,
    name,
    sku: variantId.toUpperCase(),
    price: 20,
    currency: 'PLN',
    availableToPromise: 5,
    isBundle: false,
    quantity: '1',
    gift: false,
    documentForm: '',
    qty: 1,
  };
}

const creator = {
  connectionId: 'shop',
  connectionName: 'PrestaShop',
  platformType: 'prestashop',
  creationMode: 'simple-product' as const,
};

function props(over: Partial<BundleStepProductProps> = {}): BundleStepProductProps {
  const draft: NewProductDraft = { ...EMPTY_PRODUCT_DRAFT };
  return {
    editing: false,
    readOnly: false,
    mode: 'existing',
    onModeChange: vi.fn(),
    targets: [creator],
    targetsFailed: false,
    draft,
    onDraftChange: vi.fn(),
    parsedRows: [row('Kubek', 'a'), row('Kawa', 'b')],
    currency: 'PLN',
    bundleProduct: null,
    onPickProduct: vi.fn(),
    onClearProduct: vi.fn(),
    excludeVariantIds: [],
    showErrors: false,
    createError: null,
    ...over,
  };
}

function client(): ReturnType<typeof createMockApiClient> {
  return createMockApiClient({
    products: {
      listRows: vi.fn().mockResolvedValue({ items: [], limit: 5, offset: 0 }),
    },
    bundles: { creationTargets: vi.fn().mockResolvedValue([creator]) },
  });
}

describe('suggestedBundleName', () => {
  it('should join the first components, and stay empty for fewer than two', () => {
    expect(suggestedBundleName([row('Kubek', 'a'), row('Kawa', 'b')], 'Zestaw')).toBe('Zestaw: Kubek + Kawa');
    expect(suggestedBundleName([row('Kubek', 'a')], 'Zestaw')).toBe('');
  });
});

describe('BundleStepProduct', () => {
  it('should draw the model and list "create" before "I already have it"', () => {
    renderWithProviders(<BundleStepProduct {...props()} />, { apiClient: client() });

    expect(screen.getByTestId('bundle-form-model')).toBeInTheDocument();
    const radios = screen.getAllByRole('radio');
    expect(radios[0]).toHaveAttribute('data-testid', 'bundle-form-mode-create');
    expect(radios[1]).toHaveAttribute('data-testid', 'bundle-form-mode-existing');
  });

  it('should default to create once a shop that can create products is known', async () => {
    const onModeChange = vi.fn();
    renderWithProviders(<BundleStepProduct {...props({ onModeChange })} />, { apiClient: client() });

    await waitFor(() => {
      expect(onModeChange).toHaveBeenCalledWith('create');
    });
  });

  it('should suggest a name from the components while the name is untouched', async () => {
    const onDraftChange = vi.fn();
    renderWithProviders(<BundleStepProduct {...props({ mode: 'create', onDraftChange })} />, {
      apiClient: client(),
    });

    await waitFor(() => {
      expect(onDraftChange).toHaveBeenCalledWith({ name: expect.stringMatching(/: Kubek \+ Kawa$/) });
    });
  });

  it('should say nothing is created in the shop until step 4, and show one shop as a static row', () => {
    renderWithProviders(<BundleStepProduct {...props({ mode: 'create' })} />, { apiClient: client() });

    expect(screen.getByTestId('bundle-form-nothing-yet')).toBeInTheDocument();
    expect(screen.getByTestId('bundle-form-master')).toHaveTextContent('PrestaShop');
  });

  it('should offer a way to the connections when no shop can create products', () => {
    renderWithProviders(
      <BundleStepProduct
        {...props({
          targets: [{ ...creator, creationMode: null }],
        })}
      />,
      { apiClient: client() }
    );

    expect(screen.getByTestId('bundle-form-no-creators')).toHaveTextContent(/connections|połączenia/i);
    expect(screen.getByTestId('bundle-form-mode-create')).toBeDisabled();
  });

  it('should offer a retry when the shops could not be loaded', async () => {
    const creationTargets = vi.fn().mockResolvedValue([creator]);
    const user = userEvent.setup();
    renderWithProviders(<BundleStepProduct {...props({ targets: undefined, targetsFailed: true })} />, {
      apiClient: createMockApiClient({
        products: { listRows: vi.fn().mockResolvedValue({ items: [], limit: 5, offset: 0 }) },
        bundles: { creationTargets },
      }),
    });

    await user.click(await screen.findByRole('button', { name: /Try again|Spróbuj ponownie/ }));
    expect(creationTargets.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('should warn inline when the SKU already belongs to a product and offer to use it', async () => {
    const listRows = vi.fn().mockResolvedValue({
      items: [{ id: 'p1', name: 'Istniejacy', sku: 'A-SET', price: 1, currency: 'PLN' }],
      limit: 5,
      offset: 0,
    });
    renderWithProviders(
      <BundleStepProduct
        {...props({
          mode: 'create',
          draft: { ...EMPTY_PRODUCT_DRAFT, sku: 'A-SET', touched: { sku: true, price: false, description: false } },
        })}
      />,
      { apiClient: createMockApiClient({ products: { listRows }, bundles: { creationTargets: vi.fn().mockResolvedValue([creator]) } }) }
    );

    expect(await screen.findByTestId('bundle-form-sku-taken')).toHaveTextContent('A-SET');
    expect(screen.getByRole('button', { name: /Use the existing|Użyj istniejącego/ })).toBeInTheDocument();
  });
});
