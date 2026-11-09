/**
 * Review Category cell (#3994) - which category a row submits under and where
 * that answer came from.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { createMockApiClient, renderWithProviders } from '../../../../test/test-utils';
import {
  ReviewCategoryCell,
  compactTrail,
  describeProductCategory,
  describeVariantCategory,
} from './bulk-review-category-cell';
import type { BulkVariantRow, BulkWizardRow } from './bulk-wizard.types';
import type { Product, ProductVariant } from '../../../products';

function variant(id: string, over: Partial<BulkVariantRow> = {}): BulkVariantRow {
  return {
    variantId: id,
    variant: { id, sku: id, attributes: {} } as unknown as ProductVariant,
    ean: '5901234000017',
    distinguishingAttributes: null,
    masterStock: 1,
    masterPrice: 10,
    masterCurrency: 'PLN',
    included: true,
    blockers: [],
    resolvedCategoryId: 'cat-own',
    resolvedProductCardId: null,
    resolutionMethod: 'category_mapping',
    overriddenCard: null,
    mappingAgrees: false,
    categoryCandidates: [],
    override: {},
    ...over,
  };
}

function row(variants: BulkVariantRow[], over: Partial<BulkWizardRow> = {}): BulkWizardRow {
  return {
    productId: 'p1',
    product: { id: 'p1', name: 'T-shirt', images: [] } as unknown as Product,
    primaryVariant: variants[0]?.variant ?? null,
    variants,
    blockers: [],
    resolvedCategoryId: null,
    resolvedProductCardId: null,
    resolutionMethod: null,
    masterPrice: 10,
    masterStock: null,
    masterCurrency: 'PLN',
    categoryCandidates: [],
    override: {},
    ...over,
  };
}

describe('describeVariantCategory', () => {
  it('should report the mapping when the mapping resolved the category', () => {
    const v = variant('v1');
    expect(describeVariantCategory(row([v]), v)).toEqual({ categoryId: 'cat-own', source: 'mapping' });
  });

  it('should tell a lone card apart from a card that agrees with the mapping', () => {
    const lone = variant('v1', { resolutionMethod: 'auto_detect' });
    const agrees = variant('v1', { resolutionMethod: 'auto_detect', mappingAgrees: true });
    expect(describeVariantCategory(row([lone]), lone).source).toBe('card');
    expect(describeVariantCategory(row([agrees]), agrees).source).toBe('card-agrees');
  });

  it('should report an operator pick over any resolution', () => {
    const v = variant('v1');
    const r = row([v], { override: { overrides: { categoryId: 'cat-picked' } } });
    expect(describeVariantCategory(r, v)).toEqual({ categoryId: 'cat-picked', source: 'picked' });
  });

  it('should report the shared product category when a sibling resolved elsewhere', () => {
    const a = variant('v1', { resolvedCategoryId: 'cat-family' });
    const b = variant('v2', { resolvedCategoryId: 'cat-other', resolutionMethod: 'auto_detect' });
    const r = row([a, b], { resolvedCategoryId: 'cat-family' });
    expect(describeVariantCategory(r, b)).toEqual({ categoryId: 'cat-family', source: 'shared' });
  });

  it('should describe a multi-variant product by its primary variant', () => {
    const a = variant('v1', { resolutionMethod: 'auto_detect', mappingAgrees: true });
    const r = row([a, variant('v2')], { resolvedCategoryId: 'cat-own' });
    expect(describeProductCategory(r)).toEqual({ categoryId: 'cat-own', source: 'card-agrees' });
  });
});

describe('compactTrail', () => {
  it('should keep the root and the parent and collapse the middle', () => {
    expect(compactTrail(['Moda', 'Odzież', 'Odzież męska', 'Koszulki'])).toBe('Moda › … › Koszulki');
    expect(compactTrail(['Moda', 'Odzież'])).toBe('Moda › Odzież');
    expect(compactTrail([])).toBe('');
  });
});

describe('ReviewCategoryCell', () => {
  it('should show the leaf, the shortened path and the source', async () => {
    const apiClient = createMockApiClient({
      mappings: {
        getCategoryPath: vi.fn().mockResolvedValue([
          { id: '1', name: 'Moda' },
          { id: '2', name: 'Odzież' },
          { id: '3', name: 'Odzież męska' },
          { id: '87913', name: 'T-shirty' },
        ]),
      },
    });
    renderWithProviders(
      <ReviewCategoryCell connectionId="c1" categoryId="87913" source="mapping" resolvesAtSubmit={false} />,
      { apiClient },
    );

    expect(await screen.findByText('T-shirty')).toBeInTheDocument();
    expect(screen.getByText('Moda › … › Odzież męska')).toBeInTheDocument();
    expect(screen.getByText('Mapping')).toBeInTheDocument();
  });

  it('should say the path is not synced rather than inventing one', async () => {
    renderWithProviders(
      <ReviewCategoryCell connectionId="c1" categoryId="252023" source="card" resolvesAtSubmit={false} />,
    );

    expect(await screen.findByText('Category 252023')).toBeInTheDocument();
    expect(screen.getByText('Path not synced yet')).toBeInTheDocument();
  });

  it('should distinguish no category from one the destination resolves at submit', () => {
    const { unmount } = renderWithProviders(
      <ReviewCategoryCell connectionId="c1" categoryId={null} source={null} resolvesAtSubmit={false} />,
    );
    expect(screen.getByText('Not set')).toBeInTheDocument();
    unmount();

    renderWithProviders(
      <ReviewCategoryCell connectionId="c1" categoryId={null} source={null} resolvesAtSubmit />,
    );
    expect(screen.getByText('Resolved at submit')).toBeInTheDocument();
  });
});

describe('ReviewCategoryCell conflict', () => {
  it('should name the catalog category on the line that opens the comparison', async () => {
    const onCompare = vi.fn();
    const apiClient = createMockApiClient({
      mappings: {
        getCategoryPath: vi.fn((_c: string, id: string) =>
          Promise.resolve(
            id === '252023'
              ? [{ id: '1', name: 'Elektronika' }, { id: '252023', name: 'Powerbanki' }]
              : [{ id: '2', name: 'Moda' }, { id: '87913', name: 'T-shirty' }],
          ),
        ),
      },
    });
    renderWithProviders(
      <ReviewCategoryCell
        connectionId="c1"
        categoryId="87913"
        source="mapping"
        resolvesAtSubmit={false}
        conflict={{ card: { allegroCategoryId: '252023', productCardId: 'card-1' }, onCompare }}
      />,
      { apiClient },
    );

    const button = await screen.findByRole('button', { name: /Barcode matched Powerbanki/ });
    fireEvent.click(button);
    expect(onCompare).toHaveBeenCalledTimes(1);
  });

  it('should point a collapsed product at the variants that disagree', () => {
    const onReveal = vi.fn();
    renderWithProviders(
      <ReviewCategoryCell
        connectionId="c1"
        categoryId="87913"
        source="mapping"
        resolvesAtSubmit={false}
        siblingConflicts={{ count: 2, onReveal }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Barcode disagrees on 2 variants' }));
    expect(onReveal).toHaveBeenCalledTimes(1);
  });

  it('should still point at disagreeing variants when the product has no category of its own', () => {
    const onReveal = vi.fn();
    renderWithProviders(
      <ReviewCategoryCell
        connectionId="c1"
        categoryId={null}
        source={null}
        resolvesAtSubmit={false}
        siblingConflicts={{ count: 1, onReveal }}
      />,
    );

    expect(screen.getByText('Not set')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Barcode disagrees on 1 variant' }));
    expect(onReveal).toHaveBeenCalledTimes(1);
  });
});
