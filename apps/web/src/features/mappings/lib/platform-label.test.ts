/**
 * Platform-label resolver tests (#2088)
 *
 * @module apps/web/src/features/mappings/lib
 */

import { describe, expect, it } from 'vitest';
import {
  findPlatformDisplayName,
  resolvePlatformLabel,
  resolvePlatformShortLabel,
} from './platform-label';

const PLATFORMS = [
  { platformType: 'allegro', displayName: 'Allegro' },
  { platformType: 'prestashop', displayName: 'PrestaShop' },
  // The two the deleted `CHANNEL_LABELS` map had no row for, which is what made
  // them render raw and lowercase on the Orders list before #2088.
  { platformType: 'erli', displayName: 'Erli' },
  { platformType: 'woocommerce', displayName: 'WooCommerce' },
] as const;

describe('resolvePlatformLabel', () => {
  it('returns the registry display name for a known platform', () => {
    expect(resolvePlatformLabel(PLATFORMS, 'woocommerce')).toBe('WooCommerce');
    expect(resolvePlatformLabel(PLATFORMS, 'erli')).toBe('Erli');
  });

  it('accepts anything carrying a platformType, not just a bare string', () => {
    expect(resolvePlatformLabel(PLATFORMS, { platformType: 'prestashop' })).toBe('PrestaShop');
  });

  it('falls back to the raw platformType for an unregistered platform', () => {
    expect(resolvePlatformLabel(PLATFORMS, 'shopify')).toBe('shopify');
    expect(resolvePlatformLabel(PLATFORMS, { platformType: 'shopify' })).toBe('shopify');
  });

  it('falls back to the raw platformType when the plugin list is empty', () => {
    // Not a production state — the provider flattens a synchronous module
    // constant, so no render ever sees an empty registry. Pinned because
    // fixture-driven suites do pass one, and because the defensive contract is
    // what lets every call site drop its own `?? platformType`.
    expect(resolvePlatformLabel([], 'allegro')).toBe('allegro');
  });

  it('returns an empty string rather than throwing on an empty platformType', () => {
    expect(resolvePlatformLabel(PLATFORMS, '')).toBe('');
  });
});

describe('findPlatformDisplayName', () => {
  it('returns the registry display name for a known platform', () => {
    expect(findPlatformDisplayName(PLATFORMS, 'allegro')).toBe('Allegro');
    expect(findPlatformDisplayName(PLATFORMS, { platformType: 'allegro' })).toBe('Allegro');
  });

  it('returns undefined for an unregistered platform so the caller can pick its own fallback', () => {
    // The coverage pills and the product row detail fall back to
    // `connection.name`, not to the raw type — that is the whole reason this
    // variant exists.
    expect(findPlatformDisplayName(PLATFORMS, 'shopify')).toBeUndefined();
  });

  it('returns undefined when the plugin list is empty', () => {
    expect(findPlatformDisplayName([], 'allegro')).toBeUndefined();
  });
});

describe('resolvePlatformShortLabel', () => {
  const WITH_SHORT = [
    ...PLATFORMS,
    {
      platformType: 'subiekt-gt',
      displayName: 'Subiekt GT (Sfera GT bridge)',
      shortLabel: 'Subiekt GT',
    },
  ];

  it('should return the declared short label when the plugin declares one', () => {
    expect(resolvePlatformShortLabel(WITH_SHORT, 'subiekt-gt')).toBe('Subiekt GT');
    expect(resolvePlatformShortLabel(WITH_SHORT, { platformType: 'subiekt-gt' })).toBe(
      'Subiekt GT',
    );
  });

  it('should fall back to the display name when the plugin declares no short label', () => {
    expect(resolvePlatformShortLabel(WITH_SHORT, 'allegro')).toBe('Allegro');
  });

  it('should fall back to the raw platformType when the platform is unregistered', () => {
    expect(resolvePlatformShortLabel(WITH_SHORT, 'shopify')).toBe('shopify');
  });
});
