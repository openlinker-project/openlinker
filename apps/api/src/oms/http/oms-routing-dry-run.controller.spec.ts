import { BadRequestException } from '@nestjs/common';

import type { IRoutingDryRunService } from '../application/interfaces/routing-dry-run.service.interface';
import { OmsRoutingDryRunController } from './oms-routing-dry-run.controller';
import type { RoutingDryRunRequestDto } from './dto/routing-dry-run-request.dto';

const result = {
  input: {
    lines: [],
    shipTo: { mode: 'plain', countryIso2: 'PL', postalCode: null, city: null },
    requestedDeliveryMethod: null,
  },
  saved: { candidates: [], unfulfillable: [], explanation: [] },
};

function build(): { controller: OmsRoutingDryRunController; dryRun: jest.Mock } {
  const dryRun = jest.fn(async () => await Promise.resolve(result));
  const controller = new OmsRoutingDryRunController({ dryRun } as unknown as IRoutingDryRunService);
  return { controller, dryRun };
}

const basket = { lines: [{ productVariantId: 'v1', quantity: 1 }], countryIso2: 'PL' };

describe('OmsRoutingDryRunController', () => {
  it('should refuse a body with neither an order nor a basket', async () => {
    const { controller, dryRun } = build();

    await expect(controller.dryRun('c1', {} as RoutingDryRunRequestDto)).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(dryRun).not.toHaveBeenCalled();
  });

  it('should refuse a body with both an order and a basket', async () => {
    const { controller, dryRun } = build();

    await expect(
      controller.dryRun('c1', { orderId: 'o1', basket } as RoutingDryRunRequestDto)
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(dryRun).not.toHaveBeenCalled();
  });

  it('should pass an order subject and the draft through to the service', async () => {
    const { controller, dryRun } = build();
    const draftRules = [
      { id: 'd1', position: 1, kind: 'filter', name: 'in-stock', afterAction: 'quantity-split' },
    ];

    await controller.dryRun('c1', { orderId: 'o1', draftRules } as RoutingDryRunRequestDto);

    expect(dryRun).toHaveBeenCalledWith('c1', { subject: { orderId: 'o1' }, draftRules });
  });

  it('should pass a basket subject through to the service', async () => {
    const { controller, dryRun } = build();

    await controller.dryRun('c1', { basket } as RoutingDryRunRequestDto);

    expect(dryRun).toHaveBeenCalledWith('c1', { subject: { basket }, draftRules: undefined });
  });
});
