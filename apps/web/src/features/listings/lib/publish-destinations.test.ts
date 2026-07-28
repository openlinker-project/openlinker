import { describe, expect, it } from 'vitest';
import {
  publishDestinationKind,
  resolvePublishDestination,
  selectPublishDestinations,
} from './publish-destinations';
import type { PublishDestination } from './publish-destinations';
import type { Connection } from '../../connections';

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'c1',
    name: 'Connection 1',
    platformType: 'allegro',
    status: 'active',
    config: {},
    credentialsBacked: true,
    adapterKey: 'allegro.v1',
    enabledCapabilities: [],
    supportedCapabilities: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function dest(id: string, name: string, kind: 'marketplace' | 'shop'): PublishDestination {
  const connection = makeConnection({
    id,
    name,
    supportedCapabilities: kind === 'marketplace' ? ['OfferCreator'] : [],
    enabledCapabilities: kind === 'shop' ? ['ProductPublisher'] : [],
  });
  return { connection, kind };
}

describe('publishDestinationKind', () => {
  it('resolves marketplace when the connection advertises OfferCreator', () => {
    const connection = makeConnection({ supportedCapabilities: ['OfferCreator'] });
    expect(publishDestinationKind(connection)).toBe('marketplace');
  });

  it('resolves shop when ProductPublisher is enabled', () => {
    const connection = makeConnection({ enabledCapabilities: ['ProductPublisher'] });
    expect(publishDestinationKind(connection)).toBe('shop');
  });

  it('prefers marketplace when a connection somehow advertises both', () => {
    const connection = makeConnection({
      supportedCapabilities: ['OfferCreator'],
      enabledCapabilities: ['ProductPublisher'],
    });
    expect(publishDestinationKind(connection)).toBe('marketplace');
  });

  it('returns null when neither capability is present', () => {
    const connection = makeConnection();
    expect(publishDestinationKind(connection)).toBeNull();
  });
});

describe('selectPublishDestinations', () => {
  it('filters out inactive connections and connections with no publish capability', () => {
    const active = makeConnection({ id: 'a', supportedCapabilities: ['OfferCreator'] });
    const disabled = makeConnection({
      id: 'b',
      status: 'disabled',
      supportedCapabilities: ['OfferCreator'],
    });
    const ineligible = makeConnection({ id: 'c' });
    const result = selectPublishDestinations([active, disabled, ineligible]);
    expect(result.map((d) => d.connection.id)).toEqual(['a']);
  });

  it('sorts marketplaces before shops, then alphabetically by name within each group', () => {
    const shopB = makeConnection({
      id: 's-b',
      name: 'B Shop',
      enabledCapabilities: ['ProductPublisher'],
    });
    const marketplaceB = makeConnection({
      id: 'm-b',
      name: 'B Marketplace',
      supportedCapabilities: ['OfferCreator'],
    });
    const marketplaceA = makeConnection({
      id: 'm-a',
      name: 'A Marketplace',
      supportedCapabilities: ['OfferCreator'],
    });
    const result = selectPublishDestinations([shopB, marketplaceB, marketplaceA]);
    expect(result.map((d) => d.connection.id)).toEqual(['m-a', 'm-b', 's-b']);
  });
});

describe('resolvePublishDestination', () => {
  it('auto-resolves the single eligible destination regardless of pickedConnectionId', () => {
    const destinations = [dest('m1', 'Allegro', 'marketplace')];
    expect(resolvePublishDestination(destinations, '')).toEqual({
      resolvedConnectionId: 'm1',
      resolvedKind: 'marketplace',
    });
    expect(resolvePublishDestination(destinations, 'some-other-id')).toEqual({
      resolvedConnectionId: 'm1',
      resolvedKind: 'marketplace',
    });
  });

  it('returns null/null when there are multiple destinations and nothing has been picked yet', () => {
    const destinations = [dest('m1', 'Allegro', 'marketplace'), dest('s1', 'Shop', 'shop')];
    expect(resolvePublishDestination(destinations, '')).toEqual({
      resolvedConnectionId: null,
      resolvedKind: null,
    });
  });

  it('resolves the picked destination among multiple eligible ones', () => {
    const destinations = [dest('m1', 'Allegro', 'marketplace'), dest('s1', 'Shop', 'shop')];
    expect(resolvePublishDestination(destinations, 's1')).toEqual({
      resolvedConnectionId: 's1',
      resolvedKind: 'shop',
    });
  });

  it('echoes back a stale pickedConnectionId as resolvedConnectionId while resolvedKind is null (asymmetry, not a bug)', () => {
    // A previously-picked connection can drop out of the eligible set (e.g.
    // disabled, or its capability revoked) between renders. The picked id is
    // NOT nulled out here - only resolvedKind is, since there's no matching
    // destination to read a kind from. A future "fix" that also nulls
    // resolvedConnectionId in this branch would be a behavior change, so this
    // test pins the exact current asymmetry.
    const destinations = [dest('m1', 'Allegro', 'marketplace'), dest('s1', 'Shop', 'shop')];
    const result = resolvePublishDestination(destinations, 'stale-id');
    expect(result.resolvedConnectionId).toBe('stale-id');
    expect(result.resolvedKind).toBeNull();
  });
});
