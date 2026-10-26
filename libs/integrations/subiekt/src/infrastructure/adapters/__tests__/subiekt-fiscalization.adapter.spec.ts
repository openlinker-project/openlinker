/**
 * Subiekt Fiscalization Adapter — unit tests (#3192-fiscalization)
 *
 * Driven against a hand-rolled `FetchLike` mock (this adapter deliberately owns
 * its own transport rather than the invoicing capability's shared
 * `SubiektBridgeClient` — see the adapter's own header comment).
 *
 * @module libs/integrations/subiekt/src/infrastructure/adapters/__tests__
 */
import type { RegisterTransactionCommand } from '@openlinker/core/fiscalization';
import type { LoggerPort } from '@openlinker/shared/logging';
import type { FetchLike } from '@openlinker/shared/http';
import {
  SubiektFiscalizationAdapter,
  SUBIEKT_FISCAL_PROVIDER_TYPE,
} from '../subiekt-fiscalization.adapter';
import { SubiektBridgeTransportError } from '../../../domain/exceptions/subiekt-bridge-transport.exception';
import { SubiektBridgeAuthError } from '../../../domain/exceptions/subiekt-bridge-auth.exception';
import { SubiektConfigException } from '../../../domain/exceptions/subiekt-config.exception';

const logger: LoggerPort = {
  log: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

function command(overrides: Partial<RegisterTransactionCommand> = {}): RegisterTransactionCommand {
  return {
    connectionId: 'conn-1',
    orderId: 'ol_order_1',
    idempotencyKey: 'fiscal:conn-1:ol_order_1',
    currency: 'PLN',
    lines: [{ name: 'Widget', quantity: 1, unitPriceGross: 12.3, taxRate: '23', sku: 'SKU-1' }],
    totalGross: 12.3,
    ...overrides,
  };
}

function fakeFetch(status: number, body: unknown): FetchLike {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  }) as unknown as FetchLike;
}

describe('SubiektFiscalizationAdapter', () => {
  it('should return a registered result when the bridge confirms StatusFiskalny', async () => {
    const fetchImpl = fakeFetch(200, {
      success: true,
      data: { documentId: 131, documentNumber: 'PA 19/2026', status: 'registered', rawStatusFiskalny: 1 },
      error: null,
    });
    const adapter = new SubiektFiscalizationAdapter(
      'http://host.docker.internal:5056',
      { drukarkaFiskalnaId: 1 },
      logger,
      fetchImpl,
    );

    const result = await adapter.registerTransaction(command());

    expect(result.providerType).toBe(SUBIEKT_FISCAL_PROVIDER_TYPE);
    expect(result.providerReference).toBe('131');
    expect(result.documentReference).toBe('PA 19/2026');
    expect(result.registeredAt).toBeNull();
    expect(result.artefacts).toEqual([]);
  });

  it('should throw a failureMode=rejected error when the bridge reports rejected', async () => {
    const fetchImpl = fakeFetch(200, {
      success: true,
      data: { documentId: 0, documentNumber: '', status: 'rejected', rawStatusFiskalny: null },
      error: null,
    });
    const adapter = new SubiektFiscalizationAdapter(
      'http://host.docker.internal:5056',
      { drukarkaFiskalnaId: 1 },
      logger,
      fetchImpl,
    );

    await expect(adapter.registerTransaction(command())).rejects.toMatchObject({
      failureMode: 'rejected',
    });
  });

  it('should throw a plain (in-doubt) error, never assert success, when the bridge reports unknown', async () => {
    const fetchImpl = fakeFetch(200, {
      success: true,
      data: { documentId: 131, documentNumber: 'PA 19/2026', status: 'unknown', rawStatusFiskalny: 9 },
      error: null,
    });
    const adapter = new SubiektFiscalizationAdapter(
      'http://host.docker.internal:5056',
      { drukarkaFiskalnaId: 1 },
      logger,
      fetchImpl,
    );

    const error = await adapter.registerTransaction(command()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as { failureMode?: unknown }).failureMode).toBeUndefined();
  });

  it('should translate a network failure into an indeterminate SubiektBridgeTransportError', async () => {
    const fetchImpl: FetchLike = jest.fn().mockRejectedValue(new Error('ECONNRESET')) as unknown as FetchLike;
    const adapter = new SubiektFiscalizationAdapter(
      'http://host.docker.internal:5056',
      { drukarkaFiskalnaId: 1 },
      logger,
      fetchImpl,
    );

    await expect(adapter.registerTransaction(command())).rejects.toBeInstanceOf(
      SubiektBridgeTransportError,
    );
  });

  it('should translate a 401 into SubiektBridgeAuthError', async () => {
    const fetchImpl = fakeFetch(401, { success: false, data: null, error: 'unauthorized' });
    const adapter = new SubiektFiscalizationAdapter(
      'http://host.docker.internal:5056',
      { drukarkaFiskalnaId: 1 },
      logger,
      fetchImpl,
    );

    await expect(adapter.registerTransaction(command())).rejects.toBeInstanceOf(SubiektBridgeAuthError);
  });

  it('should refuse construction against an unsafe bridge URL', () => {
    expect(
      () =>
        new SubiektFiscalizationAdapter(
          'http://169.254.169.254',
          { drukarkaFiskalnaId: 1 },
          logger,
          fakeFetch(200, {}),
        ),
    ).toThrow(SubiektConfigException);
  });
});
