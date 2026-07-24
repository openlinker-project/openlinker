/**
 * BulkEditModal shop-mode tests (#1830)
 *
 * The shared two-pane editor rendered for a `ProductPublisher` (shop) destination:
 * the shop field set (title / description / price / stock / attributes /
 * visibility, category in the crumb bar), flat-vs-two-pane by variant shape, the
 * shop save payload (content / destinationCategoryIds / parameters on the base
 * override), per-variant description/price overrides, and the same-global-id
 * attribute de-duplication (`mergeShopParameter`).
 *
 * The shop category/attribute query hooks and the AI suggestion dialog are
 * stubbed so the test isolates the editor's own logic.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../../../test/test-utils';
import { BulkEditModal, mergeShopParameter } from './bulk-edit-modal';
import type { BulkVariantRow, BulkWizardRow } from './bulk-wizard.types';
import type { OfferParameter } from '../../api/listings.types';
import type { BulkPerProductOverride } from '../../api/bulk-listings.types';
import type { Connection } from '../../../connections';
import type { Product, ProductVariant } from '../../../products';

vi.mock('../../../content', () => ({ SuggestionDialog: () => null }));
vi.mock('../../hooks/use-shop-attributes-query', () => ({
  useShopAttributesQuery: () => ({
    data: [{ id: 'pa_color', name: 'Color', slug: 'color' }],
    isLoading: false,
    error: null,
  }),
}));
vi.mock('../../hooks/use-shop-attribute-terms-query', () => ({
  useShopAttributeTermsQuery: () => ({
    data: [
      { id: 't1', name: 'Red', slug: 'red' },
      { id: 't2', name: 'Blue', slug: 'blue' },
    ],
    isLoading: false,
    error: null,
  }),
}));

const shopConnection: Connection = {
  id: 'conn_shop',
  name: 'My Shop',
  platformType: 'woocommerce',
  status: 'active',
  config: {},
  credentialsBacked: true,
  enabledCapabilities: ['ProductPublisher'],
  supportedCapabilities: ['ProductPublisher', 'ShopCategoryBrowser', 'ShopAttributeReader'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function makeVariant(id: string, attributes?: Record<string, string>): ProductVariant {
  return {
    id,
    productId: 'prod_1',
    sku: `SKU-${id}`,
    attributes: attributes ?? null,
    ean: null,
    gtin: null,
    price: 12,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function makeVariantRow(variant: ProductVariant): BulkVariantRow {
  return {
    variantId: variant.id,
    variant,
    ean: null,
    distinguishingAttributes: variant.attributes,
    masterStock: 5,
    masterPrice: 12,
    masterCurrency: 'PLN',
    included: true,
    blockers: [],
    resolvedCategoryId: null,
    resolvedProductCardId: null,
    resolutionMethod: null,
    categoryCandidates: [],
    override: {},
  };
}

function makeRow(variants: ProductVariant[]): BulkWizardRow {
  const product: Product = {
    id: 'prod_1',
    name: 'Widget',
    sku: 'SKU',
    price: 12,
    currency: 'PLN',
    description: 'Master description',
    images: [],
    variants,
  } as unknown as Product;
  return {
    productId: 'prod_1',
    product,
    primaryVariant: variants[0],
    variants: variants.map(makeVariantRow),
    blockers: [],
    resolvedCategoryId: null,
    resolvedProductCardId: null,
    resolutionMethod: null,
    masterPrice: 12,
    masterStock: 5,
    masterCurrency: 'PLN',
    categoryCandidates: [],
    override: {},
  };
}

function renderShopEditor(
  row: BulkWizardRow,
  onSave: (
    productId: string,
    baseOverride: BulkPerProductOverride,
    perVariantOverrides: Record<string, BulkPerProductOverride>,
    included: Record<string, boolean>,
    editFormValues: Record<string, unknown>,
  ) => void,
): void {
  renderWithProviders(
    <BulkEditModal
      open
      onOpenChange={() => undefined}
      row={row}
      connection={shopConnection}
      destinationKind="shop"
      canBrowseCategories={false}
      canBrowseShopCategories
      canPickShopAttributes
      currency="PLN"
      defaults={{ publishImmediately: true }}
      onSave={onSave}
    />,
  );
}

describe('mergeShopParameter', () => {
  it('appends a distinct-id parameter', () => {
    const existing: OfferParameter[] = [{ id: 'pa_color', values: ['Red'], section: 'product' }];
    const next = mergeShopParameter(existing, { id: 'pa_size', values: ['M'], section: 'product' });
    expect(next).toHaveLength(2);
  });

  it('unions term values + ids when the same global-attribute id repeats', () => {
    const existing: OfferParameter[] = [
      { id: 'pa_color', values: ['Red'], valuesIds: ['t1'], section: 'product' },
    ];
    const merged = mergeShopParameter(existing, {
      id: 'pa_color',
      values: ['Blue'],
      valuesIds: ['t2'],
      section: 'product',
    });
    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual({
      id: 'pa_color',
      values: ['Red', 'Blue'],
      valuesIds: ['t1', 't2'],
      section: 'product',
    });
  });

  it('does not duplicate an already-present term id', () => {
    const existing: OfferParameter[] = [
      { id: 'pa_color', values: ['Red'], valuesIds: ['t1'], section: 'product' },
    ];
    const merged = mergeShopParameter(existing, {
      id: 'pa_color',
      values: ['Red'],
      valuesIds: ['t1'],
      section: 'product',
    });
    expect(merged[0].valuesIds).toEqual(['t1']);
  });

  it('unions custom (no-id) attribute values', () => {
    const existing: OfferParameter[] = [{ id: 'Material', values: ['Cotton'], section: 'product' }];
    const merged = mergeShopParameter(existing, {
      id: 'Material',
      values: ['Wool'],
      section: 'product',
    });
    expect(merged[0].values).toEqual(['Cotton', 'Wool']);
  });
});

describe('BulkEditModal (shop mode)', () => {
  it('renders a flat shop editor (no rail) for a simple product with shop-only sections', () => {
    renderShopEditor(makeRow([makeVariant('v1')]), vi.fn());

    expect(screen.getByRole('heading', { name: 'Product fields' })).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toBeInTheDocument();
    expect(screen.getByLabelText('Stock')).toBeInTheDocument();
    // Category lives in the crumb bar, not a mid-form field.
    expect(screen.getByRole('button', { name: 'Change category' })).toBeInTheDocument();
    // No variant rail for a simple product, and no marketplace EAN self-link.
    expect(screen.queryByRole('radiogroup', { name: 'Variant scope selector' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('EAN (GTIN)')).not.toBeInTheDocument();
  });

  it('renders the two-pane rail for a multi-variant product', () => {
    const row = makeRow([makeVariant('v1', { Size: 'M' }), makeVariant('v2', { Size: 'L' })]);
    renderShopEditor(row, vi.fn());
    expect(screen.getByRole('radiogroup', { name: 'Variant scope selector' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Shared base/ })).toBeInTheDocument();
  });

  it('saves shop content + price + stock on the base override for a simple product', () => {
    const onSave = vi.fn();
    renderShopEditor(makeRow([makeVariant('v1')]), onSave);

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'New title' } });
    fireEvent.change(screen.getByLabelText('Price'), { target: { value: '49.90' } });
    fireEvent.change(screen.getByLabelText('Stock'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save all' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const [productId, baseOverride] = onSave.mock.calls[0];
    expect(productId).toBe('prod_1');
    expect(baseOverride.overrides.title).toBe('New title');
    expect(baseOverride.price).toEqual({ amount: 49.9, currency: 'PLN' });
    expect(baseOverride.stock).toBe(8);
  });

  it('de-duplicates two adds of the same global attribute id into one parameter (#1830)', () => {
    const onSave = vi.fn();
    renderShopEditor(makeRow([makeVariant('v1')]), onSave);

    // Pick the global attribute, then add Red and Blue as two separate adds.
    fireEvent.change(screen.getByLabelText('Attribute'), { target: { value: 'pa_color' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Red' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add attribute' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Blue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add attribute' }));

    fireEvent.click(screen.getByRole('button', { name: 'Save all' }));

    const [, baseOverride] = onSave.mock.calls[0];
    expect(baseOverride.overrides.parameters).toEqual([
      { id: 'pa_color', values: ['Red', 'Blue'], valuesIds: ['t1', 't2'], section: 'product' },
    ]);
  });

  it('emits a per-variant description override in the two-pane editor (#1830)', () => {
    const onSave = vi.fn();
    const row = makeRow([makeVariant('v1', { Size: 'M' }), makeVariant('v2', { Size: 'L' })]);
    renderShopEditor(row, onSave);

    // Focus the first variant scope, override its description.
    fireEvent.click(screen.getByRole('radio', { name: /Size: M|M$/ }));
    const descriptions = screen.getAllByLabelText(/Description for/);
    fireEvent.change(descriptions[0], { target: { value: 'Only for M' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save all' }));

    const [, , perVariantOverrides] = onSave.mock.calls[0] as [
      string,
      BulkPerProductOverride,
      Record<string, BulkPerProductOverride>,
    ];
    expect(perVariantOverrides.v1.overrides?.description).toBe('Only for M');
  });
});
