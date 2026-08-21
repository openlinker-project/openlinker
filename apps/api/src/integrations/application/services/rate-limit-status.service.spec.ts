/**
 * Rate Limit Status Service Unit Tests
 *
 * @module apps/api/src/integrations/application/services
 */
import type { ConnectionPort, Connection } from '@openlinker/core/identifier-mapping';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { RateLimiterRegistry } from '@openlinker/shared/rate-limit';
import { RateLimitStatusService } from './rate-limit-status.service';

describe('RateLimitStatusService', () => {
  const connectionId = 'conn-1';

  let connectionPort: jest.Mocked<ConnectionPort>;
  let integrationsService: jest.Mocked<IIntegrationsService>;
  let rateLimiterRegistry: jest.Mocked<RateLimiterRegistry>;
  let subject: RateLimitStatusService;

  const connection = (config: Record<string, unknown> = {}): Connection =>
    ({ id: connectionId, platformType: 'prestashop', adapterKey: 'prestashop.webservice.v1', config }) as Connection;

  beforeEach(() => {
    connectionPort = { get: jest.fn() } as unknown as jest.Mocked<ConnectionPort>;
    integrationsService = {
      resolveAdapterMetadata: jest.fn(),
      // Default: no OfferManager adapter resolves, which is the ordinary case
      // for a connection that is not a marketplace (#2229).
      getCapabilityAdapter: jest.fn().mockRejectedValue(new Error('no adapter')),
    } as unknown as jest.Mocked<IIntegrationsService>;
    rateLimiterRegistry = {
      get: jest.fn(),
      getStatus: jest.fn(),
      clear: jest.fn(),
    } as unknown as jest.Mocked<RateLimiterRegistry>;
    subject = new RateLimitStatusService(connectionPort, integrationsService, rateLimiterRegistry);
  });

  it('should propagate a not-found error from the connection lookup', async () => {
    const notFound = new Error('Connection not found');
    connectionPort.get.mockRejectedValue(notFound);

    await expect(subject.getStatus(connectionId)).rejects.toThrow(notFound);
    expect(rateLimiterRegistry.getStatus).not.toHaveBeenCalled();
  });

  it('should return { enabled: false } when no explicit cap and no adapter default apply', async () => {
    connectionPort.get.mockResolvedValue(connection());
    integrationsService.resolveAdapterMetadata.mockResolvedValue({
      adapterKey: 'prestashop.webservice.v1',
      platformType: 'prestashop',
      supportedCapabilities: [],
    });

    const status = await subject.getStatus(connectionId);

    expect(status).toEqual({ enabled: false });
    expect(rateLimiterRegistry.getStatus).not.toHaveBeenCalled();
  });

  it('should fall back to the adapter default when no explicit config.rateLimit is set', async () => {
    connectionPort.get.mockResolvedValue(connection());
    integrationsService.resolveAdapterMetadata.mockResolvedValue({
      adapterKey: 'prestashop.webservice.v1',
      platformType: 'prestashop',
      supportedCapabilities: [],
      defaultRateLimit: { requestsPerMinute: 60, maxConcurrent: 4 },
    });
    rateLimiterRegistry.getStatus.mockReturnValue({
      inFlight: 1,
      queued: 0,
      lastAcquiredAt: new Date('2026-07-31T10:00:00.000Z'),
    });

    const status = await subject.getStatus(connectionId);

    expect(status).toEqual({
      enabled: true,
      requestsPerMinute: 60,
      maxConcurrent: 4,
      inFlight: 1,
      queued: 0,
      lastAcquiredAt: new Date('2026-07-31T10:00:00.000Z'),
    });
  });

  it('should prefer the explicit config.rateLimit over the adapter default', async () => {
    connectionPort.get.mockResolvedValue(connection({ rateLimit: { requestsPerMinute: 30 } }));
    rateLimiterRegistry.getStatus.mockReturnValue(null);
    integrationsService.resolveAdapterMetadata.mockResolvedValue({
      adapterKey: 'prestashop.webservice.v1',
      platformType: 'prestashop',
      // A manifest default that must NOT win over the explicit config below.
      supportedCapabilities: [],
      defaultRateLimit: { requestsPerMinute: 999, maxConcurrent: 99 },
    });

    const status = await subject.getStatus(connectionId);

    // Metadata is resolved since #2229 — for capability discovery, not as a
    // rate-limit fallback — so precedence is asserted on the reported values
    // rather than on the call never happening.
    expect(status).toEqual({
      enabled: true,
      requestsPerMinute: 30,
      maxConcurrent: undefined,
      inFlight: 0,
      queued: 0,
      lastAcquiredAt: null,
    });
  });

  it('should return { enabled: false } and skip the registry read when adapter metadata resolution fails', async () => {
    connectionPort.get.mockResolvedValue(connection());
    integrationsService.resolveAdapterMetadata.mockRejectedValue(new Error('unknown adapter'));

    const status = await subject.getStatus(connectionId);

    expect(status).toEqual({ enabled: false });
    expect(rateLimiterRegistry.getStatus).not.toHaveBeenCalled();
  });

  describe('resolve-concurrency ceiling (#2229)', () => {
    const ceiling = { maxInFlight: 9, source: 'adapter-default' as const, adapterDefault: 9 };

    /** Manifest advertising the capability — the discovery gate before the adapter is built. */
    const advertises = (): void => {
      integrationsService.resolveAdapterMetadata.mockResolvedValue({
        adapterKey: 'allegro.publicapi.v1',
        platformType: 'allegro',
        supportedCapabilities: ['OfferManager', 'EanCategoryMatcherStreaming'],
      });
    };

    const streamingAdapter = (): unknown => ({
      updateOfferQuantity: jest.fn(),
      streamCategoriesForBatchByEan: jest.fn(),
      getStreamConcurrency: jest.fn().mockReturnValue(ceiling),
    });

    it('reports the ceiling even when the shared limiter is off', async () => {
      // The whole point: `enabled: false` used to be the connection page's
      // evidence that nothing paced this connection, while a ceiling was in
      // fact applied below the limiter.
      connectionPort.get.mockResolvedValue(connection());
      advertises();
      (integrationsService.getCapabilityAdapter as jest.Mock).mockResolvedValue(streamingAdapter());

      expect(await subject.getStatus(connectionId)).toEqual({
        enabled: false,
        resolveConcurrency: ceiling,
      });
    });

    it('reports the ceiling alongside a live limiter status', async () => {
      connectionPort.get.mockResolvedValue(connection({ rateLimit: { requestsPerMinute: 30 } }));
      rateLimiterRegistry.getStatus.mockReturnValue(null);
      advertises();
      (integrationsService.getCapabilityAdapter as jest.Mock).mockResolvedValue(streamingAdapter());

      const status = await subject.getStatus(connectionId);

      expect(status.enabled).toBe(true);
      expect(status.requestsPerMinute).toBe(30);
      expect(status.resolveConcurrency).toEqual(ceiling);
    });

    it('omits the ceiling when the adapter cannot be built, without failing the read', async () => {
      // Building a capability adapter resolves credentials and throws on a
      // half-configured connection. Losing the whole rate-limit readout to a
      // supplementary line would be a regression caused by an addition.
      connectionPort.get.mockResolvedValue(connection({ rateLimit: { requestsPerMinute: 30 } }));
      rateLimiterRegistry.getStatus.mockReturnValue(null);
      advertises();
      (integrationsService.getCapabilityAdapter as jest.Mock).mockRejectedValue(
        new Error('Allegro credentials are not configured')
      );

      const status = await subject.getStatus(connectionId);

      expect(status.enabled).toBe(true);
      expect(status).not.toHaveProperty('resolveConcurrency');
    });

    it('omits the ceiling for an adapter that streams but declares no ceiling', async () => {
      // `isEanCategoryMatcherStreaming` tests only `streamCategoriesForBatchByEan`,
      // so an out-of-tree plugin compiled against an older core passes the
      // guard without the method. Probing the method is what keeps that a
      // silent omission rather than a TypeError on a settings page.
      connectionPort.get.mockResolvedValue(connection({ rateLimit: { requestsPerMinute: 30 } }));
      rateLimiterRegistry.getStatus.mockReturnValue(null);
      advertises();
      (integrationsService.getCapabilityAdapter as jest.Mock).mockResolvedValue({
        updateOfferQuantity: jest.fn(),
        streamCategoriesForBatchByEan: jest.fn(),
      });

      const status = await subject.getStatus(connectionId);

      expect(status.enabled).toBe(true);
      expect(status).not.toHaveProperty('resolveConcurrency');
    });

    it('omits the ceiling for an adapter that does not stream at all', async () => {
      connectionPort.get.mockResolvedValue(connection({ rateLimit: { requestsPerMinute: 30 } }));
      rateLimiterRegistry.getStatus.mockReturnValue(null);
      advertises();
      (integrationsService.getCapabilityAdapter as jest.Mock).mockResolvedValue({
        updateOfferQuantity: jest.fn(),
      });

      expect(await subject.getStatus(connectionId)).not.toHaveProperty('resolveConcurrency');
    });

    it('warns rather than debug-logs when a declared getStreamConcurrency throws', async () => {
      // A not-yet-credentialed connection is routine; a method whose entire
      // contract is "report a number you already computed" throwing is a
      // defect. Both degrade the same way, so the log level is the only thing
      // that keeps them apart.
      connectionPort.get.mockResolvedValue(connection({ rateLimit: { requestsPerMinute: 30 } }));
      rateLimiterRegistry.getStatus.mockReturnValue(null);
      advertises();
      (integrationsService.getCapabilityAdapter as jest.Mock).mockResolvedValue({
        updateOfferQuantity: jest.fn(),
        streamCategoriesForBatchByEan: jest.fn(),
        getStreamConcurrency: jest.fn(() => {
          throw new Error('boom');
        }),
      });
      const warn = jest
        .spyOn(
          (subject as unknown as { logger: { warn: (msg: string) => void } }).logger,
          'warn'
        )
        .mockImplementation(() => undefined);

      const status = await subject.getStatus(connectionId);

      expect(status.enabled).toBe(true);
      expect(status).not.toHaveProperty('resolveConcurrency');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('getStreamConcurrency() threw'));
      warn.mockRestore();
    });

    it('never builds the adapter when the manifest does not advertise the capability', async () => {
      // Building one resolves credentials. A deployment full of shop
      // connections must not pay that on every settings-page read, nor log a
      // credential failure for a destination that could not report a ceiling
      // in the first place.
      connectionPort.get.mockResolvedValue(connection({ rateLimit: { requestsPerMinute: 30 } }));
      rateLimiterRegistry.getStatus.mockReturnValue(null);
      integrationsService.resolveAdapterMetadata.mockResolvedValue({
        adapterKey: 'woocommerce.restapi.v3',
        platformType: 'woocommerce',
        supportedCapabilities: ['OfferManager'],
      });

      const status = await subject.getStatus(connectionId);

      expect(status).not.toHaveProperty('resolveConcurrency');
      expect(integrationsService.getCapabilityAdapter).not.toHaveBeenCalled();
    });
  });
});
