/**
 * BulkResolveStep tests (#792 / #1741)
 *
 * The Resolve step fans category-match + availability out over EVERY sibling of
 * every product in chunked parallel calls, then hands per-variant outcomes back
 * via `onComplete` once the chunks settle. On error it surfaces a Retry
 * affordance.
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
import type { BulkVariantRow, BulkWizardRow } from './bulk-wizard.types';
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

function makeVariant(id: string, overrides: Partial<ProductVariant> = {}): ProductVariant {
  return {
    id,
    productId: 'prod_1',
    sku: id,
    attributes: { Rozmiar: 'M' },
    ean: '5901234123457',
    gtin: null,
    price: 12,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function variantRow(id: string, over: Partial<BulkVariantRow> = {}): BulkVariantRow {
  const variant = makeVariant(id, { productId: 'prod_1' });
  return {
    variantId: id,
    variant,
    ean: variant.ean,
    distinguishingAttributes: variant.attributes,
    masterStock: null,
    masterPrice: variant.price,
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
    product: {
      id: productId,
      name: 'Test product',
      currency: 'PLN',
      images: null,
      categories: [],
    } as unknown as Product,
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

function mockClient(opts: {
  results?: Record<string, EanMatchResult>;
  availability?: Array<{ productVariantId: string; totalAvailable: number; locationCount: number }>;
  categoryError?: Error;
}): ReturnType<typeof createMockApiClient> {
  const resolveCategoriesBatch = vi.fn<ResolveCategoriesBatchFn>();
  if (opts.categoryError) {
    resolveCategoriesBatch.mockRejectedValue(opts.categoryError);
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
  it('fans out over every sibling and reports per-variant blockers', async () => {
    const onComplete = vi.fn<(outcomes: BulkResolveOutcome[]) => void>();
    const apiClient = mockClient({
      results: {
        v1: { kind: 'matched', allegroCategoryId: 'cat-A', productCardId: 'card-A' },
        v2: { kind: 'no-match' },
      },
      availability: [
        { productVariantId: 'v1', totalAvailable: 5, locationCount: 1 },
        { productVariantId: 'v2', totalAvailable: 9, locationCount: 1 },
      ],
    });

    const rows = [makeRow('prod_1', [variantRow('v1'), variantRow('v2')])];

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

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
    const outcomes = onComplete.mock.calls[0][0];
    const variants = outcomes[0].variants;
    expect(variants.find((v) => v.variantId === 'v1')?.blockers).toEqual([]);
    expect(variants.find((v) => v.variantId === 'v2')?.blockers).toContain('no-match');
  });

  it('surfaces a Retry affordance on a persistent category error', async () => {
    const onComplete = vi.fn();
    const apiClient = mockClient({
      categoryError: new ApiError('boom', 400, undefined),
    });
    renderWithProviders(
      <BulkResolveStep
        rows={[makeRow('prod_1', [variantRow('v1')])]}
        connectionId="conn_1"
        pricingPolicy={{ mode: 'use-master' }}
        stockPolicy={{ mode: 'use-master' }}
        currency="PLN"
        onComplete={onComplete}
      />,
      { apiClient },
    );
    expect(await screen.findByText(/Retry resolve/i)).toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();
  });
});

describe('shouldRetryTransient', () => {
  it('retries transient network/5xx/429, not a 4xx', () => {
    expect(shouldRetryTransient(0, new ApiError('x', 0, undefined))).toBe(true);
    expect(shouldRetryTransient(0, new ApiError('x', 503, undefined))).toBe(true);
    expect(shouldRetryTransient(0, new ApiError('x', 429, undefined))).toBe(true);
    expect(shouldRetryTransient(0, new ApiError('x', 400, undefined))).toBe(false);
    expect(shouldRetryTransient(3, new ApiError('x', 503, undefined))).toBe(false);
  });
});
