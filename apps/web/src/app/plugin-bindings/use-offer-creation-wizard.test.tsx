/**
 * useOfferCreationWizard — unit spec
 *
 * Tested against the real plugin registry — verifying that the hook
 * returns the Allegro contribution that `plugins/allegro/index.ts`
 * actually registers, and `null` for everything else.
 */
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useOfferCreationWizard } from './use-offer-creation-wizard';

describe('useOfferCreationWizard', () => {
  it('returns null when platformType is undefined', () => {
    const { result } = renderHook(() => useOfferCreationWizard(undefined));
    expect(result.current).toBeNull();
  });

  it('returns null when no plugin registers a wizard for the platform', () => {
    const { result } = renderHook(() => useOfferCreationWizard('shopify'));
    expect(result.current).toBeNull();
  });

  it('returns the Allegro contribution registered by the allegro plugin', () => {
    const { result } = renderHook(() => useOfferCreationWizard('allegro'));
    expect(result.current).not.toBeNull();
    expect(result.current?.platformType).toBe('allegro');
    expect(typeof result.current?.component).toBe('function');
  });

  it('memoises by platformType — same platform returns the same reference across re-renders', () => {
    const { result, rerender } = renderHook(({ p }) => useOfferCreationWizard(p), {
      initialProps: { p: 'allegro' },
    });
    const first = result.current;
    rerender({ p: 'allegro' });
    expect(result.current).toBe(first);
  });
});
