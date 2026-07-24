/**
 * BulkShopReviewStep pure-helper tests (#1829)
 *
 * Pins `buildBulkShopPublishItems`: one `bulk-shop-publish` item per INCLUDED
 * variant, stock resolved from master availability + the batch stock policy,
 * price from the variant master price + the batch pricing policy, excluded
 * variants dropped, and a null resolved price omitted (shop builder falls back
 * to master server-side).
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders, createMockApiClient } from '../../../../test/test-utils';
import {
  BulkShopReviewStep,
  buildBulkShopPublishItems,
  type ShopPublishVisibility,
} from './bulk-shop-review-step';
import type { BulkVariantRow, BulkWizardConfig, BulkWizardRow } from './bulk-wizard.types';
import type { BulkShopPublishItemRequest } from '../../api/listings.types';
import type { Connection } from '../../../connections';
import type { Product, ProductVariant } from '../../../products';

function makeVariantRow(id: string, over: Partial<BulkVariantRow> = {}): BulkVariantRow {
  const variant = { id, productId: 'prod_1', sku: id } as unknown as ProductVariant;
  return {
    variantId: id,
    variant,
    ean: null,
    distinguishingAttributes: null,
    masterStock: null,
    masterPrice: 39,
    masterCurrency: 'PLN',
    included: true,
    blockers: [],
    resolvedCategoryId: null,
    resolvedProductCardId: null,
    resolutionMethod: null,
    categoryCandidates: [],
    override: {},
    ...over,
  };
}

function makeRow(productId: string, variants: BulkVariantRow[]): BulkWizardRow {
  return {
    productId,
    product: { id: productId, name: 'P', currency: 'PLN' } as unknown as Product,
    primaryVariant: variants[0]?.variant ?? null,
    variants,
    blockers: [],
    resolvedCategoryId: null,
    resolvedProductCardId: null,
    resolutionMethod: null,
    masterPrice: null,
    masterStock: null,
    masterCurrency: null,
    categoryCandidates: [],
    override: {},
  };
}

function config(over: Partial<BulkWizardConfig> = {}): BulkWizardConfig {
  return {
    connectionId: 'conn_shop',
    platformParams: {},
    currency: 'PLN',
    pricingPolicy: { mode: 'use-master' },
    stockPolicy: { mode: 'use-master' },
    publishImmediately: true,
    generateDescription: false,
    ...over,
  };
}

describe('buildBulkShopPublishItems', () => {
  it('emits one item per included variant with master-derived price + availability stock', () => {
    const rows = [makeRow('prod_1', [makeVariantRow('v1'), makeVariantRow('v2')])];
    const items = buildBulkShopPublishItems(
      rows,
      config(),
      new Map([
        ['v1', 7],
        ['v2', 3],
      ]),
    );
    expect(items).toEqual([
      { internalVariantId: 'v1', stock: 7, price: { amount: 39, currency: 'PLN' } },
      { internalVariantId: 'v2', stock: 3, price: { amount: 39, currency: 'PLN' } },
    ]);
  });

  it('drops excluded variants', () => {
    const rows = [
      makeRow('prod_1', [makeVariantRow('v1'), makeVariantRow('v2', { included: false })]),
    ];
    const items = buildBulkShopPublishItems(rows, config(), new Map([['v1', 5]]));
    expect(items.map((i) => i.internalVariantId)).toEqual(['v1']);
  });

  it('applies flat stock + flat price policies', () => {
    const rows = [makeRow('prod_1', [makeVariantRow('v1')])];
    const items = buildBulkShopPublishItems(
      rows,
      config({ stockPolicy: { mode: 'flat', value: 10 }, pricingPolicy: { mode: 'flat', amount: 99 } }),
      new Map(),
    );
    expect(items).toEqual([
      { internalVariantId: 'v1', stock: 10, price: { amount: 99, currency: 'PLN' } },
    ]);
  });

  it('omits price when master price is missing under use-master pricing', () => {
    const rows = [makeRow('prod_1', [makeVariantRow('v1', { masterPrice: null })])];
    const items = buildBulkShopPublishItems(rows, config(), new Map([['v1', 4]]));
    expect(items).toEqual([{ internalVariantId: 'v1', stock: 4 }]);
    expect(items[0]).not.toHaveProperty('price');
  });

  it('sends 0 stock when no availability is known under use-master stock', () => {
    const rows = [makeRow('prod_1', [makeVariantRow('v1')])];
    const items = buildBulkShopPublishItems(rows, config(), new Map());
    expect(items[0].stock).toBe(0);
  });
});

const shopConnection = {
  id: 'conn_shop',
  name: 'My Shop',
  status: 'active',
  platformType: 'woocommerce',
  supportedCapabilities: ['ProductPublisher'],
  enabledCapabilities: ['ProductPublisher'],
} as unknown as Connection;

function renderStep(
  rows: BulkWizardRow[],
  cfg: BulkWizardConfig,
  handlers: {
    onPublish?: (items: BulkShopPublishItemRequest[], status: ShopPublishVisibility) => void;
    onSetVariantIncluded?: (p: string, v: string, i: boolean) => void;
    onBack?: () => void;
  } = {},
  availability: { productVariantId: string; totalAvailable: number }[] = [],
): void {
  const apiClient = createMockApiClient({
    inventory: {
      availability: vi.fn().mockResolvedValue({ items: availability }),
    },
  });
  renderWithProviders(
    <BulkShopReviewStep
      rows={rows}
      connection={shopConnection}
      config={cfg}
      demoReadOnly={false}
      isSubmitting={false}
      errorMessage={null}
      alreadyListedVariantIds={new Set<string>()}
      destinationName="Test Shop"
      onSetVariantIncluded={handlers.onSetVariantIncluded ?? ((): void => undefined)}
      onBack={handlers.onBack ?? ((): void => undefined)}
      onPublish={handlers.onPublish ?? ((): void => undefined)}
    />,
    { apiClient },
  );
}

describe('BulkShopReviewStep (render)', () => {
  it('renders one row per included variant and displays the resolved stock + price it will submit', async () => {
    const rows = [makeRow('prod_1', [makeVariantRow('v1'), makeVariantRow('v2', { included: false })])];
    // use-master stock (availability 7) + flat price 99 -> review must show both.
    renderStep(
      rows,
      config({ pricingPolicy: { mode: 'flat', amount: 99 } }),
      {},
      [{ productVariantId: 'v1', totalAvailable: 7 }],
    );

    // Only the included variant renders a row.
    expect(await screen.findByLabelText('Remove P - v1')).toBeInTheDocument();
    expect(screen.queryByLabelText('Remove P - v2')).not.toBeInTheDocument();

    // Displayed stock == resolved availability; price == flat policy value.
    await waitFor(() => {
      expect(screen.getByText('7')).toBeInTheDocument();
    });
    expect(screen.getByText('99 PLN')).toBeInTheDocument();
  });

  it('publishes the resolved items with the chosen visibility', async () => {
    const onPublish = vi.fn();
    const rows = [makeRow('prod_1', [makeVariantRow('v1')])];
    renderStep(
      rows,
      config({ pricingPolicy: { mode: 'flat', amount: 99 } }),
      { onPublish },
      [{ productVariantId: 'v1', totalAvailable: 7 }],
    );

    // Flip visibility to Draft, then publish.
    fireEvent.click(await screen.findByRole('button', { name: 'Draft' }));
    await waitFor(() => {
      expect(screen.getByText('7')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /Publish 1 listing/ }));

    expect(onPublish).toHaveBeenCalledWith(
      [{ internalVariantId: 'v1', stock: 7, price: { amount: 99, currency: 'PLN' } }],
      'draft',
    );
  });

  it('excludes a variant via its remove button', async () => {
    const onSetVariantIncluded = vi.fn();
    const rows = [makeRow('prod_1', [makeVariantRow('v1')])];
    renderStep(rows, config(), { onSetVariantIncluded });

    fireEvent.click(await screen.findByLabelText('Remove P - v1'));
    expect(onSetVariantIncluded).toHaveBeenCalledWith('prod_1', 'v1', false);
  });

  it('shows the empty-state alert when no variants are included', () => {
    const rows = [makeRow('prod_1', [makeVariantRow('v1', { included: false })])];
    renderStep(rows, config());
    expect(screen.getByText(/No variants are included/i)).toBeInTheDocument();
  });
});
