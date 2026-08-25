/**
 * Returns Controller — unit spec (#2334)
 *
 * Mocks `IReturnsService`; what its reads then do to real rows is asserted
 * against Postgres in `apps/api/test/integration/returns-read-api.int-spec.ts`.
 *
 * The load-bearing assertions here are about the PROJECTION, because the
 * projection is the contract #2335 and #2336 are written against: the exact key
 * set (so `rawPayload` cannot start shipping), `bucket` deriving from the
 * entity's own rule, nulls surviving as nulls, and the two totals meaning what
 * they say.
 *
 * @module apps/api/src/returns/http
 */
import { ReturnNotFoundError } from '@openlinker/core/returns';
import type { ReturnRecord } from '@openlinker/core/returns';
import { ReturnsController } from './returns.controller';
import type { ListReturnsQueryDto } from '../dto/list-returns-query.dto';

const CONNECTION = '11111111-1111-1111-1111-111111111111';

const buildLine = (overrides: Record<string, unknown> = {}): unknown => ({
  id: 'line-1',
  returnId: 'ol_return_abc',
  lineIndex: 0,
  externalLineId: 'L-1',
  resolvedOrderLineId: null,
  offerId: null,
  sku: 'SKU-1',
  name: 'Widget',
  reason: 'withdrawal',
  quantityAdvised: 2,
  quantityReceived: 0,
  quantityRestocked: 0,
  quantityScrapped: 0,
  custodyState: 'not_received',
  moneyState: 'none',
  disposition: null,
  receivedAt: null,
  disposedAt: null,
  note: null,
  createdAt: new Date('2026-08-01T10:00:00.000Z'),
  updatedAt: new Date('2026-08-01T10:00:00.000Z'),
  ...overrides,
});

const buildRecord = (overrides: Record<string, unknown> = {}): ReturnRecord => {
  const internalOrderId =
    'internalOrderId' in overrides ? overrides.internalOrderId : 'ol_order_xyz';

  return {
    id: 'ol_return_abc',
    sourceConnectionId: CONNECTION,
    externalReturnId: 'RET-1',
    internalOrderId,
    externalOrderId: 'ORD-9',
    origin: 'source_ingested',
    rawStatus: 'WAITING_FOR_PARCEL',
    // Present on the entity, and deliberately never projected.
    rawPayload: { buyerEmail: 'buyer@example.com' },
    openedAt: new Date('2026-08-01T10:00:00.000Z'),
    authorizedAt: null,
    declinedAt: null,
    closedAt: null,
    createdAt: new Date('2026-08-01T10:00:00.000Z'),
    updatedAt: new Date('2026-08-02T10:00:00.000Z'),
    lines: [buildLine()],
    isOrphan: () => internalOrderId === null,
    ...overrides,
  } as unknown as ReturnRecord;
};

describe('ReturnsController', () => {
  let controller: ReturnsController;
  let returnsService: {
    listReturns: jest.Mock;
    countReturnsByBucket: jest.Mock;
    getReturn: jest.Mock;
    getReturnIngestionAvailability: jest.Mock;
    getDeclineAvailability: jest.Mock;
  };

  beforeEach(() => {
    returnsService = {
      listReturns: jest.fn().mockResolvedValue([]),
      countReturnsByBucket: jest
        .fn()
        .mockResolvedValue({ total: 10, orphan: 3, attributed: 7 }),
      getReturn: jest.fn().mockResolvedValue(null),
      getReturnIngestionAvailability: jest
        .fn()
        .mockResolvedValue({ configured: false, connectionIds: [] }),
      getDeclineAvailability: jest.fn().mockResolvedValue({ supported: true, reason: null }),
    };

    controller = new ReturnsController(returnsService as never);
  });

  const query = (overrides: Partial<ListReturnsQueryDto> = {}): ListReturnsQueryDto =>
    ({ limit: 20, offset: 0, ...overrides }) as ListReturnsQueryDto;

  describe('GET /returns', () => {
    it('should count the chips over the filter scope WITHOUT the requested bucket', async () => {
      await controller.listReturns(query({ sourceConnectionId: CONNECTION, bucket: 'orphan' }));

      // The list is narrowed by the bucket; the counts are not. Counting under
      // the caller's own bucket would make the other chip render either the
      // number already on screen or a zero.
      expect(returnsService.listReturns).toHaveBeenCalledWith(
        expect.objectContaining({ sourceConnectionId: CONNECTION, bucket: 'orphan' }),
        20,
        0
      );
      const [countScope] = returnsService.countReturnsByBucket.mock.calls[0] as [
        Record<string, unknown>,
      ];
      expect(countScope.sourceConnectionId).toBe(CONNECTION);
      // The key is ABSENT, not present-and-undefined — the repository's
      // predicate builder tests `!== undefined`, so either would work, but
      // absence is the stronger statement and the one the port docblock makes.
      expect(countScope).not.toHaveProperty('bucket');
    });

    it.each([
      ['orphan' as const, 3],
      ['attributed' as const, 7],
      [undefined, 10],
    ])(
      'should report the bucket-applied total for bucket=%s without a third query',
      async (bucket, expected) => {
        const result = await controller.listReturns(query({ bucket }));

        expect(result.total).toBe(expected);
        expect(result.counts).toEqual({ total: 10, orphan: 3, attributed: 7 });
        expect(returnsService.countReturnsByBucket).toHaveBeenCalledTimes(1);
      }
    );

    it('should apply the paging defaults when the query carries none', async () => {
      // The DTO documents the defaults for Swagger but does not initialise the
      // fields, so this path is the only place they are applied — and it would
      // otherwise never be executed by a spec that always passes both.
      const result = await controller.listReturns({} as ListReturnsQueryDto);

      expect(returnsService.listReturns).toHaveBeenCalledWith(expect.anything(), 20, 0);
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(0);
    });

    it('should parse the date bounds into Dates and leave absent ones undefined', async () => {
      await controller.listReturns(query({ createdFrom: '2026-08-01T00:00:00.000Z' }));

      const [filter] = returnsService.listReturns.mock.calls[0] as [Record<string, unknown>];
      expect(filter.createdFrom).toEqual(new Date('2026-08-01T00:00:00.000Z'));
      // An absent filter field must not become a bound — see ReturnListFilter.
      expect(filter.createdTo).toBeUndefined();
    });

    it('should project a list row to the exact allowlist, with no rawPayload and no lines', async () => {
      returnsService.listReturns.mockResolvedValue([buildRecord()]);

      const result = await controller.listReturns(query());

      // The whole key set is asserted, not just the absence of one field: a
      // column added to the entity later must fail this test rather than
      // silently start shipping.
      expect(Object.keys(result.items[0]).sort()).toEqual(
        [
          'authorizedAt',
          'bucket',
          'closedAt',
          'createdAt',
          'declinedAt',
          'externalOrderId',
          'externalReturnId',
          'id',
          'internalOrderId',
          'openedAt',
          'origin',
          'rawStatus',
          'sourceConnectionId',
          'updatedAt',
        ].sort()
      );
    });

    it('should render rawStatus verbatim and keep a null one null', async () => {
      returnsService.listReturns.mockResolvedValue([
        buildRecord({ rawStatus: 'CANCELLED_BY_BUYER' }),
        buildRecord({ id: 'ol_return_def', rawStatus: null }),
      ]);

      const result = await controller.listReturns(query());

      // Verbatim: never re-labelled, never title-cased, never defaulted — "the
      // source said nothing" is a different fact from "the source said X".
      expect(result.items[0].rawStatus).toBe('CANCELLED_BY_BUYER');
      expect(result.items[1].rawStatus).toBeNull();
    });

    it.each([
      [null, 'orphan'],
      ['ol_order_xyz', 'attributed'],
    ])('should derive bucket from the entity rule for internalOrderId=%s', async (
      internalOrderId,
      expected
    ) => {
      returnsService.listReturns.mockResolvedValue([buildRecord({ internalOrderId })]);

      const result = await controller.listReturns(query());

      expect(result.items[0].bucket).toBe(expected);
    });
  });

  describe('GET /returns/:returnId', () => {
    it('should throw the DOMAIN not-found error, not a Nest exception', async () => {
      returnsService.getReturn.mockResolvedValue(null);

      // The global filter owns the 404. Constructing a NotFoundException here
      // would give one state two spellings.
      await expect(controller.getReturn('ol_return_missing')).rejects.toBeInstanceOf(
        ReturnNotFoundError
      );
    });

    it('should hydrate lines and attach the decline availability', async () => {
      returnsService.getReturn.mockResolvedValue(buildRecord());
      returnsService.getDeclineAvailability.mockResolvedValue({
        supported: false,
        reason: 'source-declares-no-decline',
      });

      const result = await controller.getReturn('ol_return_abc');

      expect(result.lines).toHaveLength(1);
      expect(result.declineAvailability).toEqual({
        supported: false,
        reason: 'source-declares-no-decline',
      });
      expect(result).not.toHaveProperty('rawPayload');
    });

    it('should project a line to the exact allowlist and keep an unmatched line null', async () => {
      returnsService.getReturn.mockResolvedValue(buildRecord());

      const result = await controller.getReturn('ol_return_abc');

      expect(Object.keys(result.lines[0]).sort()).toEqual(
        [
          'custodyState',
          'disposedAt',
          'disposition',
          'externalLineId',
          'id',
          'lineIndex',
          'moneyState',
          'name',
          'note',
          'offerId',
          'quantityAdvised',
          'quantityReceived',
          'quantityRestocked',
          'quantityScrapped',
          'reason',
          'receivedAt',
          'resolvedOrderLineId',
          'sku',
        ].sort()
      );
      // Null is a real state ("could not be matched to a line"), never a blank.
      expect(result.lines[0].resolvedOrderLineId).toBeNull();
    });
  });

  describe('GET /returns/ingestion-availability', () => {
    it('should report the availability the service resolved', async () => {
      returnsService.getReturnIngestionAvailability.mockResolvedValue({
        configured: true,
        connectionIds: ['conn-a'],
      });

      await expect(controller.getIngestionAvailability()).resolves.toEqual({
        configured: true,
        connectionIds: ['conn-a'],
      });
    });

    it('should propagate a discovery failure rather than reporting not-configured', async () => {
      returnsService.getReturnIngestionAvailability.mockRejectedValue(new Error('registry down'));

      await expect(controller.getIngestionAvailability()).rejects.toThrow('registry down');
    });
  });
});
