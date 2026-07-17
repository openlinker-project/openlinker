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
import { ApiError } from '../../../../shared/api/api-error';
import {
  BulkResolveStep,
  shouldRetryTransient,
  type BulkResolveOutcome,
} from './bulk-resolve-step';
import type { BulkWizardRow } from './bulk-wizard.types';
import type { Product, ProductVariant } from '../../../products';
import type {
  EanMatchResult,
  ResolveCategoriesBatchRequest,
  ResolveCategoriesBatchResponse,
} from '../../api/listings.types';

type ResolveCategoriesBatchFn = (
  connectionId: string,
  body: ResolveCategoriesBatchRequest,
) => Promise<ResolveCategoriesBatchResponse>;

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
    resolvedProductCardId: null,
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
  /** Reject every category call with this error (persistent failure). */
  categoryError?: Error;
  /** Reject the first N category calls with this error, then resolve `results`. */
  categoryTransientError?: { error: Error; failures: number };
}): ReturnType<typeof createMockApiClient> {
  const resolveCategoriesBatch = vi.fn<ResolveCategoriesBatchFn>();
  if (opts.categoryError) {
    resolveCategoriesBatch.mockRejectedValue(opts.categoryError);
  } else if (opts.categoryTransientError) {
    const { error, failures } = opts.categoryTransientError;
    for (let i = 0; i < failures; i += 1) {
      resolveCategoriesBatch.mockRejectedValueOnce(error);
    }
    resolveCategoriesBatch.mockResolvedValue({ results: opts.results ?? {} });
  } else {
    resolveCategoriesBatch.mockResolvedValue({ results: opts.results ?? {} });
  }

  return createMockApiClient({
    listings: { resolveCategoriesBatch },
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
    expect(outcomes[0]).toMatchObject({
      resolvedCategoryId: 'cat-A',
      resolvedProductCardId: 'card-A',
      masterPrice: 12,
      masterStock: 5,
    });
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

  it('threads source categories and resolves a mapped category (EAN no-match) without blocking the row', async () => {
    const onComplete = vi.fn<(outcomes: BulkResolveOutcome[]) => void>();
    // EAN misses Allegro's catalogue, but the operator's PS→Allegro category
    // mapping resolves the destination category server-side (#1522).
    const apiClient = mockClient({
      results: {
        var_prod_a: {
          kind: 'matched',
          allegroCategoryId: 'cat-mapped',
          productCardId: '',
          method: 'category_mapping',
        },
      },
      availability: [{ productVariantId: 'var_prod_a', totalAvailable: 5, locationCount: 1 }],
    });

    renderWithProviders(
      <BulkResolveStep
        rows={[makeRow('prod_a', { ean: '5901111111111' }, { categories: ['ps-cat-42'] })]}
        connectionId="conn_1"
        pricingPolicy={{ mode: 'use-master' }}
        stockPolicy={{ mode: 'use-master' }}
        currency="PLN"
        onComplete={onComplete}
      />,
      { apiClient },
    );

    await waitFor(() => { expect(onComplete).toHaveBeenCalledTimes(1); });

    // The row's source category is threaded into the batch request.
    expect(apiClient.listings.resolveCategoriesBatch).toHaveBeenCalledWith('conn_1', {
      items: [{ variantId: 'var_prod_a', ean: '5901111111111', sourceCategoryIds: ['ps-cat-42'] }],
    });

    const out = onComplete.mock.calls[0][0][0];
    // Mapping-resolved rows are NOT blocked and carry no category blocker.
    expect(out.blockers).not.toContain('no-match');
    expect(out.blockers).not.toContain('no-ean');
    expect(out).toMatchObject({
      resolvedCategoryId: 'cat-mapped',
      resolvedProductCardId: null,
      resolutionMethod: 'category_mapping',
    });
  });

  it('fails fast on a hard 4xx: shows the Retry affordance, does not retry, does not advance', async () => {
    const onComplete = vi.fn<(outcomes: BulkResolveOutcome[]) => void>();
    const apiClient = mockClient({ categoryError: new ApiError('Bad request', 400, null) });

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
    // A 4xx is not transient - the single call is never retried.
    expect(apiClient.listings.resolveCategoriesBatch).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('auto-retries a transient 5xx and advances on the eventual success (no manual refresh)', async () => {
    const onComplete = vi.fn<(outcomes: BulkResolveOutcome[]) => void>();
    const apiClient = mockClient({
      categoryTransientError: { error: new ApiError('Allegro 503', 503, null), failures: 1 },
      results: { var_prod_a: { kind: 'matched', allegroCategoryId: 'cat-A', productCardId: 'card-A' } },
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

    // First call rejects (503, transient), the query retries after its backoff
    // and the second call resolves - the step advances without operator action.
    await waitFor(() => { expect(onComplete).toHaveBeenCalledTimes(1); }, { timeout: 6000 });
    expect(apiClient.listings.resolveCategoriesBatch).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(onComplete.mock.calls[0][0][0].blockers.length).toBe(0);
  }, 10000);
});

describe('shouldRetryTransient', () => {
  it('retries transient conditions (timeout/network, 429, 5xx) up to the cap', () => {
    expect(shouldRetryTransient(0, new ApiError('timeout', 0, null))).toBe(true);
    expect(shouldRetryTransient(0, new ApiError('rate limited', 429, null))).toBe(true);
    expect(shouldRetryTransient(0, new ApiError('boom', 503, null))).toBe(true);
    // A non-ApiError (unexpected throw) is treated as transient.
    expect(shouldRetryTransient(0, new Error('unknown'))).toBe(true);
  });

  it('does not retry hard client errors (4xx other than 429)', () => {
    expect(shouldRetryTransient(0, new ApiError('bad request', 400, null))).toBe(false);
    expect(shouldRetryTransient(0, new ApiError('not found', 404, null))).toBe(false);
    expect(shouldRetryTransient(0, new ApiError('conflict', 409, null))).toBe(false);
  });

  it('stops retrying once the failure count reaches the cap', () => {
    expect(shouldRetryTransient(3, new ApiError('boom', 503, null))).toBe(false);
  });
});
