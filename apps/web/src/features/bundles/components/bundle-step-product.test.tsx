/**
 * Bundle form step 2 (#3935): create comes first and is the default, the name
 * follows the components until typed over, and every failure names a way out.
 */
import { screen } from '@testing-library/react';
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
    effectiveName: '',
    nameSuggestion: 'Kubek + Kawa',
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
    expect(suggestedBundleName([row('Kubek', 'a'), row('Kawa', 'b')])).toBe('Kubek + Kawa');
    expect(suggestedBundleName([row('Kubek', 'a')])).toBe('');
    expect(suggestedBundleName([{ ...row('Kubek', 'a'), qty: 3 }])).toBe('Kubek x3');
  });
});

describe('BundleStepProduct', () => {
  it('should list "create" before "I already have it"', () => {
    renderWithProviders(<BundleStepProduct {...props()} />, { apiClient: client() });

    const radios = screen.getAllByRole('radio');
    expect(radios[0]).toHaveAttribute('data-testid', 'bundle-form-mode-create');
    expect(radios[1]).toHaveAttribute('data-testid', 'bundle-form-mode-existing');
  });

  it('should show the name suggestion as the name while the operator has not typed one', () => {
    renderWithProviders(
      <BundleStepProduct {...props({ mode: 'create', effectiveName: 'Kubek + Kawa' })} />,
      { apiClient: client() }
    );

    expect(screen.getByTestId('bundle-form-new-name')).toHaveValue('Kubek + Kawa');
    expect(screen.getAllByTestId('bundle-form-hint-chip').length).toBeGreaterThan(0);
  });

  it('should mark the name as typed when the operator edits it, and cap its length', async () => {
    const onDraftChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<BundleStepProduct {...props({ mode: 'create', onDraftChange })} />, {
      apiClient: client(),
    });

    const input = screen.getByTestId('bundle-form-new-name');
    expect(input).toHaveAttribute('maxlength', '120');
    await user.type(input, 'A');
    expect(onDraftChange).toHaveBeenCalledWith({
      name: 'A',
      touched: expect.objectContaining({ name: true }),
    });
  });

  it('should say why a price is refused, and what to do', () => {
    renderWithProviders(
      <BundleStepProduct
        {...props({
          mode: 'create',
          draft: { ...EMPTY_PRODUCT_DRAFT, price: '-5', touched: { ...EMPTY_PRODUCT_DRAFT.touched, price: true } },
        })}
      />,
      { apiClient: client() }
    );

    expect(screen.getByTestId('bundle-form-price-error')).toBeInTheDocument();
  });

  it('should keep the explainer folded until asked, and remember the choice', async () => {
    window.localStorage.removeItem('ol.bundles.s2.explainer');
    const user = userEvent.setup();
    renderWithProviders(<BundleStepProduct {...props()} />, { apiClient: client() });

    expect(screen.queryByTestId('bundle-form-model')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('bundle-form-explainer-show'));
    expect(screen.getByTestId('bundle-form-model')).toBeInTheDocument();
    await user.click(screen.getByTestId('bundle-form-explainer-hide'));
    expect(window.localStorage.getItem('ol.bundles.s2.explainer')).toBe('hidden');
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
    renderWithProviders(
      <BundleStepProduct
        {...props({
          mode: 'create',
          skuConflict: { productId: 'p1', name: 'Istniejacy', sku: 'A-SET' },
          draft: { ...EMPTY_PRODUCT_DRAFT, sku: 'A-SET', touched: { ...EMPTY_PRODUCT_DRAFT.touched, sku: true } },
        })}
      />,
      { apiClient: client() }
    );

    expect(await screen.findByTestId('bundle-form-sku-taken')).toHaveTextContent('A-SET');
    expect(screen.getByRole('button', { name: /Use the existing|Użyj istniejącego/ })).toBeInTheDocument();
  });
});
