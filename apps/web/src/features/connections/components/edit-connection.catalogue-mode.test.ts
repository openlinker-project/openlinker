/**
 * Catalogue mode config merge tests (#4281)
 *
 * The default must be written as an explicit `null`, never by deleting the key:
 * the submit merge is a shallow spread over the freshly fetched config (#2016).
 *
 * @module apps/web/src/features/connections/components
 */
import { describe, expect, it } from 'vitest';
import { mergeStructuredIntoConfig } from './edit-connection.schema';

describe('mergeStructuredIntoConfig catalogueMode', () => {
  it('should write none verbatim', () => {
    expect(mergeStructuredIntoConfig({ environment: 'sandbox' }, { catalogueMode: 'none' })).toEqual({
      environment: 'sandbox',
      catalogueMode: 'none',
    });
  });

  it('should write linked as an explicit null and keep the key present', () => {
    const merged = mergeStructuredIntoConfig({ catalogueMode: 'none' }, { catalogueMode: 'linked' });

    expect(merged).toHaveProperty('catalogueMode', null);
  });

  it('should leave the key alone when the patch does not name it', () => {
    expect(mergeStructuredIntoConfig({ catalogueMode: 'none' }, {})).toEqual({
      catalogueMode: 'none',
    });
  });

  it('should not touch the master catalog id when switching to none', () => {
    const merged = mergeStructuredIntoConfig(
      { masterCatalogConnectionId: 'c0a80101-0000-4000-8000-000000000000' },
      { catalogueMode: 'none' },
    );

    expect(merged.masterCatalogConnectionId).toBe('c0a80101-0000-4000-8000-000000000000');
  });
});
