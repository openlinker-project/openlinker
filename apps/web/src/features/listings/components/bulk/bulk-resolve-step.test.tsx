/**
 * BulkResolveStep tests
 *
 * Covers the #796 regression where the 15-s fallback timeout fired with a
 * stale `resolved` closure and overwrote already-settled rows with
 * `pending-after-timeout`. Two cases:
 *
 *   1. Resolves settle fast → advance past the 15-s deadline → outcomes
 *      remain `matched`, no second `onComplete` fires.
 *   2. Slow resolves → only the unsettled rows become `pending-after-
 *      timeout`; pre-timeout settled rows keep their status.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { renderWithProviders, createMockApiClient } from '../../../../test/test-utils';
import { BulkResolveStep, BULK_RESOLVE_TIMEOUT_MS } from './bulk-resolve-step';
import type { BulkResolveOutcome } from './bulk-resolve-step';
import type { BulkWizardRow } from './bulk-wizard.types';
import type { Product, ProductVariant } from '../../../products';

function makeVariant(overrides: Partial<ProductVariant> = {}): ProductVariant {
  return {
    id: 'var_1',
    productId: 'prod_1',
    sku: 'SKU-1',
    attributes: null,
    ean: '5901234123457',
    gtin: null,
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
    price: 99.99,
    currency: 'PLN',
    description: null,
    images: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeRow(
  productId: string,
  ean: string,
  status: BulkWizardRow['status'] = 'resolving',
): BulkWizardRow {
  return {
    productId,
    product: makeProduct({ id: productId, name: `Product ${productId}` }),
    primaryVariant: makeVariant({
      id: `var_${productId}`,
      productId,
      ean,
    }),
    status,
    resolvedCategoryId: null,
    resolutionMethod: null,
    override: {},
  };
}

describe('BulkResolveStep', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should not re-fire onComplete after the 15s timeout when resolves already settled (#796 regression)', async () => {
    const onComplete = vi.fn<(outcomes: BulkResolveOutcome[]) => void>();
    const apiClient = createMockApiClient({
      listings: {
        resolveCategory: vi.fn().mockResolvedValue({
          allegroCategoryId: 'cat-A',
          method: 'auto_detect',
        }),
      },
    });

    const rows = [makeRow('prod_1', '5901234123457')];

    renderWithProviders(
      <BulkResolveStep rows={rows} connectionId="conn_1" onComplete={onComplete} />,
      { apiClient },
    );

    // Let the resolve loop's promise chain drain; the fake clock isn't
    // involved here — the mocked `resolveCategory` resolves synchronously.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onComplete).toHaveBeenCalledTimes(1);
    const firstCallOutcomes = onComplete.mock.calls[0][0];
    expect(firstCallOutcomes).toEqual([
      expect.objectContaining({ productId: 'prod_1', status: 'matched', categoryId: 'cat-A' }),
    ]);

    // Advance past the fallback deadline. The completedRef guard must
    // short-circuit the timeout, leaving onComplete at exactly one call.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BULK_RESOLVE_TIMEOUT_MS + 1_000);
    });

    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('should keep synthetic no-ean rows intact while flagging in-flight EAN rows as pending-after-timeout when the deadline hits', async () => {
    // The resolve-step seeds `no-ean` rows synchronously into the resolved
    // map (they need no BE call). When the fallback timeout fires while
    // an EAN-bearing row is still in flight, the seeded entries must be
    // preserved (proves the timeout reads the *current* ref, not the
    // closure-captured map) and the in-flight row must flip to
    // `pending-after-timeout`.
    const onComplete = vi.fn<(outcomes: BulkResolveOutcome[]) => void>();

    // Hold the EAN-row resolve indefinitely so the timeout fires first.
    let releaseSlow: (value: { allegroCategoryId: string | null; method: string }) => void;
    const slowPromise = new Promise<{ allegroCategoryId: string | null; method: string }>(
      (resolve) => {
        releaseSlow = resolve;
      },
    );

    const apiClient = createMockApiClient({
      listings: { resolveCategory: vi.fn().mockReturnValue(slowPromise) },
    });

    const rows: BulkWizardRow[] = [
      // No-ean: seeded into the resolved map at mount (no primary variant
      // EAN/GTIN). Verifies the timeout outcomes carry forward seed state.
      {
        ...makeRow('prod_noean', ''),
        primaryVariant: makeVariant({
          id: 'var_noean',
          productId: 'prod_noean',
          ean: null,
          gtin: null,
        }),
        status: 'no-ean',
      },
      // EAN row: in-flight at timeout time.
      makeRow('prod_slow', '2222222222222'),
    ];

    renderWithProviders(
      <BulkResolveStep rows={rows} connectionId="conn_1" onComplete={onComplete} />,
      { apiClient },
    );

    // No settlement yet — pAllLimit is blocked on the slow promise.
    expect(onComplete).not.toHaveBeenCalled();

    // Advance past the 15-s deadline.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BULK_RESOLVE_TIMEOUT_MS + 1);
    });

    expect(onComplete).toHaveBeenCalledTimes(1);
    const outcomes = onComplete.mock.calls[0][0];
    const noEan = outcomes.find((o) => o.productId === 'prod_noean');
    const slow = outcomes.find((o) => o.productId === 'prod_slow');
    expect(noEan).toMatchObject({ status: 'no-ean' });
    expect(slow).toMatchObject({ status: 'pending-after-timeout', categoryId: null });

    // Release the slow promise so the resolve loop unwinds cleanly under
    // fake timers (avoids a dangling pending microtask between tests).
    releaseSlow!({ allegroCategoryId: 'cat-SLOW', method: 'auto_detect' });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  });
});
