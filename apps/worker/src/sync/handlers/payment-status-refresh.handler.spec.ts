/**
 * Unit tests for `PaymentStatusRefreshHandler` (#1354).
 *
 * Mocks `IPaymentStatusRefreshService`. Pins the `getPayload` validation branches
 * (missing/invalid payload, wrong schemaVersion, empty externalInvoiceId), the
 * success delegation path, and the OL-shaped error wrapping. Mirrors the sibling
 * `regulatory-status-reconcile.handler.spec.ts`.
 *
 * @module apps/worker/src/sync/handlers
 */
import type {
  IPaymentStatusRefreshService,
  PaymentStatusRefreshResult,
} from '@openlinker/core/invoicing';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import type { SyncJob } from '@openlinker/core/sync';
import { PaymentStatusRefreshHandler } from './payment-status-refresh.handler';

function makeJob(payload: unknown): SyncJob {
  return {
    id: 'job-1',
    jobType: 'invoicing.paymentStatus.refreshByExternalId',
    connectionId: 'conn-1',
    payload,
    idempotencyKey: 'invoicing:conn-1:paymentStatus:refresh:inv-1',
    status: 'running',
    attempts: 1,
    maxAttempts: 10,
    nextRunAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  } as SyncJob;
}

const UPDATED: PaymentStatusRefreshResult = { outcome: 'updated', paymentStatus: 'paid' };

describe('PaymentStatusRefreshHandler', () => {
  let refreshService: jest.Mocked<IPaymentStatusRefreshService>;
  let handler: PaymentStatusRefreshHandler;

  beforeEach(() => {
    refreshService = {
      refreshByExternalId: jest.fn().mockResolvedValue(UPDATED),
    };
    handler = new PaymentStatusRefreshHandler(refreshService);
  });

  describe('getPayload', () => {
    it.each([
      ['undefined payload', undefined],
      ['null payload', null],
      ['non-object payload', 'not-an-object'],
      ['wrong schemaVersion', { schemaVersion: 2, externalInvoiceId: 'inv-1' }],
      ['missing externalInvoiceId', { schemaVersion: 1 }],
      ['non-string externalInvoiceId', { schemaVersion: 1, externalInvoiceId: 42 }],
      ['empty externalInvoiceId', { schemaVersion: 1, externalInvoiceId: '' }],
    ])(
      'throws an OL-shaped SyncJobExecutionError and never calls the service for %s',
      async (_label, payload) => {
        await expect(handler.execute(makeJob(payload))).rejects.toBeInstanceOf(
          SyncJobExecutionError,
        );
        expect(refreshService.refreshByExternalId).not.toHaveBeenCalled();
      },
    );
  });

  describe('execute', () => {
    it('delegates to refreshByExternalId(connectionId, externalInvoiceId) and returns { outcome: "ok" }', async () => {
      const result = await handler.execute(
        makeJob({ schemaVersion: 1, externalInvoiceId: 'inv-1' }),
      );

      expect(refreshService.refreshByExternalId).toHaveBeenCalledWith('conn-1', 'inv-1');
      expect(result).toEqual({ outcome: 'ok' });
    });

    it('wraps a thrown error in an OL-shaped SyncJobExecutionError carrying job id / type / connectionId', async () => {
      refreshService.refreshByExternalId.mockRejectedValue(new Error('provider down'));

      await expect(
        handler.execute(makeJob({ schemaVersion: 1, externalInvoiceId: 'inv-1' })),
      ).rejects.toMatchObject({
        name: 'SyncJobExecutionError',
        jobId: 'job-1',
        jobType: 'invoicing.paymentStatus.refreshByExternalId',
        connectionId: 'conn-1',
      });
    });
  });
});
