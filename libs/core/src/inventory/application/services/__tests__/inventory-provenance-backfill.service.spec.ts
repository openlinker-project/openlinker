/**
 * Inventory Provenance Backfill Service - Unit Tests
 *
 * The service is thin on purpose, so almost all of this file is about the one
 * thing it genuinely owns: the completion predicate (#2317, ADR-058 step (ii)).
 * `completed` is `remainingNull === 0` and nothing else, and the tests that
 * matter are the ones pinning what it is NOT.
 *
 * @module libs/core/src/inventory/application/services
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';

import { INVENTORY_REPOSITORY_TOKEN } from '../../../inventory.tokens';
import type { InventoryRepositoryPort } from '../../../domain/ports/inventory-repository.port';
import { InventoryProvenanceBackfillService } from '../inventory-provenance-backfill.service';

describe('InventoryProvenanceBackfillService (#2317)', () => {
  let service: InventoryProvenanceBackfillService;
  let repository: jest.Mocked<Pick<InventoryRepositoryPort, 'backfillLegacyProvenance' | 'countMissingProvenance'>>;

  beforeEach(async () => {
    repository = {
      backfillLegacyProvenance: jest.fn(),
      countMissingProvenance: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryProvenanceBackfillService,
        { provide: INVENTORY_REPOSITORY_TOKEN, useValue: repository },
      ],
    }).compile();

    service = module.get(InventoryProvenanceBackfillService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('passes the caller-supplied limit straight through to the page write', async () => {
    repository.backfillLegacyProvenance.mockResolvedValue(120);
    repository.countMissingProvenance.mockResolvedValue(0);

    await service.runPage(120);

    // Bounding is the handler's job, because the payload that supplies it is
    // the handler's to validate. This service must not silently re-bound it.
    expect(repository.backfillLegacyProvenance).toHaveBeenCalledWith(120);
  });

  it('reports completion only when NO rows remain', async () => {
    repository.backfillLegacyProvenance.mockResolvedValue(40);
    repository.countMissingProvenance.mockResolvedValue(0);

    await expect(service.runPage(500)).resolves.toEqual({
      stamped: 40,
      remainingNull: 0,
      completed: true,
    });
  });

  it('does NOT report completion when a full page still leaves rows behind', async () => {
    repository.backfillLegacyProvenance.mockResolvedValue(500);
    repository.countMissingProvenance.mockResolvedValue(1_200);

    await expect(service.runPage(500)).resolves.toEqual({
      stamped: 500,
      remainingNull: 1_200,
      completed: false,
    });
  });

  it('does NOT report completion when a page stamps zero rows but work remains', async () => {
    // The case a `stamped === 0` predicate would get catastrophically wrong.
    // Every candidate row was locked by a concurrent stock write and skipped by
    // SKIP LOCKED - a transient contention window, not a finish line. Latching
    // here would switch the pass off permanently and leave rows unstamped that
    // only #2325's failing SET NOT NULL would ever surface.
    repository.backfillLegacyProvenance.mockResolvedValue(0);
    repository.countMissingProvenance.mockResolvedValue(37);

    const result = await service.runPage(500);

    expect(result).toEqual({ stamped: 0, remainingNull: 37, completed: false });
  });

  it('reports completion when a page stamps zero rows and nothing remains', async () => {
    // The steady state on an already-drained table, reached before the latch is
    // written (or after an operator deleted it to re-arm the pass).
    repository.backfillLegacyProvenance.mockResolvedValue(0);
    repository.countMissingProvenance.mockResolvedValue(0);

    await expect(service.runPage(500)).resolves.toEqual({
      stamped: 0,
      remainingNull: 0,
      completed: true,
    });
  });

  it('counts remaining rows fresh rather than subtracting what it stamped', async () => {
    // Subtraction would drift the moment any connection-axis-less caller
    // inserted a provenance-less row mid-run, and the drift is silent: the
    // count is exactly the number #2325 gates on.
    repository.backfillLegacyProvenance.mockResolvedValue(10);
    repository.countMissingProvenance.mockResolvedValue(95);

    const result = await service.runPage(10);

    expect(repository.countMissingProvenance).toHaveBeenCalledTimes(1);
    expect(result.remainingNull).toBe(95);
  });

  it('counts AFTER stamping, so the reported figure reflects the page just written', async () => {
    const order: string[] = [];
    repository.backfillLegacyProvenance.mockImplementation(() => {
      order.push('stamp');
      return Promise.resolve(5);
    });
    repository.countMissingProvenance.mockImplementation(() => {
      order.push('count');
      return Promise.resolve(0);
    });

    await service.runPage(5);

    expect(order).toEqual(['stamp', 'count']);
  });

  it('propagates a page failure rather than reporting a false completion', async () => {
    repository.backfillLegacyProvenance.mockRejectedValue(new Error('deadlock detected'));

    await expect(service.runPage(500)).rejects.toThrow('deadlock detected');
    // Nothing is counted or concluded from a page that did not run.
    expect(repository.countMissingProvenance).not.toHaveBeenCalled();
  });
});
