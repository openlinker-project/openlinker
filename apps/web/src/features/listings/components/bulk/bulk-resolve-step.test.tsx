/**
 * BulkResolveStep tests (#792 PR 3 / #795)
 *
 * The Resolve step issues exactly one batch category call + one availability
 * call, then computes each row's blocker set and hands outcomes back via
 * `onComplete` once both settle. On batch error it surfaces a Retry affordance.
 */
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders, createMockApiClient } from '../../../../test/test-utils';
import { BulkResolveStep, type BulkResolveOutcome } from './bulk-resolve-step';
import type { BulkWizardRow } from './bulk-wizard.types';
import type { Product, ProductVariant } from '../../../products';
import type { EanMatchResult } from '../../api/listings.types';

function makeVariant(overrides: Partial<ProductVariant> = {}): ProductVariant {
  return {
    id: 'var_1',
    productId: 'prod_1',
    sku: 'SKU-1',
    attributes: null,
    ean: '5901234123457',
    gtin: null,
    price: 12,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'prod_1',
    name: 'Test product',
    sku: 'SKU-1',
    price: 12,
    currency: 'PLN',
    description: null,
    images: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeRow(productId: string, variant: Partial<ProductVariant>, product: Partial<Product> = {}): BulkWizardRow {
  return {
    productId,
    product: makeProduct({ id: productId, ...product }),
    primaryVariant: makeVariant({ id: `var_${productId}`, productId, ...variant }),
    blockers: [],
    resolvedCategoryId: null,
    resolutionMethod: null,
    masterPrice: null,
    masterStock: null,
    masterCurrency: null,
    categoryCandidates: [],
    override: {},
  };
}

function mockClient(opts: {
  results?: Record<string, EanMatchResult>;
  availability?: Array<{ productVariantId: string; totalAvailable: number; locationCount: number }>;
  categoryRejects?: boolean;
}) {
  return createMockApiClient({
    listings: {
      resolveCategoriesBatch: opts.categoryRejects
        ? vi.fn().mockRejectedValue(new Error('Allegro 503'))
        : vi.fn().mockResolvedValue({ results: opts.results ?? {} }),
    },
    inventory: {
      availability: vi.fn().mockResolvedValue({ items: opts.availability ?? [] }),
    },
  });
}

describe('BulkResolveStep', () => {
  it('issues one batch category call for an N-row batch and advances with empty blockers on a clean match', async () => {
    const onComplete = vi.fn<(outcomes: BulkResolveOutcome[]) => void>();
    const apiClient = mockClient({
      results: {
        var_prod_a: { kind: 'matched', allegroCategoryId: 'cat-A', productCardId: 'card-A' },
        var_prod_b: { kind: 'matched', allegroCategoryId: 'cat-B', productCardId: 'card-B' },
      },
      availability: [
        { productVariantId: 'var_prod_a', totalAvailable: 5, locationCount: 1 },
        { productVariantId: 'var_prod_b', totalAvailable: 9, locationCount: 2 },
      ],
    });

    const rows = [
      makeRow('prod_a', { ean: '5901111111111' }),
      makeRow('prod_b', { ean: '5902222222222' }),
    ];

    renderWithProviders(
      <BulkResolveStep
        rows={rows}
        connectionId="conn_1"
        pricingPolicy={{ mode: 'use-master' }}
        stockPolicy={{ mode: 'use-master' }}
        currency="PLN"
        onComplete={onComplete}
      />,
      { apiClient },
    );

    await waitFor(() => { expect(onComplete).toHaveBeenCalledTimes(1); });

    // One batch call, not one-per-row.
    expect(apiClient.listings.resolveCategoriesBatch).toHaveBeenCalledTimes(1);
    expect(apiClient.listings.resolveCategoriesBatch).toHaveBeenCalledWith('conn_1', {
      items: [
        { variantId: 'var_prod_a', ean: '5901111111111' },
        { variantId: 'var_prod_b', ean: '5902222222222' },
      ],
    });
    const outcomes = onComplete.mock.calls[0][0];
    expect(outcomes.every((o) => o.blockers.length === 0)).toBe(true);
    expect(outcomes[0]).toMatchObject({ resolvedCategoryId: 'cat-A', masterPrice: 12, masterStock: 5 });
  });

  it('flags no-master-price when the variant has no master price', async () => {
    const onComplete = vi.fn<(outcomes: BulkResolveOutcome[]) => void>();
    const apiClient = mockClient({
      results: { var_prod_a: { kind: 'matched', allegroCategoryId: 'cat-A', productCardId: 'card-A' } },
      availability: [{ productVariantId: 'var_prod_a', totalAvailable: 5, locationCount: 1 }],
    });

    renderWithProviders(
      <BulkResolveStep
        rows={[makeRow('prod_a', { ean: '590', price: null })]}
        connectionId="conn_1"
        pricingPolicy={{ mode: 'use-master' }}
        stockPolicy={{ mode: 'use-master' }}
        currency="PLN"
        onComplete={onComplete}
      />,
      { apiClient },
    );

    await waitFor(() => { expect(onComplete).toHaveBeenCalledTimes(1); });
    expect(onComplete.mock.calls[0][0][0].blockers).toContain('no-master-price');
  });

  it('flags currency-mismatch under markup when master currency differs from the batch', async () => {
    const onComplete = vi.fn<(outcomes: BulkResolveOutcome[]) => void>();
    const apiClient = mockClient({
      results: { var_prod_a: { kind: 'matched', allegroCategoryId: 'cat-A', productCardId: 'card-A' } },
      availability: [{ productVariantId: 'var_prod_a', totalAvailable: 5, locationCount: 1 }],
    });

    renderWithProviders(
      <BulkResolveStep
        rows={[makeRow('prod_a', { ean: '590', price: 200 }, { currency: 'EUR' })]}
        connectionId="conn_1"
        pricingPolicy={{ mode: 'markup', percent: 10 }}
        stockPolicy={{ mode: 'use-master' }}
        currency="PLN"
        onComplete={onComplete}
      />,
      { apiClient },
    );

    await waitFor(() => { expect(onComplete).toHaveBeenCalledTimes(1); });
    expect(onComplete.mock.calls[0][0][0].blockers).toContain('currency-mismatch');
  });

  it('carries multi-match candidates onto the outcome', async () => {
    const onComplete = vi.fn<(outcomes: BulkResolveOutcome[]) => void>();
    const apiClient = mockClient({
      results: {
        var_prod_a: {
          kind: 'multi-match',
          candidates: [{ allegroCategoryId: 'cat-X', productCardId: 'card-X', name: 'Books' }],
        },
      },
      availability: [{ productVariantId: 'var_prod_a', totalAvailable: 5, locationCount: 1 }],
    });

    renderWithProviders(
      <BulkResolveStep
        rows={[makeRow('prod_a', { ean: '590' })]}
        connectionId="conn_1"
        pricingPolicy={{ mode: 'use-master' }}
        stockPolicy={{ mode: 'use-master' }}
        currency="PLN"
        onComplete={onComplete}
      />,
      { apiClient },
    );

    await waitFor(() => { expect(onComplete).toHaveBeenCalledTimes(1); });
    const out = onComplete.mock.calls[0][0][0];
    expect(out.blockers).toContain('multi-match');
    expect(out.categoryCandidates).toHaveLength(1);
  });

  it('shows a Retry affordance and does not advance when the batch call fails', async () => {
    const onComplete = vi.fn<(outcomes: BulkResolveOutcome[]) => void>();
    const apiClient = mockClient({ categoryRejects: true });

    renderWithProviders(
      <BulkResolveStep
        rows={[makeRow('prod_a', { ean: '590' })]}
        connectionId="conn_1"
        pricingPolicy={{ mode: 'use-master' }}
        stockPolicy={{ mode: 'use-master' }}
        currency="PLN"
        onComplete={onComplete}
      />,
      { apiClient },
    );

    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();
  });
});
