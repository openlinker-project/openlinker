/**
 * Bench work controller (#2416, `W3b-3`)
 */
import { Reflector } from '@nestjs/core';

import { ROLES_KEY } from '../../auth/decorators/roles.decorator';
import type { IBenchWorkService } from '../application/interfaces/bench-work.service.interface';
import type { BenchWorkListView } from '../application/types/bench-work.types';
import { BenchWorkController } from './bench-work.controller';

function view(over: Partial<BenchWorkListView> = {}): BenchWorkListView {
  return {
    works: [
      {
        workId: 'w-1',
        version: 5,
        orderId: 'ol_order_1',
        orderReference: 'OL-4471',
        buyerName: 'Jan Wiśniewski',
        dispatchByAt: '2026-09-04T16:00:00Z',
        parcelIndex: 1,
        parcelTotal: 2,
        lineCount: 2,
        unitsToVerify: 6,
        state: 'packable',
        holdReason: null,
        holdPlacedAt: null,
        expeditedAt: null,
        supportedActions: ['expedite'],
      },
    ],
    executorName: 'Warehouse packing',
    routing: { ready: true },
    total: 1,
    ...over,
  };
}

function controllerFor(result: BenchWorkListView): BenchWorkController {
  const bench: IBenchWorkService = { listBenchWork: jest.fn().mockResolvedValue(result) };
  return new BenchWorkController(bench);
}

describe('BenchWorkController (#2416)', () => {
  it('should admit exactly admin, operator and packer', () => {
    // A packer must reach it — this is the first route in the tree granted to
    // that role — and `viewer` must not: the row carries a buyer name, and a
    // read-only reporting role has no business at a bench.
    const roles = new Reflector().get<string[]>(ROLES_KEY, BenchWorkController.prototype.listBenchWork);

    expect(roles).toEqual(['admin', 'operator', 'packer']);
  });

  it('should project the list field by field', async () => {
    const dto = await controllerFor(view()).listBenchWork();

    expect(dto.works).toHaveLength(1);
    expect(dto.works[0].orderReference).toBe('OL-4471');
    expect(dto.executorName).toBe('Warehouse packing');
    expect(dto.total).toBe(1);
  });

  it('should send an EXPLICIT null reason when routing is ready', async () => {
    // Never an omitted key: `#939` records that an absent optional arrives as
    // `undefined` and drops the surrounding section at the boundary schema.
    const dto = await controllerFor(view()).listBenchWork();

    expect(dto.routing).toEqual({ ready: true, reason: null });
  });

  it('should carry the reason when routing is not ready', async () => {
    const dto = await controllerFor(
      view({
        works: [],
        executorName: null,
        routing: { ready: false, reason: 'no-packing-connection' },
        total: 0,
      })
    ).listBenchWork();

    expect(dto.routing).toEqual({ ready: false, reason: 'no-packing-connection' });
  });
});
