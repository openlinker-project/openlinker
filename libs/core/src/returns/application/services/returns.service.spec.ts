/**
 * Returns Service — unit spec (#2328)
 *
 * Mocks the repository port and the identifier-mapping service; what the
 * repository's statements then do to real rows is asserted against Postgres in
 * `apps/api/test/integration/returns-ingestion.int-spec.ts`.
 *
 * @module libs/core/src/returns/application/services
 */
import { ReturnObservationMissingExternalIdError } from '../../domain/exceptions/return-observation-missing-external-id.error';
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
    create: jest.Mock;
    findByExternalId: jest.Mock;
  };
  let identifierMapping: { getInternalId: jest.Mock; getOrCreateInternalId: jest.Mock };

  const lastInput = (): UpsertReturnRecordInput => {
    const calls = repository.upsertFromSource.mock.calls as unknown[][];
    return calls[0][0] as UpsertReturnRecordInput;
  };

  beforeEach(() => {
    repository = {
      upsertFromSource: jest.fn().mockResolvedValue({ record: { id: 'ol_return_abc' } }),
      findById: jest.fn().mockResolvedValue(null),
      listOrphans: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      findByExternalId: jest.fn(),
    };
    identifierMapping = {
      getInternalId: jest.fn().mockResolvedValue('ol_order_abc'),
      getOrCreateInternalId: jest.fn(),
    };

    service = new ReturnsService(repository as never, identifierMapping as never);
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
  });
});
