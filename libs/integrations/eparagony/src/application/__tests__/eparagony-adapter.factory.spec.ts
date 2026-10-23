/**
 * eparagony.pl Adapter Factory - client reuse and its invalidation (#3382)
 *
 * The subject is the token, not the object graph. `getCapabilityAdapter`
 * constructs a fresh adapter per call, so before this fix every fiscal
 * document also got a fresh HTTP client with an empty token cache - measured
 * on the #2840 perf stand as 22 `/auth/token` requests for 22 documents.
 * These assert through the CLIENT IDENTITY the adapters are handed, because
 * that is what owns the token; asserting the factory returned something
 * would prove nothing about whether the token survived.
 *
 * @module libs/integrations/eparagony/src/application/__tests__
 */
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import type { LoggerPort } from '@openlinker/shared/logging';

import { EparagonyAdapterFactory } from '../eparagony-adapter.factory';
import type { EparagonyFiscalizationAdapter } from '../../infrastructure/adapters/eparagony-fiscalization.adapter';
import type { EparagonyInvoicingAdapter } from '../../infrastructure/adapters/eparagony-invoicing.adapter';

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
    },
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  }) as unknown as Connection;

const makeResolver = (
  over: { clientId?: string; clientSecret?: string; integrationId?: string } = {},
): CredentialsResolverPort =>
  ({
    get: jest.fn().mockResolvedValue({
      clientId: over.clientId ?? 'cid',
      clientSecret: over.clientSecret ?? 's3cret',
      ...(over.integrationId === undefined ? {} : { integrationId: over.integrationId }),
    }),
  }) as unknown as CredentialsResolverPort;

/**
 * The client the fiscalization adapter was actually handed - the thing that
 * owns the token. Reading it off the adapter instance (rather than trusting
 * the factory returned "a client") is what makes these assertions honest.
 */
const clientOf = (
  adapters: { fiscalization: EparagonyFiscalizationAdapter; invoicing: EparagonyInvoicingAdapter },
): unknown => (adapters.fiscalization as unknown as { http: unknown }).http;

describe('EparagonyAdapterFactory', () => {
  describe('client reuse', () => {
    it('should reuse the same HTTP client across two calls for an unchanged connection', async () => {
      const factory = new EparagonyAdapterFactory();
      const connection = makeConnection();
      const resolver = makeResolver();

      const first = await factory.createAdapters(connection, resolver, logger, fetchImpl);
      const second = await factory.createAdapters(connection, resolver, logger, fetchImpl);

      expect(clientOf(second)).toBe(clientOf(first));
    });

    it('should build both adapters over ONE client within a single call', async () => {
      const factory = new EparagonyAdapterFactory();
      const connection = makeConnection();
      const resolver = makeResolver();

      const adapters = await factory.createAdapters(connection, resolver, logger, fetchImpl);

      expect((adapters.invoicing as unknown as { http: unknown }).http).toBe(clientOf(adapters));
    });
  });

  describe('client invalidation', () => {
    it('should build a NEW client when connection.updatedAt changes', async () => {
      const factory = new EparagonyAdapterFactory();
      const resolver = makeResolver();

      const first = await factory.createAdapters(makeConnection(), resolver, logger, fetchImpl);
      const second = await factory.createAdapters(
        makeConnection({ updatedAt: new Date('2026-06-01T00:00:00Z') }),
        resolver,
        logger,
        fetchImpl,
      );

      expect(clientOf(second)).not.toBe(clientOf(first));
    });

    it('should build a NEW client when the resolved credentials change (a rotation)', async () => {
      const factory = new EparagonyAdapterFactory();
      const connection = makeConnection();

      const first = await factory.createAdapters(
        connection,
        makeResolver({ clientSecret: 'old-secret' }),
        logger,
        fetchImpl,
      );
      const second = await factory.createAdapters(
        connection,
        makeResolver({ clientSecret: 'rotated-secret' }),
        logger,
        fetchImpl,
      );

      expect(clientOf(second)).not.toBe(clientOf(first));
    });

    it('should REPLACE the cached client for a connection rather than accumulate one per key', async () => {
      const factory = new EparagonyAdapterFactory();

      const first = await factory.createAdapters(
        makeConnection(),
        makeResolver({ clientSecret: 'old-secret' }),
        logger,
        fetchImpl,
      );
      const rotated = await factory.createAdapters(
        makeConnection({ updatedAt: new Date('2026-06-01T00:00:00Z') }),
        makeResolver({ clientSecret: 'rotated-secret' }),
        logger,
        fetchImpl,
      );
      const third = await factory.createAdapters(
        makeConnection({ updatedAt: new Date('2026-06-01T00:00:00Z') }),
        makeResolver({ clientSecret: 'rotated-secret' }),
        logger,
        fetchImpl,
      );

      expect(clientOf(third)).toBe(clientOf(rotated));
      expect(clientOf(third)).not.toBe(clientOf(first));
    });

    it('should scope the cache per connection id', async () => {
      const factory = new EparagonyAdapterFactory();
      const resolver = makeResolver();

      const connA = await factory.createAdapters(
        makeConnection({ id: 'conn-a' }),
        resolver,
        logger,
        fetchImpl,
      );
      const connB = await factory.createAdapters(
        makeConnection({ id: 'conn-b' }),
        resolver,
        logger,
        fetchImpl,
      );

      expect(clientOf(connB)).not.toBe(clientOf(connA));
    });
  });
});
