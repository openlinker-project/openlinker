/**
 * Receipt line-name budget resolution - unit tests (#3914)
 *
 * @module apps/api/src/integrations/application/services
 */
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { LoggerPort } from '@openlinker/shared/logging';
import { resolveReceiptLineNameLimit } from './resolve-receipt-line-name-limit';

const logger: LoggerPort = { log: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };

function integrationsListing(adapters: unknown[]): IIntegrationsService {
  return {
    listCapabilityAdapters: jest.fn().mockResolvedValue(
      adapters.map((adapter, index) => ({
        connectionId: `conn-${index}`,
        connection: {},
        adapter,
        metadata: {},
      })),
    ),
  } as unknown as IIntegrationsService;
}

describe('resolveReceiptLineNameLimit', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should use the fallback as undeclared when no fiscalization connection exists', async () => {
    await expect(resolveReceiptLineNameLimit(integrationsListing([]), logger)).resolves.toEqual({
      maxLength: 40,
      declared: false,
    });
  });

  it('should take the shortest declared budget when adapters declare one', async () => {
    const integrations = integrationsListing([
      Promise.resolve({ registerTransaction: jest.fn(), getReceiptLineNameMaxLength: () => 40 }),
      Promise.resolve({ registerTransaction: jest.fn(), getReceiptLineNameMaxLength: () => 28 }),
      Promise.resolve({ registerTransaction: jest.fn() }),
    ]);
    await expect(resolveReceiptLineNameLimit(integrations, logger)).resolves.toEqual({
      maxLength: 28,
      declared: true,
    });
    expect(integrations.listCapabilityAdapters).toHaveBeenCalledWith({
      capability: 'Fiscalization',
      lazy: true,
    });
  });

  it('should skip a connection whose adapter cannot be constructed when another declares', async () => {
    const integrations = integrationsListing([
      Promise.reject(new Error('credentials missing')),
      Promise.resolve({ registerTransaction: jest.fn(), getReceiptLineNameMaxLength: () => 36 }),
    ]);
    await expect(resolveReceiptLineNameLimit(integrations, logger)).resolves.toEqual({
      maxLength: 36,
      declared: true,
    });
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('should fall back when listing the connections fails', async () => {
    const integrations = {
      listCapabilityAdapters: jest.fn().mockRejectedValue(new Error('db down')),
    } as unknown as IIntegrationsService;
    await expect(resolveReceiptLineNameLimit(integrations, logger)).resolves.toEqual({
      maxLength: 40,
      declared: false,
    });
  });
});
