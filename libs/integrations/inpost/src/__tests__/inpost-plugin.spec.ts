/**
 * InPost Plugin Descriptor — unit tests
 *
 * Pins the two facts about the plugin's outbound-HTTP wiring (#1810 Phase 5)
 * that no other check can catch:
 *
 *   - `createCapabilityAdapter` resolves the connection-bound transport from
 *     `host.http` and threads it into the shipping adapter. Once the client
 *     stopped calling `globalThis.fetch` directly, the ESLint / invariant-script
 *     guards see nothing wrong with a regression that simply stops passing
 *     `fetchImpl` — the client silently falls back to the bare global.
 *
 *   - No manifest `defaultRateLimit` is passed, because InPost deliberately
 *     ships none (see the rationale on `inpostAdapterManifest`). PrestaShop's
 *     60/4 is calibrated for an operator's own shop webserver; guessing the
 *     same figure for a carrier platform would cap bulk dispatch at 1 req/s.
 *
 * @module libs/integrations/inpost/src/__tests__
 */
import { Connection } from '@openlinker/core/identifier-mapping';
import type { HostServices } from '@openlinker/plugin-sdk';
import type { FetchLike, HttpTransportFactoryPort } from '@openlinker/shared/http';

import { createInpostPlugin, inpostAdapterManifest } from '../inpost-plugin';
import { InpostShippingAdapter } from '../infrastructure/adapters/inpost-shipping.adapter';

function buildConnection(): Connection {
  return new Connection(
    'inpost_1',
    'inpost',
    'InPost ShipX',
    'active',
    {
      environment: 'sandbox',
      organizationId: '123456',
      senderAddress: {
        email: 'magazyn@acme.pl',
        phone: '+48111222333',
        address: {
          street: 'ul. Magazynowa',
          buildingNumber: '1',
          city: 'Warszawa',
          postCode: '00-001',
          countryCode: 'PL',
        },
      },
    },
    'db:ref',
    new Date(),
    new Date(),
    'inpost.shipx.v1',
    ['ShippingProviderManager'],
  );
}

/**
 * `createCapabilityAdapter` touches only `credentialsResolver` and `http`; the
 * remaining `HostServices` members (registries, logger, cache) are never
 * reached on this path, so the bag is narrowed rather than fully stubbed.
 */
function buildHost(fetchImpl: FetchLike): {
  host: HostServices;
  http: jest.Mocked<HttpTransportFactoryPort>;
} {
  const http: jest.Mocked<HttpTransportFactoryPort> = {
    forConnection: jest.fn().mockReturnValue(fetchImpl),
    evict: jest.fn(),
  };
  const host = {
    credentialsResolver: { get: jest.fn().mockResolvedValue({ apiToken: 'token-123' }) },
    http,
  } as unknown as HostServices;
  return { host, http };
}

describe('createInpostPlugin', () => {
  describe('createCapabilityAdapter', () => {
    it('resolves the connection-bound transport via host.http.forConnection (#1810)', async () => {
      const fetchImpl = jest.fn() as unknown as FetchLike;
      const { host, http } = buildHost(fetchImpl);
      const connection = buildConnection();

      const adapter = await createInpostPlugin().createCapabilityAdapter(
        connection,
        'ShippingProviderManager',
        host,
      );

      expect(adapter).toBeInstanceOf(InpostShippingAdapter);
      // Exactly one argument: no manifest `defaultRateLimit` to fall back to.
      expect(http.forConnection).toHaveBeenCalledWith(connection);
    });
  });

  describe('manifest', () => {
    it('ships no defaultRateLimit — ShipX has no documented quota to calibrate against', () => {
      expect(inpostAdapterManifest.defaultRateLimit).toBeUndefined();
    });
  });
});
