/**
 * Returns Service — unit spec (#2328)
 *
 * Mocks the repository port and the identifier-mapping service; what the
 * repository's statements then do to real rows is asserted against Postgres in
 * `apps/api/test/integration/returns-ingestion.int-spec.ts`.
 *
 * @module libs/core/src/returns/application/services
 */
import { ReturnNotAttributedError } from '../../domain/exceptions/return-not-attributed.error';
import { ReturnNotFoundError } from '../../domain/exceptions/return-not-found.error';
import { ReturnObservationMissingExternalIdError } from '../../domain/exceptions/return-observation-missing-external-id.error';
import { ReturnDownstreamTriggerValues } from '../../domain/types/return-trigger.types';
import type { IncomingReturn } from '../../domain/types/incoming-return.types';
import type { UpsertReturnRecordInput } from '../../domain/types/return-upsert.types';
import { ReturnsService } from './returns.service';

const CONNECTION = '11111111-1111-1111-1111-111111111111';

const buildObservation = (overrides: Partial<IncomingReturn> = {}): IncomingReturn => ({
  externalReturnId: 'RET-1',
  externalOrderId: 'ORD-9',
  rawStatus: 'WAITING_FOR_PARCEL',
  createdAt: '2026-08-01T10:00:00.000Z',
  lines: [{ quantity: 2, reasonRaw: 'withdrawal' }],
  ...overrides,
});

describe('ReturnsService', () => {
  let service: ReturnsService;
  let repository: {
    upsertFromSource: jest.Mock;
    findById: jest.Mock;
    listOrphans: jest.Mock;
    countOrphans: jest.Mock;
    create: jest.Mock;
    findByExternalId: jest.Mock;
    listReturns: jest.Mock;
    countReturnsByBucket: jest.Mock;
  };
  let identifierMapping: { getInternalId: jest.Mock; getOrCreateInternalId: jest.Mock };
  let integrations: { getAdapter: jest.Mock; listCapabilityAdapters: jest.Mock };

  const lastInput = (): UpsertReturnRecordInput => {
    const calls = repository.upsertFromSource.mock.calls as unknown[][];
    return calls[0][0] as UpsertReturnRecordInput;
  };

  beforeEach(() => {
    repository = {
      upsertFromSource: jest.fn().mockResolvedValue({ record: { id: 'ol_return_abc' } }),
      findById: jest.fn().mockResolvedValue(null),
      listOrphans: jest.fn().mockResolvedValue([]),
      countOrphans: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      findByExternalId: jest.fn(),
      listReturns: jest.fn().mockResolvedValue([]),
      countReturnsByBucket: jest
        .fn()
        .mockResolvedValue({ total: 0, orphan: 0, attributed: 0 }),
    };
    identifierMapping = {
      getInternalId: jest.fn().mockResolvedValue('ol_order_abc'),
      getOrCreateInternalId: jest.fn(),
    };

    integrations = {
      getAdapter: jest.fn(),
      listCapabilityAdapters: jest.fn().mockResolvedValue([]),
    };

    service = new ReturnsService(
      repository as never,
      identifierMapping as never,
      integrations as never
    );
  });

  describe('upsertFromObservation', () => {
    it.each([undefined, '', '   '])(
      'should refuse an observation whose externalReturnId is %p, without touching the repository',
      async (externalReturnId) => {
        const observation = buildObservation();
        // The DTO types the field as required, so an adapter can only produce
        // this by ignoring its own contract — which is exactly the case the
        // refusal exists for.
        (observation as { externalReturnId: unknown }).externalReturnId = externalReturnId;

        await expect(service.upsertFromObservation(CONNECTION, observation)).rejects.toBeInstanceOf(
          ReturnObservationMissingExternalIdError
        );
        expect(repository.upsertFromSource).not.toHaveBeenCalled();
      }
    );

    it('should resolve the order with getInternalId and NEVER mint one', async () => {
      await service.upsertFromObservation(CONNECTION, buildObservation());

      expect(identifierMapping.getInternalId).toHaveBeenCalledWith('Order', 'ORD-9', CONNECTION);
      // getOrCreate would mint an internal id for an order OL has never
      // ingested, pointing every downstream trigger at a phantom.
      expect(identifierMapping.getOrCreateInternalId).not.toHaveBeenCalled();
      expect(lastInput().internalOrderId).toBe('ol_order_abc');
    });

    it('should persist an unresolved order as an orphan and report attributed:false', async () => {
      identifierMapping.getInternalId.mockResolvedValue(null);

      const result = await service.upsertFromObservation(CONNECTION, buildObservation());

      expect(lastInput().internalOrderId).toBeNull();
      expect(result.attributed).toBe(false);
    });

    it('should not attempt a lookup when the source reports no order', async () => {
      const result = await service.upsertFromObservation(
        CONNECTION,
        buildObservation({ externalOrderId: null })
      );

      expect(identifierMapping.getInternalId).not.toHaveBeenCalled();
      expect(lastInput().internalOrderId).toBeNull();
      expect(result.attributed).toBe(false);
    });

    it('should stamp origin source_ingested and map createdAt onto openedAt', async () => {
      await service.upsertFromObservation(CONNECTION, buildObservation());

      expect(lastInput().origin).toBe('source_ingested');
      expect(lastInput().openedAt).toEqual(new Date('2026-08-01T10:00:00.000Z'));
    });

    it('should degrade an unparseable createdAt to a null openedAt rather than throwing', async () => {
      await service.upsertFromObservation(
        CONNECTION,
        buildObservation({ createdAt: 'not a date' })
      );

      // The parcel is real regardless of how the source formatted its clock,
      // and openedAt is COALESCE-applied so a later observation can fill it in.
      expect(lastInput().openedAt).toBeNull();
    });

    it('should index lines by array order and map an unrecognised reason to other', async () => {
      await service.upsertFromObservation(
        CONNECTION,
        buildObservation({
          lines: [
            { quantity: 1, reasonRaw: 'defective', sku: 'SKU-A' },
            { quantity: 4, reasonRaw: 'BUYER_REGRET' },
          ],
        })
      );

      expect(lastInput().lines).toEqual([
        expect.objectContaining({ lineIndex: 0, reason: 'defective', sku: 'SKU-A', quantityAdvised: 1 }),
        expect.objectContaining({ lineIndex: 1, reason: 'other', quantityAdvised: 4 }),
      ]);
    });

    it('should carry the fields with no column of their own into rawPayload', async () => {
      await service.upsertFromObservation(
        CONNECTION,
        buildObservation({
          raw: { source: 'said this' },
          referenceNumber: 'RMA-7',
          isTerminalAtSource: true,
          marketplaceId: 'buyer-1',
          lines: [{ quantity: 1, reasonRaw: 'withdrawal', unitPrice: 19.99, serialNumbers: ['S1'] }],
        })
      );

      expect(lastInput().rawPayload).toEqual({
        raw: { source: 'said this' },
        referenceNumber: 'RMA-7',
        isTerminalAtSource: true,
        marketplaceId: 'buyer-1',
        lines: [{ lineIndex: 0, unitPrice: 19.99, serialNumbers: ['S1'] }],
      });
    });

    it('should store null rather than an empty document when the source said nothing extra', async () => {
      await service.upsertFromObservation(CONNECTION, buildObservation());

      expect(lastInput().rawPayload).toBeNull();
    });

    it('should never carry an OL-owned or Wave-2 field into the upsert input', async () => {
      await service.upsertFromObservation(CONNECTION, buildObservation());

      const header = lastInput() as unknown as Record<string, unknown>;
      for (const key of ['authorizedAt', 'declinedAt', 'closedAt']) {
        expect(header[key]).toBeUndefined();
      }
      const line = lastInput().lines[0] as unknown as Record<string, unknown>;
      for (const key of [
        'quantityReceived',
        'custodyState',
        'moneyState',
        'disposition',
        'resolvedOrderLineId',
      ]) {
        expect(line[key]).toBeUndefined();
      }
    });

    it('should let a connection-resolution failure surface rather than recording an orphan', async () => {
      // getInternalId reads the Connection to derive platformType, so it THROWS
      // when the connection is gone. On this path the connection exists by
      // construction, so a throw is a real failure the job must surface.
      identifierMapping.getInternalId.mockRejectedValue(new Error('ConnectionNotFound'));

      await expect(
        service.upsertFromObservation(CONNECTION, buildObservation())
      ).rejects.toThrow('ConnectionNotFound');
      expect(repository.upsertFromSource).not.toHaveBeenCalled();
    });
  });

  describe('reads', () => {
    it('should delegate getReturn to the repository', async () => {
      await service.getReturn('ol_return_abc');
      expect(repository.findById).toHaveBeenCalledWith('ol_return_abc');
    });

    it('should delegate listOrphanReturns to the repository', async () => {
      await service.listOrphanReturns(25, 50);
      expect(repository.listOrphans).toHaveBeenCalledWith(25, 50);
    });

    it('should delegate countOrphanReturns to the repository', async () => {
      repository.countOrphans.mockResolvedValue(12);

      await expect(service.countOrphanReturns()).resolves.toBe(12);
    });
  });

  describe('assertAttributedForTrigger', () => {
    const orphan = { id: 'ol_return_abc', isOrphan: () => true };
    const attributed = { id: 'ol_return_abc', isOrphan: () => false };

    it.each(ReturnDownstreamTriggerValues)(
      'should refuse the %s trigger while the return is orphaned',
      async (trigger) => {
        repository.findById.mockResolvedValue(orphan);

        await expect(
          service.assertAttributedForTrigger('ol_return_abc', trigger)
        ).rejects.toBeInstanceOf(ReturnNotAttributedError);
      }
    );

    it('should name the refused trigger on the error so an operator can tell them apart', async () => {
      repository.findById.mockResolvedValue(orphan);

      await expect(
        service.assertAttributedForTrigger('ol_return_abc', 'restock')
      ).rejects.toMatchObject({ returnId: 'ol_return_abc', trigger: 'restock' });
    });

    it('should return the hydrated record when the return is attributed', async () => {
      repository.findById.mockResolvedValue(attributed);

      await expect(service.assertAttributedForTrigger('ol_return_abc', 'refund')).resolves.toBe(
        attributed
      );
    });

    it('should re-read the row rather than trusting a caller-held record', async () => {
      repository.findById.mockResolvedValue(attributed);

      await service.assertAttributedForTrigger('ol_return_abc', 'refund');

      expect(repository.findById).toHaveBeenCalledWith('ol_return_abc');
    });

    it('should distinguish a missing return from an orphaned one', async () => {
      repository.findById.mockResolvedValue(null);

      // Collapsing the two would tell an operator to attribute a return that does not
      // exist.
      await expect(
        service.assertAttributedForTrigger('ol_return_missing', 'invoice_correction')
      ).rejects.toBeInstanceOf(ReturnNotFoundError);
    });
  });

  describe('listReturns / countReturnsByBucket (#2334)', () => {
    it('should pass the filter, limit and offset through to the repository unchanged', async () => {
      const filter = { sourceConnectionId: CONNECTION, bucket: 'orphan' as const };

      await service.listReturns(filter, 25, 50);

      expect(repository.listReturns).toHaveBeenCalledWith(filter, 25, 50);
    });

    it('should report the bucket counts the repository read in one scan', async () => {
      repository.countReturnsByBucket.mockResolvedValue({ total: 7, orphan: 2, attributed: 5 });

      // `total === orphan + attributed` is a property of the single
      // FILTER-aggregate read, not something this service recomputes — asserted
      // so a future "helpful" recomputation here is caught.
      await expect(service.countReturnsByBucket({})).resolves.toEqual({
        total: 7,
        orphan: 2,
        attributed: 5,
      });
    });
  });

  describe('getReturnIngestionAvailability (#2334)', () => {
    const entry = (connectionId: string, supportedCapabilities: string[]) => ({
      connectionId,
      connection: { id: connectionId },
      adapter: undefined,
      metadata: { supportedCapabilities },
    });

    it('should report the connections whose adapter DECLARES ReturnSourceReader', async () => {
      integrations.listCapabilityAdapters.mockResolvedValue([
        entry('conn-a', ['OrderSource', 'ReturnSourceReader']),
        entry('conn-b', ['OrderSource']),
      ]);

      await expect(service.getReturnIngestionAvailability()).resolves.toEqual({
        configured: true,
        connectionIds: ['conn-a'],
      });
    });

    it('should report not-configured when no adapter declares the sub-capability', async () => {
      integrations.listCapabilityAdapters.mockResolvedValue([entry('conn-b', ['OrderSource'])]);

      await expect(service.getReturnIngestionAvailability()).resolves.toEqual({
        configured: false,
        connectionIds: [],
      });
    });

    it('should list lazily and include non-active connections', async () => {
      integrations.listCapabilityAdapters.mockResolvedValue([]);

      await service.getReturnIngestionAvailability();

      // `lazy` is what keeps this read adapter-free (no credential resolution);
      // `includeAllStatuses` stops a connection in `needs_reauth` — the one an
      // operator most needs told about — being silently omitted.
      expect(integrations.listCapabilityAdapters).toHaveBeenCalledWith({
        capability: 'OrderSource',
        lazy: true,
        includeAllStatuses: true,
      });
    });

    it('should THROW rather than report not-configured when discovery fails', async () => {
      integrations.listCapabilityAdapters.mockRejectedValue(new Error('registry down'));

      // Answering `configured: false` would state a falsehood about the
      // operator's setup on the very screen that exists to answer the question.
      await expect(service.getReturnIngestionAvailability()).rejects.toThrow('registry down');
    });
  });

  describe('getDeclineAvailability (#2334)', () => {
    const record = (overrides: Record<string, unknown> = {}): never =>
      ({
        id: 'ol_return_abc',
        sourceConnectionId: CONNECTION,
        externalReturnId: 'RET-1',
        ...overrides,
      }) as never;

    it.each([null, '', '   '])(
      'should refuse a return whose externalReturnId is %p without asking the registry',
      async (externalReturnId) => {
        await expect(
          service.getDeclineAvailability(record({ externalReturnId }))
        ).resolves.toEqual({ supported: false, reason: 'no-source-return-id' });

        expect(integrations.getAdapter).not.toHaveBeenCalled();
      }
    );

    it('should refuse when the platform declares no ReturnDecliner', async () => {
      integrations.getAdapter.mockResolvedValue({
        metadata: { supportedCapabilities: ['OrderSource', 'ReturnSourceReader'] },
      });

      await expect(service.getDeclineAvailability(record())).resolves.toEqual({
        supported: false,
        reason: 'source-declares-no-decline',
      });
    });

    it('should allow when the platform declares ReturnDecliner', async () => {
      integrations.getAdapter.mockResolvedValue({
        metadata: { supportedCapabilities: ['OrderSource', 'ReturnDecliner'] },
      });

      await expect(service.getDeclineAvailability(record())).resolves.toEqual({
        supported: true,
        reason: null,
      });
    });

    it('should report SUPPORTED when the adapter metadata cannot be resolved', async () => {
      integrations.getAdapter.mockRejectedValue(new Error('connection disabled'));

      // An unknown is not a "no". Reporting `false` would render a permanently
      // disabled button captioned "this source does not support decline" — a
      // false claim about the operator's configuration with no path back —
      // whereas allowing the attempt costs one request that fails with the
      // specific, actionable reason.
      await expect(service.getDeclineAvailability(record())).resolves.toEqual({
        supported: true,
        reason: null,
      });
    });
  });
});
