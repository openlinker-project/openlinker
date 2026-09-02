/**
 * projectAttentionByConnection — unit tests.
 *
 * @module apps/web/src/features/fulfillment-authority/hooks
 */
import { describe, expect, it } from 'vitest';

import { projectAttentionByConnection } from './use-oms-attention-query';
import type { AuthorityAttentionItem } from '../api/who-decides.types';

function item(overrides: Partial<AuthorityAttentionItem> = {}): AuthorityAttentionItem {
  return {
    reason: 'availability-unknown',
    badge: 'stopped',
    surfaces: ['product', 'connection'],
    origin: 'authority-resolution',
    question: 'availability',
    connectionIds: ['c1', 'c2'],
    ...overrides,
  };
}

describe('projectAttentionByConnection', () => {
  it('should name every connection a connection-surface state is about', () => {
    const byConnectionId = projectAttentionByConnection([item()]);

    expect([...byConnectionId.keys()].sort()).toEqual(['c1', 'c2']);
    expect(byConnectionId.get('c1')).toHaveLength(1);
  });

  // The descriptor table answers *where a state renders* precisely so no consumer
  // re-derives it. Keying on `connectionIds` alone is right today only by
  // coincidence — all three connection-carrying states happen to declare
  // `'connection'` — so a state that names connections without rendering on them
  // would badge this table for something nothing there can act on.
  it('should NOT badge a connection for a state that renders on another surface', () => {
    const byConnectionId = projectAttentionByConnection([
      item({ reason: 'reservation-shortfall', surfaces: ['order'], connectionIds: ['c1'] }),
    ]);

    expect(byConnectionId.size).toBe(0);
  });

  it('should keep the connection-surface states when both kinds are present', () => {
    const byConnectionId = projectAttentionByConnection([
      item({ reason: 'reservation-shortfall', surfaces: ['order'], connectionIds: ['c1'] }),
      item({ reason: 'sourcing-ambiguous', surfaces: ['order', 'connection'], connectionIds: ['c1'] }),
    ]);

    expect(byConnectionId.get('c1')?.map((entry) => entry.reason)).toEqual(['sourcing-ambiguous']);
  });

  it('should collect several states named against one connection', () => {
    const byConnectionId = projectAttentionByConnection([
      item({ reason: 'availability-unknown', connectionIds: ['c1'] }),
      item({
        reason: 'returns-disposition-ambiguous',
        surfaces: ['return', 'connection'],
        connectionIds: ['c1'],
      }),
    ]);

    expect(byConnectionId.get('c1')).toHaveLength(2);
  });

  it('should return an empty map for no items', () => {
    expect(projectAttentionByConnection([]).size).toBe(0);
  });
});
