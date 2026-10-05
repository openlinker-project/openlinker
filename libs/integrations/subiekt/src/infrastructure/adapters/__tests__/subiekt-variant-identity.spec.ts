/**
 * The variant-identity resolver, and the guard that keeps it the only one.
 *
 * The rule is cheap; the guard is the point. Two masters mint a variant id for
 * the same towar, they agreed by accident for a long time, and a fix applied
 * to one of them made them disagree for all new data while leaving every
 * seeded stand unable to notice. A unit test of the rule would not have caught
 * that - only a test that no OTHER site may mint one does.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { canonicalVariantExternalId, resolveTowarVariantId } from '../subiekt-variant-identity';
import type { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';

function mapping(overrides: Partial<IdentifierMappingPort> = {}): IdentifierMappingPort {
  return {
    getInternalId: jest.fn().mockResolvedValue(null),
    getOrCreateInternalId: jest.fn((_t: string, externalId: string) =>
      Promise.resolve(`ol_variant_${externalId}`)
    ),
    getExternalIds: jest.fn().mockResolvedValue([]),
    createMapping: jest.fn(),
    ...overrides,
  } as unknown as IdentifierMappingPort;
}

describe('resolveTowarVariantId', () => {
  it('mints the canonical `{symbol}::variant` key for a towar with no history', async () => {
    const idMap = mapping();

    await expect(resolveTowarVariantId(idMap, 'conn-1', 'WOBLACK100')).resolves.toBe(
      'ol_variant_WOBLACK100::variant'
    );
    expect(idMap.getOrCreateInternalId).toHaveBeenCalledWith(
      'ProductVariant',
      'WOBLACK100::variant',
      'conn-1'
    );
  });

  // Legacy FIRST is what makes this safe to deploy rather than a one-time
  // repeat of the bug it fixes: an install already carrying bare mappings
  // keeps them instead of being re-identified on the next sweep.
  it('reuses a pre-existing bare `{symbol}` mapping and mints nothing', async () => {
    const idMap = mapping({
      getInternalId: jest.fn().mockResolvedValue('ol_variant_legacy'),
    } as Partial<IdentifierMappingPort>);

    await expect(resolveTowarVariantId(idMap, 'conn-1', 'WOBLACK100')).resolves.toBe(
      'ol_variant_legacy'
    );
    expect(idMap.getOrCreateInternalId).not.toHaveBeenCalled();
  });

  it('asks for the BARE key when it looks for a legacy mapping', async () => {
    const idMap = mapping();

    await resolveTowarVariantId(idMap, 'conn-1', 'WOBLACK100');

    expect(idMap.getInternalId).toHaveBeenCalledWith('ProductVariant', 'WOBLACK100', 'conn-1');
  });

  it('exposes the canonical key so nobody has to restate the suffix', () => {
    expect(canonicalVariantExternalId('X')).toBe('X::variant');
  });
});

// The structural half. A rule with one implementation and two callers is only
// one rule while nothing else mints. `inventory_items.productVariantId` carries
// a real foreign key, so a second minting site does not merely produce an
// inconsistent id - it produces one with no `product_variants` row behind it,
// and every inventory write for every model product fails the constraint.
describe('no adapter mints a ProductVariant id outside the shared resolver', () => {
  const adapterDir = join(__dirname, '..');

  it.each(['subiekt-product-master.adapter.ts', 'subiekt-inventory-master.adapter.ts'])(
    '%s routes every variant-id mint through resolveTowarVariantId',
    (file) => {
      const source = readFileSync(join(adapterDir, file), 'utf8');
      const mints = source.match(
        /getOrCreateInternalId\(\s*\n?\s*CORE_ENTITY_TYPE\.ProductVariant/g
      );

      // A direct mint here is what made the two masters disagree about
      // identity while agreeing about quantity. Call `resolveTowarVariantId`.
      expect(mints).toBeNull();
      expect(source).toContain('resolveTowarVariantId');
    }
  );
});
