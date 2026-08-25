/**
 * Allegro Customer Returns Tests (#2330)
 *
 * Covers the `ReturnSourceReader` half of `AllegroOrderSourceAdapter` and the
 * pure mapper it delegates to. Fixtures are shaped from the official OpenAPI
 * spec (`CustomerReturn` / `CustomerReturnItem` / `Price`), verified 2026-08-25
 * — notably `items[].price` is `{amount: string, currency: string}` with a
 * STRING amount, which the spike sketch left untyped.
 *
 * **needs-production-probe.** Every assertion here is fixture-driven. Nobody has
 * exercised this path against real buyer-initiated returns — SPIKE-2289 risk 6
 * flags sandbox coverage of the `[BETA]` resource as unverifiable from the docs,
 * and creating a buyer return in sandbox may not be possible at all. These tests
 * therefore prove the adapter honours the CONTRACT AS SPECIFIED; they cannot
 * prove the spec matches production. That is the stated reason both returns
 * scheduler tasks ship gated OFF by default.
 *
 * @module libs/integrations/allegro/src/infrastructure/adapters/__tests__
 */
import { AllegroOrderSourceAdapter } from '../allegro-order-source.adapter';
import {
  isAllegroReturnTerminal,
  toIncomingReturn,
  toIncomingReturnLine,
  toReturnFeedItem,
} from '../allegro-customer-return.mapper';
import {
  ALLEGRO_CUSTOMER_RETURN_MEDIA_TYPE,
  ALLEGRO_CUSTOMER_RETURN_TERMINAL_STATUSES,
} from '../../../domain/types/allegro-customer-return.types';
import type { AllegroCustomerReturnWire } from '../../../domain/types/allegro-customer-return.types';
import type { IAllegroHttpClient } from '../../http/allegro-http-client.interface';
import { Connection } from '@openlinker/core/identifier-mapping';
import { isReturnDecliner, isReturnSourceReader } from '@openlinker/core/orders';
import { ReturnDeclineRejectedBySourceError } from '@openlinker/core/returns';
import { AllegroApiException } from '../../../domain/exceptions/allegro-api.exception';

const connectionId = 'connection-returns';

function wireReturn(overrides: Partial<AllegroCustomerReturnWire> = {}): AllegroCustomerReturnWire {
  return {
    id: 'a3405c27-b01c-4357-9bea-e13925708b46',
    orderId: 'b1105c27-b01c-4357-9bea-e13925708999',
    referenceNumber: '1234/Z04A',
    createdAt: '2026-01-11T09:36:57.00Z',
    status: 'DELIVERED',
    isFulfillment: false,
    marketplaceId: 'allegro-pl',
    buyer: { email: 'buyer@allegro.pl', login: 'Buyer_Login' },
    items: [
      {
        offerId: '3e895572-9297-4d80-b151-353deb95bff6',
        quantity: 2,
        name: 'Product name',
        price: { amount: '123.45', currency: 'PLN' },
        url: 'https://allegro.pl/oferta/item-7678887152',
        reason: { type: 'MISTAKE', userComment: 'Purchased by mistake' },
        serialNumbers: ['4CE0460D0G'],
      },
    ],
    refund: { bankAccount: { number: 'PL61109010140000071219812874' } },
    parcels: [{ waybill: '680123', carrierId: 'INPOST' }],
    rejection: { code: 'REFUND_REJECTED', reason: 'Damaged' },
    ...overrides,
  };
}

describe('Allegro customer-return mapper (#2330)', () => {
  describe('terminal status vocabulary', () => {
    it('should expose exactly the four statuses that mean the money settled', () => {
      expect([...ALLEGRO_CUSTOMER_RETURN_TERMINAL_STATUSES]).toEqual([
        'FINISHED',
        'FINISHED_APT',
        'REJECTED',
        'COMMISSION_REFUNDED',
      ]);
    });

    // The full 11-value vocabulary, table-driven. The three near-misses are the
    // point: DELIVERED / WAREHOUSE_DELIVERED mean the parcel moved but the money
    // did not, and COMMISSION_REFUND_CLAIMED is a claim, not a settlement.
    it.each([
      ['CREATED', false],
      ['DISPATCHED', false],
      ['IN_TRANSIT', false],
      ['DELIVERED', false],
      ['WAREHOUSE_DELIVERED', false],
      ['WAREHOUSE_VERIFICATION', false],
      ['COMMISSION_REFUND_CLAIMED', false],
      ['FINISHED', true],
      ['FINISHED_APT', true],
      ['REJECTED', true],
      ['COMMISSION_REFUNDED', true],
    ])('should classify %s as terminal=%s', (status, expected) => {
      expect(isAllegroReturnTerminal(status)).toBe(expected);
    });

    it('should treat an absent status as not terminal, so the sweep keeps watching', () => {
      expect(isAllegroReturnTerminal(undefined)).toBe(false);
    });

    it('should not accept a lower-cased status, so a real shape change stays visible', () => {
      expect(isAllegroReturnTerminal('finished')).toBe(false);
    });
  });

  describe('toIncomingReturn', () => {
    it('should pass rawStatus through verbatim', () => {
      expect(toIncomingReturn(wireReturn({ status: 'WAREHOUSE_VERIFICATION' })).rawStatus).toBe(
        'WAREHOUSE_VERIFICATION'
      );
    });

    it('should report an absent status as an empty string rather than inventing one', () => {
      const mapped = toIncomingReturn(wireReturn({ status: undefined }));
      expect(mapped.rawStatus).toBe('');
      // Matches no terminal value, so the return stays in the sweep's candidate
      // set — the safe direction.
      expect(mapped.isTerminalAtSource).toBe(false);
    });

    it('should derive isTerminalAtSource from the same constant the adapter publishes', () => {
      expect(toIncomingReturn(wireReturn({ status: 'FINISHED' })).isTerminalAtSource).toBe(true);
      expect(toIncomingReturn(wireReturn({ status: 'DELIVERED' })).isTerminalAtSource).toBe(false);
    });

    it('should report a missing orderId as null, never undefined', () => {
      const mapped = toIncomingReturn(wireReturn({ orderId: undefined }));
      expect(mapped.externalOrderId).toBeNull();
      expect(Object.prototype.hasOwnProperty.call(mapped, 'externalOrderId')).toBe(true);
    });

    it('should carry refund, parcels and rejection in raw only — never onto a neutral field', () => {
      const mapped = toIncomingReturn(wireReturn());
      expect(mapped).not.toHaveProperty('refund');
      expect(mapped).not.toHaveProperty('parcels');
      expect(mapped).not.toHaveProperty('rejection');
      expect(mapped.raw).toMatchObject({
        refund: { bankAccount: { number: 'PL61109010140000071219812874' } },
        rejection: { code: 'REFUND_REJECTED' },
      });
    });
  });

  describe('toIncomingReturnLine', () => {
    it('should parse the STRING price amount into a number', () => {
      const line = toIncomingReturnLine({ price: { amount: '123.45', currency: 'PLN' } });
      expect(line.unitPrice).toBe(123.45);
    });

    it('should report an unparseable amount as undefined rather than NaN', () => {
      expect(toIncomingReturnLine({ price: { amount: 'n/a', currency: 'PLN' } }).unitPrice)
        .toBeUndefined();
      expect(toIncomingReturnLine({}).unitPrice).toBeUndefined();
    });

    it('should map reason.type only and never merge userComment into reasonRaw', () => {
      const line = toIncomingReturnLine({
        reason: { type: 'MISTAKE', userComment: 'Purchased by mistake' },
      });
      expect(line.reasonRaw).toBe('MISTAKE');
      expect(line.reasonRaw).not.toContain('Purchased');
      // The comment is not lost — it rides in raw.
      expect(line.raw).toMatchObject({ reason: { userComment: 'Purchased by mistake' } });
    });

    it('should emit no externalLineId — Allegro assigns none and core must not invent one', () => {
      expect(toIncomingReturnLine({ offerId: 'offer-1' }).externalLineId).toBeUndefined();
    });

    it('should report an absent quantity as 0 rather than guessing 1', () => {
      expect(toIncomingReturnLine({ offerId: 'offer-1' }).quantity).toBe(0);
    });
  });

  describe('toReturnFeedItem', () => {
    it('should use the return id as the dedupe key', () => {
      const item = toReturnFeedItem(wireReturn());
      expect(item?.eventKey).toBe('a3405c27-b01c-4357-9bea-e13925708b46');
      expect(item?.externalReturnId).toBe(item?.eventKey);
    });

    it('should return null for an item without an id, so the caller can drop it', () => {
      expect(toReturnFeedItem(wireReturn({ id: undefined }))).toBeNull();
      expect(toReturnFeedItem(wireReturn({ id: '   ' }))).toBeNull();
    });
  });
});

describe('AllegroOrderSourceAdapter — ReturnSourceReader (#2330)', () => {
  let adapter: AllegroOrderSourceAdapter;
  let httpClient: jest.Mocked<IAllegroHttpClient>;

  beforeEach(() => {
    httpClient = {
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      patch: jest.fn(),
    } as unknown as jest.Mocked<IAllegroHttpClient>;

    const connection = new Connection(
      connectionId,
      'allegro',
      'Test Allegro',
      'active',
      { environment: 'sandbox' },
      'credentials-ref',
      new Date(),
      new Date(),
      undefined,
      ['OrderSource']
    );

    adapter = new AllegroOrderSourceAdapter(connectionId, httpClient, connection);
    delete process.env.OL_ALLEGRO_RETURNS_BOOTSTRAP_DAYS;
  });

  afterEach(() => {
    delete process.env.OL_ALLEGRO_RETURNS_BOOTSTRAP_DAYS;
  });

  it('should satisfy the isReturnSourceReader guard', () => {
    expect(isReturnSourceReader(adapter)).toBe(true);
  });

  it('should publish the shared terminal constant as terminalRawStatuses', () => {
    // The single-source assertion: the sweep's SQL exclusion and the
    // per-observation hint must be the SAME list, or a return can be excluded
    // from the sweep while still reported as open — invisible, and permanent.
    expect(adapter.terminalRawStatuses).toBe(ALLEGRO_CUSTOMER_RETURN_TERMINAL_STATUSES);
    for (const status of adapter.terminalRawStatuses) {
      expect(isAllegroReturnTerminal(status)).toBe(true);
    }
  });

  describe('listReturnFeed', () => {
    it('should send `from` when a cursor exists, and never `offset`', async () => {
      httpClient.get.mockResolvedValue({
        data: { count: 1, customerReturns: [wireReturn()] },
        status: 200,
        headers: {},
      });

      await adapter.listReturnFeed({ fromCursor: 'cursor-1', limit: 100 });

      const [path, options] = httpClient.get.mock.calls[0];
      expect(path).toBe('/order/customer-returns');
      expect(options?.queryParams).toEqual({ from: 'cursor-1', limit: 100 });
      expect(options?.queryParams).not.toHaveProperty('offset');
      // Risk 1: `from` is never composed with a filter, because whether the
      // cursor applies before or after filtering is documented nowhere.
      expect(options?.queryParams).not.toHaveProperty('createdAt.gte');
      expect(options?.queryParams).not.toHaveProperty('status');
    });

    it('should request the [BETA] media type per request', async () => {
      httpClient.get.mockResolvedValue({ data: { customerReturns: [] }, status: 200, headers: {} });

      await adapter.listReturnFeed({ fromCursor: 'cursor-1', limit: 10 });

      expect(httpClient.get.mock.calls[0][1]?.headers).toEqual({
        Accept: ALLEGRO_CUSTOMER_RETURN_MEDIA_TYPE,
      });
    });

    it('should bootstrap a createdAt.gte window when there is no cursor', async () => {
      process.env.OL_ALLEGRO_RETURNS_BOOTSTRAP_DAYS = '30';
      httpClient.get.mockResolvedValue({ data: { customerReturns: [] }, status: 200, headers: {} });

      await adapter.listReturnFeed({ fromCursor: null, limit: 100 });

      const params = httpClient.get.mock.calls[0][1]?.queryParams as Record<string, string>;
      expect(params).not.toHaveProperty('from');
      expect(params['createdAt.gte']).toBeDefined();
      const since = new Date(params['createdAt.gte']).getTime();
      const expected = Date.now() - 30 * 24 * 60 * 60 * 1000;
      expect(Math.abs(since - expected)).toBeLessThan(60_000);
    });

    it('should set nextCursor to the last item id of the page', async () => {
      httpClient.get.mockResolvedValue({
        data: {
          customerReturns: [wireReturn({ id: 'r-1' }), wireReturn({ id: 'r-2' })],
        },
        status: 200,
        headers: {},
      });

      const result = await adapter.listReturnFeed({ fromCursor: 'r-0', limit: 100 });

      expect(result.items.map((i) => i.externalReturnId)).toEqual(['r-1', 'r-2']);
      expect(result.nextCursor).toBe('r-2');
    });

    it('should hold the incoming cursor on an empty page — never blank it', async () => {
      httpClient.get.mockResolvedValue({
        data: { count: 0, customerReturns: [] },
        status: 200,
        headers: {},
      });

      const result = await adapter.listReturnFeed({ fromCursor: 'r-9', limit: 100 });

      expect(result.items).toEqual([]);
      expect(result.nextCursor).toBe('r-9');
    });

    it('should report null (not undefined) when there is neither a cursor nor an item', async () => {
      httpClient.get.mockResolvedValue({ data: { customerReturns: [] }, status: 200, headers: {} });

      const result = await adapter.listReturnFeed({ fromCursor: null, limit: 100 });

      expect(result.nextCursor).toBeNull();
    });

    it('should drop an id-less item, keep the rest, and still consume the page', async () => {
      httpClient.get.mockResolvedValue({
        data: {
          customerReturns: [wireReturn({ id: 'r-1' }), wireReturn({ id: undefined }), wireReturn({ id: 'r-3' })],
        },
        status: 200,
        headers: {},
      });

      const result = await adapter.listReturnFeed({ fromCursor: 'r-0', limit: 100 });

      expect(result.items.map((i) => i.externalReturnId)).toEqual(['r-1', 'r-3']);
      // The cursor still advances past the malformed row: it will be exactly as
      // malformed on every retry, so holding would wedge the connection forever.
      expect(result.nextCursor).toBe('r-3');
    });

    it('should tolerate a response that omits customerReturns entirely', async () => {
      httpClient.get.mockResolvedValue({ data: {}, status: 200, headers: {} });

      const result = await adapter.listReturnFeed({ fromCursor: 'r-1', limit: 100 });

      expect(result.items).toEqual([]);
      expect(result.nextCursor).toBe('r-1');
    });
  });

  describe('getReturn', () => {
    it('should read by id with the [BETA] media type and project the observation', async () => {
      httpClient.get.mockResolvedValue({ data: wireReturn(), status: 200, headers: {} });

      const result = await adapter.getReturn({ externalReturnId: 'r-1' });

      expect(httpClient.get).toHaveBeenCalledWith('/order/customer-returns/r-1', {
        headers: { Accept: ALLEGRO_CUSTOMER_RETURN_MEDIA_TYPE },
      });
      expect(result.externalReturnId).toBe('a3405c27-b01c-4357-9bea-e13925708b46');
      expect(result.rawStatus).toBe('DELIVERED');
      expect(result.lines).toHaveLength(1);
      expect(result.lines[0]).toMatchObject({
        offerId: '3e895572-9297-4d80-b151-353deb95bff6',
        quantity: 2,
        unitPrice: 123.45,
        reasonRaw: 'MISTAKE',
      });
    });
  });
});

describe('AllegroOrderSourceAdapter — ReturnDecliner (#2333)', () => {
  let adapter: AllegroOrderSourceAdapter;
  let httpClient: jest.Mocked<IAllegroHttpClient>;

  beforeEach(() => {
    httpClient = {
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      patch: jest.fn(),
    } as unknown as jest.Mocked<IAllegroHttpClient>;

    const connection = new Connection(
      connectionId,
      'allegro',
      'Test Allegro',
      'active',
      { environment: 'sandbox' },
      'credentials-ref',
      new Date(),
      new Date(),
      undefined,
      ['OrderSource']
    );

    adapter = new AllegroOrderSourceAdapter(connectionId, httpClient, connection);
  });

  it('should satisfy the isReturnDecliner guard', () => {
    expect(isReturnDecliner(adapter)).toBe(true);
  });

  it('should publish Allegro rejection codes as the opaque decline vocabulary', () => {
    expect([...(adapter.declineReasonCodes ?? [])]).toEqual([
      'REFUND_REJECTED',
      'NEW_ITEM_SENT',
      'ITEM_FIXED',
      'MISSING_PART_SENT',
      'ITEM_MISMATCH',
      'BUSINESS_PURCHASE',
      'NO_RETURN_RIGHT',
    ]);
  });

  it('should POST the spec-shaped rejection body with the [BETA] media type', async () => {
    httpClient.post.mockResolvedValue({
      data: wireReturn({
        status: 'REJECTED',
        rejection: {
          code: 'REFUND_REJECTED',
          reason: 'Damaged',
          createdAt: '2026-01-11T09:36:57.663+01:00',
        },
      }),
      status: 200,
      headers: {},
    });

    const result = await adapter.declineReturn({
      externalReturnId: 'r-1',
      reasonCode: 'REFUND_REJECTED',
      comment: 'Damaged',
    });

    expect(httpClient.post).toHaveBeenCalledWith(
      '/order/customer-returns/r-1/rejection',
      { rejection: { code: 'REFUND_REJECTED', reason: 'Damaged' } },
      {
        headers: {
          Accept: ALLEGRO_CUSTOMER_RETURN_MEDIA_TYPE,
          'Content-Type': ALLEGRO_CUSTOMER_RETURN_MEDIA_TYPE,
        },
      }
    );
    // The success body IS the confirmation — Allegro's own instant, not ours.
    expect(result.declinedAt).toEqual(new Date('2026-01-11T09:36:57.663+01:00'));
    expect(result.rawStatus).toBe('REJECTED');
  });

  it('should omit reason for a code that does not require one', async () => {
    httpClient.post.mockResolvedValue({
      data: wireReturn({
        rejection: { code: 'ITEM_FIXED', createdAt: '2026-01-11T09:36:57.00Z' },
      }),
      status: 200,
      headers: {},
    });

    await adapter.declineReturn({
      externalReturnId: 'r-1',
      reasonCode: 'ITEM_FIXED',
      comment: null,
    });

    expect(httpClient.post).toHaveBeenCalledWith(
      '/order/customer-returns/r-1/rejection',
      { rejection: { code: 'ITEM_FIXED' } },
      expect.anything()
    );
  });

  it('should refuse an unknown code before spending a round trip', async () => {
    await expect(
      adapter.declineReturn({
        externalReturnId: 'r-1',
        reasonCode: 'NOPE',
        comment: null,
      })
    ).rejects.toBeInstanceOf(ReturnDeclineRejectedBySourceError);
    expect(httpClient.post).not.toHaveBeenCalled();
  });

  it('should refuse REFUND_REJECTED with no reason, as Allegro requires one', async () => {
    await expect(
      adapter.declineReturn({
        externalReturnId: 'r-1',
        reasonCode: 'REFUND_REJECTED',
        comment: '   ',
      })
    ).rejects.toBeInstanceOf(ReturnDeclineRejectedBySourceError);
    expect(httpClient.post).not.toHaveBeenCalled();
  });

  it('should truncate an over-long reason to the source limit rather than abandon the decline', async () => {
    httpClient.post.mockResolvedValue({
      data: wireReturn({
        rejection: { code: 'REFUND_REJECTED', createdAt: '2026-01-11T09:36:57.00Z' },
      }),
      status: 200,
      headers: {},
    });

    await adapter.declineReturn({
      externalReturnId: 'r-1',
      reasonCode: 'REFUND_REJECTED',
      comment: 'x'.repeat(400),
    });

    const body = httpClient.post.mock.calls[0][1] as {
      rejection: { reason: string };
    };
    expect(body.rejection.reason).toHaveLength(250);
  });

  it('should treat a 422 whose re-read shows a rejection as an already-declined success', async () => {
    httpClient.post.mockRejectedValue(
      new AllegroApiException('Unprocessable', 422, '{}', '/rejection')
    );
    httpClient.get.mockResolvedValue({
      data: wireReturn({
        status: 'REJECTED',
        rejection: { code: 'REFUND_REJECTED', createdAt: '2026-01-11T09:36:57.00Z' },
      }),
      status: 200,
      headers: {},
    });

    const result = await adapter.declineReturn({
      externalReturnId: 'r-1',
      reasonCode: 'REFUND_REJECTED',
      comment: 'Damaged',
    });

    expect(result.declinedAt).toEqual(new Date('2026-01-11T09:36:57.00Z'));
    expect(httpClient.get).toHaveBeenCalledWith('/order/customer-returns/r-1', {
      headers: { Accept: ALLEGRO_CUSTOMER_RETURN_MEDIA_TYPE },
    });
  });

  it('should rethrow a 422 whose re-read shows no rejection', async () => {
    const failure = new AllegroApiException('Unprocessable', 422, '{}', '/rejection');
    httpClient.post.mockRejectedValue(failure);
    httpClient.get.mockResolvedValue({
      data: wireReturn({ rejection: undefined }),
      status: 200,
      headers: {},
    });

    await expect(
      adapter.declineReturn({
        externalReturnId: 'r-1',
        reasonCode: 'REFUND_REJECTED',
        comment: 'Damaged',
      })
    ).rejects.toBe(failure);
  });

  it('should map a deterministic 400 onto the neutral refusal, carrying the source own words', async () => {
    httpClient.post.mockRejectedValue(
      new AllegroApiException('Bad request', 400, '{}', '/rejection', [
        { code: 'X', userMessage: 'Return cannot be rejected in this state' },
      ] as never)
    );

    await expect(
      adapter.declineReturn({
        externalReturnId: 'r-1',
        reasonCode: 'ITEM_FIXED',
        comment: null,
      })
    ).rejects.toMatchObject({
      name: 'ReturnDeclineRejectedBySourceError',
      reason: 'Return cannot be rejected in this state',
    });
  });

  it.each([401, 403, 429, 500, 503])(
    'should rethrow a %s so the proposal stays open (in doubt) rather than reading as refused',
    async (statusCode) => {
      const failure = new AllegroApiException('Boom', statusCode, '{}', '/rejection');
      httpClient.post.mockRejectedValue(failure);

      await expect(
        adapter.declineReturn({
          externalReturnId: 'r-1',
          reasonCode: 'ITEM_FIXED',
          comment: null,
        })
      ).rejects.toBe(failure);
    }
  );

  it('should report declinedAt as null when the source reports no instant', async () => {
    // "decline sent" — core must not stamp, and must not invent a timestamp.
    httpClient.post.mockResolvedValue({
      data: wireReturn({ rejection: { code: 'ITEM_FIXED' } }),
      status: 200,
      headers: {},
    });

    const result = await adapter.declineReturn({
      externalReturnId: 'r-1',
      reasonCode: 'ITEM_FIXED',
      comment: null,
    });

    expect(result.declinedAt).toBeNull();
  });

  it('should report declinedAt as null when the source reports an unparseable instant', async () => {
    httpClient.post.mockResolvedValue({
      data: wireReturn({ rejection: { code: 'ITEM_FIXED', createdAt: 'not-a-date' } }),
      status: 200,
      headers: {},
    });

    const result = await adapter.declineReturn({
      externalReturnId: 'r-1',
      reasonCode: 'ITEM_FIXED',
      comment: null,
    });

    expect(result.declinedAt).toBeNull();
  });
});
