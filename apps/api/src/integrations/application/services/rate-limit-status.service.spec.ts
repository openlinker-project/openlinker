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

    const status = await subject.getStatus(connectionId);

    expect(integrationsService.resolveAdapterMetadata).not.toHaveBeenCalled();
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
});
