/**
 * InPost Connection Tester Adapter Unit Tests (#771)
 *
 * Exercises the probe + error-translation paths so every outcome produces a
 * structured, UI-safe `ConnectionTestResult` instead of throwing — happy path,
 * auth rejection (401/403 → InpostUnauthorizedException), transport failure,
 * and an under-provisioned config.
 *
 * @module libs/integrations/inpost/src/infrastructure/adapters/__tests__
 */
import { Connection } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import type { HttpTransportFactoryPort } from '@openlinker/shared/http';
import { InpostConnectionTesterAdapter } from '../inpost-connection-tester.adapter';
import { InpostHttpClient } from '../../http/inpost-http-client';
import { InpostUnauthorizedException } from '../../../domain/exceptions/inpost-unauthorized.exception';
import { InpostNetworkException } from '../../../domain/exceptions/inpost-network.exception';

describe('InpostConnectionTesterAdapter', () => {
  const http: jest.Mocked<HttpTransportFactoryPort> = {
    forConnection: jest.fn().mockReturnValue(jest.fn()),
    evict: jest.fn(),
  };
  const tester = new InpostConnectionTesterAdapter(http);
  const resolver: CredentialsResolverPort = {
    get: jest.fn().mockResolvedValue({ apiToken: 'token-123' }),
  } as unknown as CredentialsResolverPort;

  // Fixed timestamp (not `new Date()`) so two independent calls with the same
  // config are deep-equal — a call built for `toHaveBeenCalledWith` must match
  // the one passed to the method under test, and a live clock only agrees by
  // accident of timing (the flake this file already hit once).
  function buildConnection(config: Record<string, unknown>): Connection {
    return new Connection(
      'inpost_1',
      'inpost',
      'InPost ShipX',
      'active',
      config,
      'db:ref',
      new Date(0),
      new Date(0),
      'inpost.shipx.v1',
      ['ShippingProviderManager'],
    );
  }

  const validConfig = {
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
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns success with status 200 when the probe resolves', async () => {
    jest.spyOn(InpostHttpClient.prototype, 'request').mockResolvedValue([] as never);

    const result = await tester.test(buildConnection(validConfig), resolver);

    expect(result.success).toBe(true);
    expect(result.status).toBe(200);
    expect(result.message).toBe('OK');
    expect(typeof result.latencyMs).toBe('number');
  });

  it('probes through the connection-bound transport, not a bare fetch (#1810)', async () => {
    // The whole point of the #1810 wiring: once the client no longer calls
    // `globalThis.fetch` directly, nothing but this assertion catches a
    // regression that stops threading the transport (lint sees no bare fetch).
    const fetchImpl = jest.fn();
    http.forConnection.mockClear().mockReturnValue(fetchImpl);
    jest.spyOn(InpostHttpClient.prototype, 'request').mockResolvedValue([] as never);
    // Built once and reused for the call + the assertion — two separate
    // `buildConnection()` calls mint `new Date()` independently, so a
    // millisecond boundary between them flakes `toHaveBeenCalledWith`.
    const connection = buildConnection(validConfig);

    await tester.test(connection, resolver);

    // Exactly one argument — InPost ships no manifest `defaultRateLimit`.
    expect(http.forConnection).toHaveBeenCalledWith(connection);
  });

  it('maps an auth rejection to success:false with status 401', async () => {
    jest
      .spyOn(InpostHttpClient.prototype, 'request')
      .mockRejectedValue(new InpostUnauthorizedException('access_forbidden'));

    const result = await tester.test(buildConnection(validConfig), resolver);

    expect(result.success).toBe(false);
    expect(result.status).toBe(401);
    expect(result.message).toBe('access_forbidden');
  });

  it('never throws on a transport failure — maps to success:false with no status', async () => {
    jest
      .spyOn(InpostHttpClient.prototype, 'request')
      .mockRejectedValue(new InpostNetworkException('ShipX network error'));

    const result = await tester.test(buildConnection(validConfig), resolver);

    expect(result.success).toBe(false);
    expect(result.status).toBeUndefined();
    expect(result.message).toBe('ShipX network error');
  });

  it('never throws on an under-provisioned config — surfaces the config error', async () => {
    const requestSpy = jest.spyOn(InpostHttpClient.prototype, 'request');

    const result = await tester.test(buildConnection({ environment: 'sandbox' }), resolver);

    expect(result.success).toBe(false);
    expect(result.message).toContain('organizationId');
    // Probe never ran — config validation short-circuited before any HTTP call.
    expect(requestSpy).not.toHaveBeenCalled();
  });
});
