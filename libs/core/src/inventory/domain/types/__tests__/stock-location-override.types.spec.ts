/**
 * Stock Location Override Type Tests
 *
 * Unit tests for the pure `readStockLocationOverride` coercion helper (#3206).
 *
 * @module libs/core/src/inventory/domain/types/__tests__
 */

import { readStockLocationOverride } from '../stock-location-override.types';
import type { ConnectionConfig } from '@openlinker/core/identifier-mapping';

describe('readStockLocationOverride', () => {
  it('should return null when config is null or undefined', () => {
    expect(readStockLocationOverride(null)).toBeNull();
    expect(readStockLocationOverride(undefined)).toBeNull();
  });

  it('should return null when the key is absent', () => {
    expect(readStockLocationOverride({} as ConnectionConfig)).toBeNull();
  });

  it('should return null for a blank or whitespace-only value', () => {
    expect(
      readStockLocationOverride({ stockLocationOverride: '' } as ConnectionConfig)
    ).toBeNull();
    expect(
      readStockLocationOverride({ stockLocationOverride: '   ' } as ConnectionConfig)
    ).toBeNull();
  });

  it('should return null for a non-string value (mistyped config)', () => {
    expect(
      readStockLocationOverride({ stockLocationOverride: 42 } as unknown as ConnectionConfig)
    ).toBeNull();
    expect(
      readStockLocationOverride({
        stockLocationOverride: { id: 'ol_location_main' },
      } as unknown as ConnectionConfig)
    ).toBeNull();
  });

  it('should return the value verbatim when present and valid', () => {
    expect(
      readStockLocationOverride({
        stockLocationOverride: 'ol_location_main',
      } as ConnectionConfig)
    ).toBe('ol_location_main');
  });
});
