import type { ArgumentsHost } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import {
  CorrectionConfirmationRequiredError,
  CorrectionContendedError,
  InventoryCorrectionRefusedError,
  InventoryCorrectionTargetRefusedError,
  InventoryCorrectionVariantNotFoundError,
} from '@openlinker/core/inventory';
import { InventoryCorrectionExceptionFilter } from './inventory-correction-exception.filter';

function createHost(): { host: ArgumentsHost; status: jest.Mock; json: jest.Mock } {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('InventoryCorrectionExceptionFilter', () => {
  const filter = new InventoryCorrectionExceptionFilter();

  it('should return 404 for an unknown variant', () => {
    const { host, status, json } = createHost();
    filter.catch(new InventoryCorrectionVariantNotFoundError('v1'), host);
    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(json).toHaveBeenCalledWith(expect.not.objectContaining({ code: expect.anything() as unknown }));
  });

  it('should return 409 with the target reason as code', () => {
    const { host, status, json } = createHost();
    filter.catch(new InventoryCorrectionTargetRefusedError('ambiguous-inventory-master'), host);
    expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'ambiguous-inventory-master', statusCode: 409 })
    );
  });

  it('should return 409 confirmation-required with both thresholds', () => {
    const { host, status, json } = createHost();
    filter.catch(new CorrectionConfirmationRequiredError(60, 100), host);
    expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'confirmation-required',
        requestedDelta: 60,
        currentQuantity: 100,
        absoluteThresholdUnits: 50,
        relativeThreshold: 0.5,
      })
    );
  });

  it('should return 409 contended', () => {
    const { host, status, json } = createHost();
    filter.catch(new CorrectionContendedError(), host);
    expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: 'contended' }));
  });

  it('should return 409 for no-change, master-unreadable and insufficient-stock', () => {
    for (const reason of ['no-change', 'master-unreadable', 'insufficient-stock'] as const) {
      const { host, status, json } = createHost();
      filter.catch(new InventoryCorrectionRefusedError(reason, 'x'), host);
      expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: reason }));
    }
  });

  it('should carry currentQuantity in the body for insufficient-stock', () => {
    const { host, status, json } = createHost();
    filter.catch(new InventoryCorrectionRefusedError('insufficient-stock', 'x', 3), host);
    expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'insufficient-stock', currentQuantity: 3 })
    );
  });

  it('should return 400 for note-required and invalid-quantity', () => {
    for (const reason of ['note-required', 'invalid-quantity'] as const) {
      const { host, status } = createHost();
      filter.catch(new InventoryCorrectionRefusedError(reason, 'x'), host);
      expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    }
  });
});
