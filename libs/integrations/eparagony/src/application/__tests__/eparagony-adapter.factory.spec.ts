/**
 * eparagony.pl Adapter Factory - client reuse and its invalidation (#2840)
 *
 * The subject is the token, not the object graph. `getCapabilityAdapter`
 * constructs a fresh adapter per call, so before #2840 every fiscal document
 * also got a fresh HTTP client with an empty token cache - measured on the perf
 * stand as 22 `/auth/token` requests for 22 documents, 2 000 ms of a 9 071 ms
 * registration. These assert through the CLIENT IDENTITY the adapter is handed,
 * because that is what owns the token; asserting the factory returned something
 * would prove nothing about whether the token survived.
 *
 * @module libs/integrations/eparagony/src/application/__tests__
 */
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import type { LoggerPort } from '@openlinker/shared/logging';

import { EparagonyAdapterFactory } from '../eparagony-adapter.factory';

const logger: LoggerPort = {
  log: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

const fetchImpl = jest.fn();

const makeConnection = (over: Partial<Connection> = {}): Connection =>
  ({
    id: 'conn-1',
    platformType: 'eparagony',
    name: 'perf-eparagony',
    status: 'active',
    credentialsRef: 'db:eparagony-1',
    config: {
      environment: 'sandbox',
      posId: 'pos-10',
      apiBaseUrl: 'https://api.test',
      authBaseUrl: 'https://auth.test',
    },
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  }) as unknown as Connection;

const makeResolver = (secret = 's3cret'): CredentialsResolverPort =>
  ({
    get: jest.fn().mockResolvedValue({ clientId: 'cid', clientSecret: secret }),
  }) as unknown as CredentialsResolverPort;

/**
 * The client the adapter was actually handed - the thing that owns the token.
 *
 * Reads the adapter's own `http` field, and THROWS when it is absent rather
 * than returning undefined. An accessor that silently answers undefined makes
 * `toBe` pass for two undefineds, which is how the first draft of this file had
 * a green reuse test asserting nothing at all - caught only because the
 * negative tests beside it failed.
 */
const clientOf = (adapter: unknown): unknown => {
  const client = (adapter as Record<string, unknown>)['http'];
  if (client === undefined || client === null) {
    throw new Error(
      'clientOf: the adapter exposes no `http` field - the field was renamed, and ' +
        'every assertion in this file would otherwise compare undefined with undefined',
    );
  }
  return client;
};

describe('EparagonyAdapterFactory client reuse (#2840)', () => {
  it('hands the SAME http client to two adapters for one connection', async () => {
    const factory = new EparagonyAdapterFactory();
    const resolver = makeResolver();

    const first = await factory.createFiscalizationAdapter(
      makeConnection(),
      resolver,
      logger,
      fetchImpl,
    );
    const second = await factory.createFiscalizationAdapter(
      makeConnection(),
      resolver,
      logger,
      fetchImpl,
    );

    expect(first).not.toBe(second);
    expect(clientOf(first)).toBe(clientOf(second));
  });

  it('re-resolves credentials on every call, so a rotation is always seen', async () => {
    // Not an optimisation to remove later: this read is what makes the rotation
    // case below reachable at all.
    const factory = new EparagonyAdapterFactory();
    const resolver = makeResolver();

    await factory.createFiscalizationAdapter(makeConnection(), resolver, logger, fetchImpl);
    await factory.createFiscalizationAdapter(makeConnection(), resolver, logger, fetchImpl);

    expect(resolver.get).toHaveBeenCalledTimes(2);
  });

  it('mints a new client when the client secret is rotated', async () => {
    // The case a key built from `connection.updatedAt` alone gets WRONG:
    // `ConnectionService.updateCredentials` writes only the credentials store
    // and never touches the connection row, so `updatedAt` does not move here.
    const factory = new EparagonyAdapterFactory();

    const before = await factory.createFiscalizationAdapter(
      makeConnection(),
      makeResolver('old-secret'),
      logger,
      fetchImpl,
    );
    const after = await factory.createFiscalizationAdapter(
      makeConnection(),
      makeResolver('rotated-secret'),
      logger,
      fetchImpl,
    );

    expect(clientOf(after)).not.toBe(clientOf(before));
  });

  it('mints a new client when the connection row changes', async () => {
    // Covers a host edit and, less obviously, `config.rateLimit` - the memoised
    // client closes over the connection-bound transport, so a limiter change
    // must not be served by a client holding the old one.
    const factory = new EparagonyAdapterFactory();
    const resolver = makeResolver();

    const before = await factory.createFiscalizationAdapter(
      makeConnection(),
      resolver,
      logger,
      fetchImpl,
    );
    const after = await factory.createFiscalizationAdapter(
      makeConnection({ updatedAt: new Date('2026-02-02T00:00:00Z') }),
      resolver,
      logger,
      fetchImpl,
    );

    expect(clientOf(after)).not.toBe(clientOf(before));
  });

  it('keeps one entry per connection, so repeated rotation cannot grow the map', async () => {
    const factory = new EparagonyAdapterFactory();

    for (const secret of ['a', 'b', 'c', 'd']) {
      await factory.createFiscalizationAdapter(
        makeConnection(),
        makeResolver(secret),
        logger,
        fetchImpl,
      );
    }

    expect((factory as unknown as { clients: Map<string, unknown> }).clients.size).toBe(1);
  });

  it('does not share a client between two connections', async () => {
    const factory = new EparagonyAdapterFactory();
    const resolver = makeResolver();

    const a = await factory.createFiscalizationAdapter(
      makeConnection({ id: 'conn-a' }),
      resolver,
      logger,
      fetchImpl,
    );
    const b = await factory.createFiscalizationAdapter(
      makeConnection({ id: 'conn-b' }),
      resolver,
      logger,
      fetchImpl,
    );

    expect(clientOf(a)).not.toBe(clientOf(b));
  });
});
