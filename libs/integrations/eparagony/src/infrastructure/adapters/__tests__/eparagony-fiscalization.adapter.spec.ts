import type { LoggerPort } from '@openlinker/shared/logging';
import type { RegisterTransactionCommand } from '@openlinker/core/fiscalization';

import { EparagonyApiError } from '../../../domain/exceptions/eparagony-api.error';
import { EparagonyConfigException } from '../../../domain/exceptions/eparagony-config.exception';
import { EparagonyNetworkError } from '../../../domain/exceptions/eparagony-network.error';
import { deriveDocumentToken } from '../../../domain/policies/document-token.policy';
import type { EparagonyDocumentStatusResponse } from '../../../domain/types/eparagony-api.types';
import type { EparagonyConnectionConfig } from '../../../domain/types/eparagony-config.types';
import type { IEparagonyHttpClient } from '../../http/eparagony-http-client.interface';
import type { EparagonyHttpResponse } from '../../http/eparagony-http-client.types';
import { EparagonyFiscalizationAdapter } from '../eparagony-fiscalization.adapter';

const CONNECTION_ID = 'conn-eparagony-1';

const logger: LoggerPort = {
  log: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

function makeConfig(overrides: Partial<EparagonyConnectionConfig> = {}): EparagonyConnectionConfig {
  return {
    environment: 'sandbox',
    posId: 'pos-10',
    defaultTaxRateCode: 'A',
    ...overrides,
  };
}

function makeCommand(
  overrides: Partial<RegisterTransactionCommand> = {},
): RegisterTransactionCommand {
  return {
    connectionId: CONNECTION_ID,
    orderId: 'ol_order_1',
    idempotencyKey: 'fiscal:conn-1:ol_order_1',
    currency: 'PLN',
    lines: [
      { name: 'Red t-shirt', quantity: 2, unitPriceGross: 30.24, taxRate: '', sku: 'SKU-1' },
    ],
    totalGross: 60.48,
    ...overrides,
  };
}

const CONFIRMED: EparagonyDocumentStatusResponse = {
  status: 'CONFIRMED',
  documentType: 'RECEIPT',
  processingMode: 'FISCALIZATION',
  transactionToken: 'txn-1',
  fiscalDeviceUniqueNumber: 'TEST0000000001',
  fiscalDocumentNumber: 568,
  fiscalDocumentId: 'TEST0000000001/568',
  receiptNumber: 334,
  posId: 'pos-10',
  endTime: '2026-08-14T09:16:42.123Z',
  documentUrl: 'https://hub.eparagony.pl/view/abc123',
  printed: true,
};

const PENDING: EparagonyDocumentStatusResponse = {
  status: 'PENDING',
  documentType: 'RECEIPT',
  processingMode: 'FISCALIZATION',
  documentUrl: 'https://hub.eparagony.pl/view/abc123',
};

interface FakeClient extends IEparagonyHttpClient {
  post: jest.Mock;
  get: jest.Mock;
  invalidateToken: jest.Mock;
  ensureToken: jest.Mock;
}

function makeClient(statuses: Array<EparagonyDocumentStatusResponse | Error>): FakeClient {
  const queue = [...statuses];
  return {
    post: jest.fn().mockResolvedValue({ status: 202, data: {} } as EparagonyHttpResponse<unknown>),
    get: jest.fn().mockImplementation(() => {
      const next = queue.length > 1 ? queue.shift() : queue[0];
      if (next instanceof Error) {
        return Promise.reject(next);
      }
      return Promise.resolve({ status: 200, data: next } as EparagonyHttpResponse<unknown>);
    }),
    invalidateToken: jest.fn(),
    ensureToken: jest.fn().mockResolvedValue(undefined),
  };
}

function makeAdapter(
  client: IEparagonyHttpClient,
  config: EparagonyConnectionConfig = makeConfig(),
): EparagonyFiscalizationAdapter {
  return new EparagonyFiscalizationAdapter(CONNECTION_ID, client, logger, config);
}

describe('EparagonyFiscalizationAdapter', () => {
  describe('registerTransaction - happy path', () => {
    it('should register the sale and map the neutral identity set when the document is confirmed', async () => {
      const client = makeClient([CONFIRMED]);
      const result = await makeAdapter(client).registerTransaction(makeCommand());

      expect(result.providerType).toBe('eparagony');
      expect(result.providerReference).toBe(
        deriveDocumentToken(CONNECTION_ID, 'fiscal:conn-1:ol_order_1'),
      );
      // PL numer paragonu.
      expect(result.documentReference).toBe('334');
      // PL numer unikatowy - flat, no anchor class reaches core.
      expect(result.signingIdentity).toBe('TEST0000000001');
      expect(result.registeredAt?.toISOString()).toBe('2026-08-14T09:16:42.123Z');
      expect(result.regimeExtras).toMatchObject({
        fiscalDocumentId: 'TEST0000000001/568',
        printed: 'true',
      });
    });

    it('should send the deterministic document token so a later lookup can find it', async () => {
      const client = makeClient([CONFIRMED]);
      await makeAdapter(client).registerTransaction(makeCommand());

      const [path, body, options] = client.post.mock.calls[0] as [
        string,
        { documentToken: string; transactionToken: string; eReceipt: { fiscalize: boolean } },
        { headers: Record<string, string>; idempotent: boolean },
      ];
      expect(path).toBe('documents');
      expect(body.documentToken).toBe(
        deriveDocumentToken(CONNECTION_ID, 'fiscal:conn-1:ol_order_1'),
      );
      expect(body.transactionToken).not.toBe(body.documentToken);
      expect(body.eReceipt.fiscalize).toBe(true);
      // The vendor's `Idempotency-Key` header rejects OL's colon-bearing raw key
      // format, so the adapter sends the same derived `documentToken` there
      // instead - that is what makes a transport-level re-issue safe.
      expect(options.headers['Idempotency-Key']).toBe(body.documentToken);
      expect(options.idempotent).toBe(true);
    });

    it('should poll until the document is confirmed when the first read is still pending', async () => {
      jest.useFakeTimers();
      try {
        const client = makeClient([PENDING, CONFIRMED]);
        const promise = makeAdapter(client).registerTransaction(makeCommand());
        await jest.advanceTimersByTimeAsync(3_000);
        const result = await promise;
        expect(client.get).toHaveBeenCalledTimes(2);
        expect(result.artefacts).toHaveLength(1);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('registerTransaction - artefact gating', () => {
    it('should surface the buyer link only once the status is confirmed', async () => {
      const client = makeClient([CONFIRMED]);
      const result = await makeAdapter(client).registerTransaction(makeCommand());

      expect(result.artefacts).toEqual([
        {
          medium: 'link',
          disposition: 'send',
          content: 'https://hub.eparagony.pl/view/abc123',
          contentType: null,
          label: 'Receipt',
        },
      ]);
    });

    it('should still succeed with no artefacts when a confirmed document carries no link', async () => {
      const client = makeClient([{ ...CONFIRMED, documentUrl: undefined }]);
      const result = await makeAdapter(client).registerTransaction(makeCommand());

      // An empty artefact list is a SUCCESSFUL registration, not a failure.
      expect(result.artefacts).toEqual([]);
      expect(result.documentReference).toBe('334');
    });
  });

  describe('registerTransaction - failure classification', () => {
    it('should report a validation rejection as rejected when the provider refused the document', async () => {
      const client = makeClient([CONFIRMED]);
      client.post.mockRejectedValue(
        new EparagonyApiError('rejected', 400, { errorCode: 41, statusCode: 400 }),
      );

      await expect(makeAdapter(client).registerTransaction(makeCommand())).rejects.toMatchObject({
        failureMode: 'rejected',
      });
    });

    it('should report a server error as in-doubt when the document may already exist', async () => {
      const client = makeClient([CONFIRMED]);
      client.post.mockRejectedValue(new EparagonyApiError('boom', 503, null));

      await expect(makeAdapter(client).registerTransaction(makeCommand())).rejects.toMatchObject({
        failureMode: 'in-doubt',
      });
    });

    it('should report an idempotency-key conflict as in-doubt rather than rejected', async () => {
      // 422 means the SAME key was replayed with DIFFERENT data, so a document
      // exists. Calling that rejected would invite the resend this contract
      // exists to prevent.
      const client = makeClient([CONFIRMED]);
      client.post.mockRejectedValue(new EparagonyApiError('conflict', 422, null));

      await expect(makeAdapter(client).registerTransaction(makeCommand())).rejects.toMatchObject({
        failureMode: 'in-doubt',
      });
    });

    it('should report a rate limit as in-doubt when the create outcome is unknown', async () => {
      const client = makeClient([CONFIRMED]);
      client.post.mockRejectedValue(new EparagonyApiError('slow down', 429, null));

      await expect(makeAdapter(client).registerTransaction(makeCommand())).rejects.toMatchObject({
        failureMode: 'in-doubt',
      });
    });

    it('should report a transport failure as in-doubt when the request may have landed', async () => {
      const client = makeClient([CONFIRMED]);
      client.post.mockRejectedValue(new EparagonyNetworkError('timed out'));

      await expect(makeAdapter(client).registerTransaction(makeCommand())).rejects.toMatchObject({
        failureMode: 'in-doubt',
      });
    });

    it('should report an exhausted poll budget as in-doubt when the device never confirmed', async () => {
      jest.useFakeTimers();
      try {
        const client = makeClient([PENDING]);
        const adapter = makeAdapter(client, makeConfig({ statusPollTimeoutMs: 5_000 }));
        const promise = adapter.registerTransaction(makeCommand());
        const assertion = expect(promise).rejects.toMatchObject({ failureMode: 'in-doubt' });
        await jest.advanceTimersByTimeAsync(20_000);
        await assertion;
      } finally {
        jest.useRealTimers();
      }
    });

    it('should wait the operator-configured first gap before re-reading the status (#2840)', async () => {
      // The poll is what a fiscal registration mostly costs - measured at ~75%
      // of 8 323 ms of job work against a 2 s device - and the loop's first
      // read is issued immediately, so against a slower device it is premature
      // by construction. An operator who knows their device sets the gap and
      // saves a whole round trip. Asserted through the CLOCK, not the config
      // getter: reading back the value we wrote proves nothing about the sleep.
      jest.useFakeTimers();
      try {
        const client = makeClient([PENDING, PENDING, CONFIRMED]);
        const adapter = makeAdapter(client, makeConfig({ statusPollInitialDelayMs: 4_000 }));
        const promise = adapter.registerTransaction(makeCommand());

        await jest.advanceTimersByTimeAsync(0);
        expect(client.get).toHaveBeenCalledTimes(1);

        // Still inside the configured gap - the default 1 000 ms would have
        // issued a second read by now, which is exactly the round trip this
        // setting exists to skip.
        await jest.advanceTimersByTimeAsync(3_500);
        expect(client.get).toHaveBeenCalledTimes(1);

        await jest.advanceTimersByTimeAsync(1_000);
        expect(client.get).toHaveBeenCalledTimes(2);

        await jest.advanceTimersByTimeAsync(20_000);
        await promise;
      } finally {
        jest.useRealTimers();
      }
    });

    it('should ignore a first gap it cannot read rather than turning the ladder into a hot loop', async () => {
      // `config` is JSONB, so the coercion has to live in the adapter. A NaN
      // would make sleep() return immediately and hammer somebody else's fiscal
      // device; the value is ignored and the shipped default applies.
      jest.useFakeTimers();
      try {
        const client = makeClient([PENDING, CONFIRMED]);
        const adapter = makeAdapter(
          client,
          makeConfig({ statusPollInitialDelayMs: Number.NaN }),
        );
        const promise = adapter.registerTransaction(makeCommand());

        await jest.advanceTimersByTimeAsync(0);
        expect(client.get).toHaveBeenCalledTimes(1);

        await jest.advanceTimersByTimeAsync(999);
        expect(client.get).toHaveBeenCalledTimes(1);

        await jest.advanceTimersByTimeAsync(2);
        expect(client.get).toHaveBeenCalledTimes(2);

        await jest.advanceTimersByTimeAsync(20_000);
        await promise;
      } finally {
        jest.useRealTimers();
      }
    });

    it('should clamp a first gap of zero up to the floor so the poll can never busy-loop', async () => {
      jest.useFakeTimers();
      try {
        const client = makeClient([PENDING, CONFIRMED]);
        const adapter = makeAdapter(client, makeConfig({ statusPollInitialDelayMs: 0 }));
        const promise = adapter.registerTransaction(makeCommand());

        await jest.advanceTimersByTimeAsync(0);
        expect(client.get).toHaveBeenCalledTimes(1);

        await jest.advanceTimersByTimeAsync(200);
        expect(client.get).toHaveBeenCalledTimes(1);

        await jest.advanceTimersByTimeAsync(100);
        expect(client.get).toHaveBeenCalledTimes(2);

        await jest.advanceTimersByTimeAsync(20_000);
        await promise;
      } finally {
        jest.useRealTimers();
      }
    });

    it('should report a terminal device error as rejected when the provider says it failed', async () => {
      const client = makeClient([
        {
          status: 'ERROR',
          documentType: 'RECEIPT',
          processingMode: 'FISCALIZATION',
          errorCode: 83,
          errorDescription: 'Kod bledu drukarki: 16',
        },
      ]);

      await expect(makeAdapter(client).registerTransaction(makeCommand())).rejects.toMatchObject({
        failureMode: 'rejected',
      });
    });

    it('should never leak the vendor error description into the operator-facing reason', async () => {
      // The vendor quotes the printer, which quotes the product name.
      const client = makeClient([
        {
          status: 'ERROR',
          documentType: 'RECEIPT',
          errorCode: 83,
          errorDescription: 'bledna nazwa towaru: Secret Product Name',
        },
      ]);

      await expect(makeAdapter(client).registerTransaction(makeCommand())).rejects.toMatchObject({
        reason: expect.not.stringContaining('Secret Product Name') as unknown as string,
      });
    });

    it('should read the status instead of failing when the document already exists under our token', async () => {
      const client = makeClient([CONFIRMED]);
      client.post.mockRejectedValue(
        new EparagonyApiError('exists', 400, { errorCode: 118, statusCode: 400 }),
      );

      // Our token is deterministic, so "already exists" means OUR earlier
      // attempt landed - resolving it is correct, reporting a rejection is not.
      const result = await makeAdapter(client).registerTransaction(makeCommand());
      expect(result.documentReference).toBe('334');
    });
  });

  describe('registerTransaction - composition blocks', () => {
    it('should block before sending anything when a line has no resolvable tax rate', async () => {
      const client = makeClient([CONFIRMED]);
      const adapter = makeAdapter(client, makeConfig({ defaultTaxRateCode: undefined }));

      await expect(adapter.registerTransaction(makeCommand())).rejects.toBeInstanceOf(
        EparagonyConfigException,
      );
      expect(client.post).not.toHaveBeenCalled();
    });

    it('should classify a composition block as rejected because nothing crossed the boundary', async () => {
      const client = makeClient([CONFIRMED]);
      const adapter = makeAdapter(client, makeConfig({ defaultTaxRateCode: undefined }));

      await expect(adapter.registerTransaction(makeCommand())).rejects.toMatchObject({
        failureMode: 'rejected',
      });
    });

    it('should balance the receipt with a rebate line when the total differs from the line sum', async () => {
      const client = makeClient([CONFIRMED]);
      // Lines sum to 60.48; the buyer paid 55.48 after an order-level discount.
      await makeAdapter(client).registerTransaction(makeCommand({ totalGross: 55.48 }));

      const [, body] = client.post.mock.calls[0] as [
        string,
        { eReceipt: { lines: Array<{ type: string; value?: number }>; payment: { totalPaid: number } } },
      ];
      const rebate = body.eReceipt.lines.find((line) => line.type === 'REBATE');
      expect(rebate?.value).toBe(-500);
      expect(body.eReceipt.payment.totalPaid).toBe(5548);
    });

    it('should block rather than emit a positive-valued markup line for rounding dust (S2)', async () => {
      // Lines sum to 60.48; a total of 60.49 sums to LESS than the lines, which
      // core's own upstream reconciliation guarantees can only be
      // floating-point/rounding dust, never a real declared surcharge.
      const client = makeClient([CONFIRMED]);
      const adapter = makeAdapter(client);

      await expect(
        adapter.registerTransaction(makeCommand({ totalGross: 60.49 })),
      ).rejects.toBeInstanceOf(EparagonyConfigException);
      expect(client.post).not.toHaveBeenCalled();
    });

    it('should emit no balancing line when the total already equals the line sum', async () => {
      const client = makeClient([CONFIRMED]);
      await makeAdapter(client).registerTransaction(makeCommand());

      const [, body] = client.post.mock.calls[0] as [
        string,
        { eReceipt: { lines: Array<{ type: string }> } },
      ];
      expect(body.eReceipt.lines.every((line) => line.type === 'PRODUCT')).toBe(true);
    });
  });

  describe('locateByQuery', () => {
    it('should resolve the registration when the provider holds a confirmed document', async () => {
      const client = makeClient([CONFIRMED]);
      const located = await makeAdapter(client).locateByQuery({
        idempotencyKey: 'fiscal:conn-1:ol_order_1',
      });

      expect(located).toMatchObject({
        status: 'registered',
        registration: {
          providerReference: deriveDocumentToken(CONNECTION_ID, 'fiscal:conn-1:ol_order_1'),
          documentReference: '334',
          signingIdentity: 'TEST0000000001',
        },
      });
      const [path] = client.get.mock.calls[0] as [string];
      expect(path).toContain(deriveDocumentToken(CONNECTION_ID, 'fiscal:conn-1:ol_order_1'));
    });

    it('should report no match when the provider does not know the token', async () => {
      // Live probing returned 92 where only 100 was documented - both are handled.
      const client = makeClient([
        new EparagonyApiError('unknown', 400, { errorCode: 92, statusCode: 400 }),
      ]);

      await expect(makeAdapter(client).locateByQuery({ idempotencyKey: 'k' })).resolves.toEqual({
        status: 'not-found',
      });
    });

    it('should report the document as HELD when it exists but is not confirmed yet', async () => {
      // The third outcome (ADR-042 amendment #2502, decision 1). Before it this
      // branch answered "no match", and the operator surface reported a sale the
      // provider was handling normally as one it did not have.
      const client = makeClient([PENDING]);

      const located = await makeAdapter(client).locateByQuery({ idempotencyKey: 'k' });

      expect(located).toMatchObject({ status: 'held' });
    });

    it('should report an unrecognised status as HELD rather than as a registration', async () => {
      // Core may only terminalise on a status this build understands.
      const client = makeClient([{ ...PENDING, status: 'SOMETHING_NEW' }]);

      const located = await makeAdapter(client).locateByQuery({ idempotencyKey: 'k' });

      expect(located).toMatchObject({ status: 'held', detail: 'SOMETHING_NEW' });
    });

    it('should report no match when the provider reports the document in error', async () => {
      // A failed document is an absence of a registration, not work in progress:
      // reporting it as held would tell the operator to wait for a receipt that
      // is never coming.
      const client = makeClient([{ ...PENDING, status: 'ERROR' }]);

      await expect(makeAdapter(client).locateByQuery({ idempotencyKey: 'k' })).resolves.toEqual({
        status: 'not-found',
      });
    });

    it('should rethrow a transport failure so it is never read as no match', async () => {
      const client = makeClient([new EparagonyNetworkError('down')]);

      await expect(
        makeAdapter(client).locateByQuery({ idempotencyKey: 'k' }),
      ).rejects.toBeInstanceOf(EparagonyNetworkError);
    });

    it('should report no match when no idempotency key is supplied', async () => {
      const client = makeClient([CONFIRMED]);

      await expect(makeAdapter(client).locateByQuery({ orderId: 'ol_order_1' })).resolves.toEqual({
        status: 'not-found',
      });
      expect(client.get).not.toHaveBeenCalled();
    });
  });

  describe('tolerant parsing', () => {
    it('should ignore unknown fields and degrade on missing ones when the vendor changes shape', async () => {
      const client = makeClient([
        {
          status: 'CONFIRMED',
          // A field the contract never documented.
          somethingNew: { nested: true },
          fiscalDeviceUniqueNumber: 'TEST1',
          documentUrl: 'https://hub.eparagony.pl/view/x',
        } as EparagonyDocumentStatusResponse,
      ]);

      const result = await makeAdapter(client).registerTransaction(makeCommand());
      expect(result.signingIdentity).toBe('TEST1');
      // No receipt or document number came back - independently nullable.
      expect(result.documentReference).toBeNull();
      expect(result.artefacts).toHaveLength(1);
      // Nothing anchored a registration time (I7) - record null rather than
      // fabricating OL's own clock as a provider-reported timestamp.
      expect(result.registeredAt).toBeNull();
    });

    it('should not promote a non-scalar into a fiscal identity field', async () => {
      const client = makeClient([
        { status: 'CONFIRMED', fiscalDeviceUniqueNumber: { oops: 1 } } as EparagonyDocumentStatusResponse,
      ]);

      const result = await makeAdapter(client).registerTransaction(makeCommand());
      expect(result.signingIdentity).toBeNull();
    });
  });
});
