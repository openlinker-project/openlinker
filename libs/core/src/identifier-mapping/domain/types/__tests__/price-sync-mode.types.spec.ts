/**
 * Price Sync Mode helper tests (#3142, ADR-072 decision 3)
 *
 * @module libs/core/src/identifier-mapping/domain/types/__tests__
 */
import {
  readPriceSyncModeConfig,
  readPriceSyncModeForSource,
} from '../price-sync-mode.types';

describe('price-sync-mode', () => {
  it('should default to manual when config is absent', () => {
    expect(readPriceSyncModeForSource(null, 'src-1')).toBe('manual');
    expect(readPriceSyncModeForSource({}, 'src-1')).toBe('manual');
  });

  it('should resolve the connection default', () => {
    const config = { priceSyncMode: { default: 'automatic' as const, sourceOverrides: {} } };
    expect(readPriceSyncModeForSource(config, 'src-1')).toBe('automatic');
  });

  it('should resolve a per-source override over the default', () => {
    const config = {
      priceSyncMode: {
        default: 'manual' as const,
        sourceOverrides: { 'src-1': 'automatic' as const },
      },
    };
    expect(readPriceSyncModeForSource(config, 'src-1')).toBe('automatic');
    expect(readPriceSyncModeForSource(config, 'src-2')).toBe('manual');
  });

  it('should coerce an unrecognized value to the safe default', () => {
    const config = {
      priceSyncMode: {
        default: 'bogus' as unknown as never,
        sourceOverrides: { s1: 'nope' as unknown as never },
      },
    };
    const resolved = readPriceSyncModeConfig(config);
    expect(resolved.default).toBe('manual');
    expect(resolved.sourceOverrides).toEqual({});
  });
});
