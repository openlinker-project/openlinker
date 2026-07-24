/**
 * resolveMappingPairing tests (#1784)
 *
 * Pure-logic coverage for the source -> destination pairing resolution used by
 * the Mapping Configuration page. Exercised without React.
 *
 * @module apps/web/src/features/mappings/hooks
 */

import { describe, expect, it } from 'vitest';
import type { Connection } from '../../connections';
import { resolveMappingPairing } from './use-mapping-pairing';

function conn(partial: Partial<Connection> & Pick<Connection, 'id' | 'platformType'>): Connection {
  return {
    name: `Connection ${partial.id}`,
    status: 'active',
    config: {},
    credentialsBacked: true,
    enabledCapabilities: [],
    supportedCapabilities: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

const presta = conn({ id: 'ps_1', platformType: 'prestashop' });
const allegro = conn({
  id: 'alg_1',
  platformType: 'allegro',
  config: { masterCatalogConnectionId: 'ps_1' },
});
const erli = conn({
  id: 'erli_1',
  platformType: 'erli',
  config: { masterCatalogConnectionId: 'ps_1' },
});
const woo = conn({
  id: 'woo_1',
  platformType: 'woocommerce',
  config: { masterCatalogConnectionId: 'ps_1' },
});

describe('resolveMappingPairing', () => {
  it('resolves a ready pair when opened from a supported source with a found master', () => {
    const result = resolveMappingPairing(allegro, [allegro, presta]);
    expect(result).toEqual({ status: 'ready', source: allegro, destination: presta });
  });

  it('returns unsupported when opened from a source whose platform is not allowlisted', () => {
    const result = resolveMappingPairing(woo, [woo, presta]);
    expect(result.status).toBe('unsupported');
    if (result.status === 'unsupported') {
      expect(result.source).toBe(woo);
      expect(result.destination).toBe(presta);
    }
  });

  it('errors when a supported source has no catalog pairing key', () => {
    const unlinked = conn({ id: 'alg_2', platformType: 'allegro', config: {} });
    const result = resolveMappingPairing(unlinked, [unlinked, presta]);
    expect(result.status).toBe('error');
  });

  it('errors when the paired master id resolves to no connection', () => {
    const dangling = conn({
      id: 'alg_3',
      platformType: 'allegro',
      config: { masterCatalogConnectionId: 'missing' },
    });
    const result = resolveMappingPairing(dangling, [dangling]);
    expect(result.status).toBe('error');
  });

  it('returns no-source when opened from a master with nothing paired', () => {
    const result = resolveMappingPairing(presta, [presta]);
    expect(result).toEqual({ status: 'no-source', master: presta });
  });

  it('resolves a ready pair when opened from a master with exactly one paired source', () => {
    const result = resolveMappingPairing(presta, [presta, allegro]);
    expect(result).toEqual({ status: 'ready', source: allegro, destination: presta });
  });

  it('returns pick-source when opened from a master with several paired sources', () => {
    const result = resolveMappingPairing(presta, [presta, allegro, erli]);
    expect(result.status).toBe('pick-source');
    if (result.status === 'pick-source') {
      expect(result.master).toBe(presta);
      expect(result.candidates).toEqual([allegro, erli]);
    }
  });

  it('ignores paired sources whose platform is not allowlisted', () => {
    // Only a WooCommerce source is paired -> no supported source.
    const result = resolveMappingPairing(presta, [presta, woo]);
    expect(result).toEqual({ status: 'no-source', master: presta });
  });

  it('includes a disabled paired source rather than dropping it to no-source (#1784 S11)', () => {
    const disabledAllegro = conn({
      id: 'alg_disabled',
      platformType: 'allegro',
      status: 'disabled',
      config: { masterCatalogConnectionId: 'ps_1' },
    });
    const result = resolveMappingPairing(presta, [presta, disabledAllegro]);
    // The single (disabled) paired source resolves to ready; the page surfaces
    // a non-active note rather than misreporting "no marketplace paired".
    expect(result).toEqual({ status: 'ready', source: disabledAllegro, destination: presta });
  });

  it('returns unsupported with a null destination when the paired master is missing', () => {
    // Unsupported source whose pairing key points at a connection not in the
    // list -> unsupported, destination null (renders "Not linked" in the bar).
    const wooDangling = conn({
      id: 'woo_2',
      platformType: 'woocommerce',
      config: { masterCatalogConnectionId: 'missing' },
    });
    const result = resolveMappingPairing(wooDangling, [wooDangling]);
    expect(result.status).toBe('unsupported');
    if (result.status === 'unsupported') {
      expect(result.source).toBe(wooDangling);
      expect(result.destination).toBeNull();
    }
  });
});
