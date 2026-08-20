/**
 * Fiscalization connection resolution — unit tests (#1909)
 */
import { describe, expect, it } from 'vitest';
import {
  selectFiscalizationCandidates,
  type FiscalizationConnectionLike,
} from './resolve-fiscalization-connection';

function conn(over: Partial<FiscalizationConnectionLike> = {}): FiscalizationConnectionLike {
  return {
    id: 'conn_a',
    status: 'active',
    enabledCapabilities: ['Fiscalization'],
    ...over,
  };
}

describe('selectFiscalizationCandidates', () => {
  it('keeps only active connections with the capability ENABLED, sorted by id', () => {
    const result = selectFiscalizationCandidates([
      conn({ id: 'conn_z' }),
      conn({ id: 'conn_disabled', status: 'disabled' }),
      conn({ id: 'conn_no_cap', enabledCapabilities: [] }),
      conn({ id: 'conn_a' }),
    ]);
    expect(result.map((c) => c.id)).toEqual(['conn_a', 'conn_z']);
  });

  it('is deterministic regardless of input order', () => {
    const a = conn({ id: 'conn_a' });
    const z = conn({ id: 'conn_z' });
    expect(selectFiscalizationCandidates([z, a]).map((c) => c.id)).toEqual(
      selectFiscalizationCandidates([a, z]).map((c) => c.id),
    );
  });
});
