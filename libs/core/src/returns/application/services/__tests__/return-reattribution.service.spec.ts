/**
 * Return Re-attribution Service — unit spec (#2332)
 *
 * The counters are the subject here, not the plumbing: each one is a claim an operator
 * reads, so each has to be true. In particular the lost-race case is asserted to be
 * neither `unresolved` (which would say the return is still orphaned when it is not) nor
 * `failed` (the desired end state was reached).
 *
 * The propagation case is the other headline: a connection-resolution throw must NOT be
 * laundered into per-candidate `failed` counts, or a deleted connection produces
 * `failed: N` every tick forever with nothing above `warn`.
 *
 * @module libs/core/src/returns/application/services
 */
import { ReturnReattributionService } from '../return-reattribution.service';

const CONNECTION = '11111111-1111-1111-1111-111111111111';

describe('ReturnReattributionService', () => {
  let service: ReturnReattributionService;
  let repository: {
    findOrphansForReattribution: jest.Mock;
    countOrphansForReattribution: jest.Mock;
    claimAttribution: jest.Mock;
  };
  let identifierMapping: { getInternalId: jest.Mock };

  const candidates = (count: number): Array<{ id: string; externalOrderId: string }> =>
    Array.from({ length: count }, (_value, index) => ({
      id: `ol_return_${index}`,
      externalOrderId: `SRC-${index}`,
    }));

  beforeEach(() => {
    repository = {
      findOrphansForReattribution: jest.fn().mockResolvedValue([]),
      countOrphansForReattribution: jest.fn().mockResolvedValue(0),
      claimAttribution: jest.fn().mockResolvedValue(true),
    };
    identifierMapping = { getInternalId: jest.fn().mockResolvedValue(null) };

    service = new ReturnReattributionService(repository as never, identifierMapping as never);
    jest
      .spyOn(
        (service as unknown as { logger: { warn: (m: string) => void } }).logger,
        'warn'
      )
      .mockImplementation(() => undefined);
    jest
      .spyOn((service as unknown as { logger: { log: (m: string) => void } }).logger, 'log')
      .mockImplementation(() => undefined);
    jest
      .spyOn((service as unknown as { logger: { debug: (m: string) => void } }).logger, 'debug')
      .mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('should count every candidate unresolved when OL has still not ingested the orders', async () => {
    repository.countOrphansForReattribution.mockResolvedValue(3);
    repository.findOrphansForReattribution.mockResolvedValue(candidates(3));

    const result = await service.reconcile(CONNECTION, { limit: 10, offset: 0 });

    expect([result.scanned, result.unresolved, result.reattributed, result.failed]).toEqual([
      3, 3, 0, 0,
    ]);
    expect(repository.claimAttribution).not.toHaveBeenCalled();
  });

  it('should re-attribute an orphan once its order exists', async () => {
    repository.countOrphansForReattribution.mockResolvedValue(1);
    repository.findOrphansForReattribution.mockResolvedValue(candidates(1));
    identifierMapping.getInternalId.mockResolvedValue('ol_order_9');

    const result = await service.reconcile(CONNECTION, { limit: 10, offset: 0 });

    expect([result.reattributed, result.unresolved, result.failed]).toEqual([1, 0, 0]);
    expect(repository.claimAttribution).toHaveBeenCalledWith('ol_return_0', 'ol_order_9');
  });

  it('should count a lost claim race as alreadyAttributed, not unresolved and not failed', async () => {
    repository.countOrphansForReattribution.mockResolvedValue(1);
    repository.findOrphansForReattribution.mockResolvedValue(candidates(1));
    identifierMapping.getInternalId.mockResolvedValue('ol_order_9');
    repository.claimAttribution.mockResolvedValue(false);

    const result = await service.reconcile(CONNECTION, { limit: 10, offset: 0 });

    // `unresolved` means "OL still cannot name the order" — a peer winning the race
    // means the opposite, and it is not a fault either.
    expect([
      result.alreadyAttributed,
      result.unresolved,
      result.reattributed,
      result.failed,
    ]).toEqual([1, 0, 0, 0]);
  });

  it('should count a per-row write fault and continue the page', async () => {
    repository.countOrphansForReattribution.mockResolvedValue(2);
    repository.findOrphansForReattribution.mockResolvedValue(candidates(2));
    identifierMapping.getInternalId.mockResolvedValue('ol_order_9');
    repository.claimAttribution
      .mockRejectedValueOnce(new Error('deadlock detected'))
      .mockResolvedValueOnce(true);

    const result = await service.reconcile(CONNECTION, { limit: 10, offset: 0 });

    expect([result.scanned, result.failed, result.reattributed]).toEqual([2, 1, 1]);
  });

  it('should propagate a connection-resolution failure rather than counting it per candidate', async () => {
    repository.countOrphansForReattribution.mockResolvedValue(2);
    repository.findOrphansForReattribution.mockResolvedValue(candidates(2));
    identifierMapping.getInternalId.mockRejectedValue(new Error('ConnectionNotFound'));

    // Catching this per candidate would launder a deleted connection into `failed: N`
    // on every page, every tick, forever, with nothing above `warn`.
    await expect(service.reconcile(CONNECTION, { limit: 10, offset: 0 })).rejects.toThrow(
      'ConnectionNotFound'
    );
    expect(repository.claimAttribution).not.toHaveBeenCalled();
  });

  it('should advance the scan offset by the page it read', async () => {
    repository.countOrphansForReattribution.mockResolvedValue(100);
    repository.findOrphansForReattribution.mockResolvedValue(candidates(10));

    const result = await service.reconcile(CONNECTION, { limit: 10, offset: 20 });

    expect([result.nextOffset, result.total]).toEqual([30, 100]);
  });

  it('should wrap the scan offset to zero at the end of the candidate set', async () => {
    repository.countOrphansForReattribution.mockResolvedValue(25);
    repository.findOrphansForReattribution.mockResolvedValue(candidates(5));

    const result = await service.reconcile(CONNECTION, { limit: 10, offset: 20 });

    expect(result.nextOffset).toBe(0);
  });

  it('should restart from zero when the stored offset has run past a shrunken set', async () => {
    repository.countOrphansForReattribution.mockResolvedValue(3);
    repository.findOrphansForReattribution.mockResolvedValue(candidates(3));

    await service.reconcile(CONNECTION, { limit: 10, offset: 900 });

    // Orphans leave the set as they are attributed, so a stored offset routinely
    // outlives the total it was taken against; without the reset the pass would return
    // empty pages forever.
    expect(repository.findOrphansForReattribution).toHaveBeenCalledWith(CONNECTION, 10, 0);
  });
});
