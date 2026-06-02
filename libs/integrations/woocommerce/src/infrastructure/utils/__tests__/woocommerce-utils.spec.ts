/**
 * @module libs/integrations/woocommerce/src/infrastructure/utils/__tests__
 */
import { normGmt } from '../woocommerce-utils';

describe('normGmt', () => {
  it('should append Z when gmt field is present without Z', () => {
    expect(normGmt('2024-01-15T10:30:00', '')).toBe('2024-01-15T10:30:00Z');
  });

  it('should fall back to local field + Z when gmt is absent', () => {
    expect(normGmt('', '2024-01-15T10:30:00')).toBe('2024-01-15T10:30:00Z');
  });

  it('should return epoch sentinel when both fields are empty', () => {
    expect(normGmt('', '')).toBe('1970-01-01T00:00:00.000Z');
  });

  it('should not double-append Z when gmt already has it', () => {
    expect(normGmt('2024-01-15T10:30:00Z', '')).toBe('2024-01-15T10:30:00Z');
  });
});
