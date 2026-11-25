import { describe, expect, it } from 'vitest';

import type { Product } from '../../features/products';
import { resolveSelectionBundle } from './selection-bundle';

const product = (id: string): Product => ({ id, variantCount: 1 }) as unknown as Product;

describe('resolveSelectionBundle', () => {
  it('should report tooMany when more than the limit is selected across pages', () => {
    const page = [product('p1'), product('p2')];
    const selected = new Set(Array.from({ length: 21 }, (_, i) => `p${i + 1}`));
    expect(resolveSelectionBundle(page, selected, 20)).toEqual({
      link: null,
      disabledReason: 'tooMany',
    });
  });

  it('should offer a link when the whole selection is on the page and within the limit', () => {
    const page = [product('p1'), product('p2')];
    const result = resolveSelectionBundle(page, new Set(['p1', 'p2']), 20);
    expect(result.disabledReason).toBeNull();
    expect(result.link).toContain('components=p1:1,p2:1');
  });

  it('should stay silent for a small selection that spans pages', () => {
    expect(resolveSelectionBundle([product('p1')], new Set(['p1', 'p9']), 20)).toEqual({
      link: null,
      disabledReason: null,
    });
  });

  it('should refuse a selection containing a multi-variant product', () => {
    const multi = { id: 'p2', variantCount: 3 } as unknown as Product;
    expect(resolveSelectionBundle([product('p1'), multi], new Set(['p1', 'p2']), 20).disabledReason).toBe('mixed');
  });
});
