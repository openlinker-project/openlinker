import type { ModuleRef } from '@nestjs/core';
import { notifySalesDocumentIssued } from './notify-sales-document-issued';

const event = { internalOrderId: 'ol_order_1', documentKind: 'invoice', issuedAt: new Date() };

describe('notifySalesDocumentIssued (#3554)', () => {
  const logger = { warn: jest.fn() };

  it('should tell the bound listener', async () => {
    const listener = { onOriginatingDocumentIssued: jest.fn().mockResolvedValue(undefined) };
    const moduleRef = { get: jest.fn(() => listener) } as unknown as ModuleRef;

    await notifySalesDocumentIssued(moduleRef, event, logger);

    expect(listener.onOriginatingDocumentIssued).toHaveBeenCalledWith(event);
  });

  it('should skip silently when no listener is bound in this process', async () => {
    const moduleRef = {
      get: jest.fn(() => {
        throw new Error('not bound');
      }),
    } as unknown as ModuleRef;

    await expect(notifySalesDocumentIssued(moduleRef, event, logger)).resolves.toBeUndefined();
  });

  it('should log, never throw, when the listener fails', async () => {
    const listener = { onOriginatingDocumentIssued: jest.fn().mockRejectedValue(new Error('boom')) };
    const moduleRef = { get: jest.fn(() => listener) } as unknown as ModuleRef;

    await expect(notifySalesDocumentIssued(moduleRef, event, logger)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});
