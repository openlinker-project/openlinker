/**
 * SalesDocumentBatchController - unit tests (#3583)
 *
 * @module apps/api/src/sales-documents/http
 */
import { ConflictException, NotFoundException } from '@nestjs/common';
import type { Connection, ConnectionPort } from '@openlinker/core/identifier-mapping';
import type { ISalesDocumentBatchService } from '@openlinker/core/orders';
import type { JobEnqueuePort } from '@openlinker/core/sync';
import { ROLES_KEY } from '../../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { SalesDocumentBatchController } from './sales-document-batch.controller';

const CONNECTION_ID = '11111111-1111-4111-8111-111111111111';
const user = { id: 'user-1', username: 'op', role: 'operator' } as AuthenticatedUser;

const connection = (
  config: Record<string, unknown>,
  status: Connection['status'] = 'active',
): Connection => ({ id: CONNECTION_ID, status, config }) as unknown as Connection;

const batchedInvoices = {
  salesDocument: {
    documentKind: 'invoice',
    triggerModels: { invoice: 'batched' },
    batchSchedules: { invoice: { frequency: 'daily', time: '18:00' } },
  },
};

describe('SalesDocumentBatchController', () => {
  let batches: {
    countQueue: jest.Mock;
    findRunning: jest.Mock;
    getRun: jest.Mock;
  };
  let connections: { get: jest.Mock };
  let jobEnqueue: { enqueueJob: jest.Mock };
  let controller: SalesDocumentBatchController;

  beforeEach(() => {
    batches = {
      countQueue: jest.fn().mockResolvedValue({ invoice: 3 }),
      findRunning: jest.fn().mockResolvedValue(null),
      getRun: jest.fn(),
    };
    connections = { get: jest.fn().mockResolvedValue(connection(batchedInvoices)) };
    jobEnqueue = { enqueueJob: jest.fn().mockResolvedValue({ jobId: 'job-1', isExisting: false }) };
    controller = new SalesDocumentBatchController(
      batches as unknown as ISalesDocumentBatchService,
      connections as unknown as ConnectionPort,
      jobEnqueue as unknown as JobEnqueuePort,
    );
  });

  it('should let only admin and operator start a run, and viewers read', () => {
    const roles = (method: keyof SalesDocumentBatchController): unknown =>
      Reflect.getMetadata(ROLES_KEY, SalesDocumentBatchController.prototype[method]);
    expect(roles('startRun')).toEqual(['admin', 'operator']);
    expect(roles('getOverview')).toEqual(['admin', 'operator', 'viewer']);
    expect(roles('getRun')).toEqual(['admin', 'operator', 'viewer']);
  });

  it('should report each kind with its schedule and next slot', async () => {
    const overview = await controller.getOverview(CONNECTION_ID);

    const invoice = overview.schedules.find((s) => s.documentKind === 'invoice');
    expect(invoice).toMatchObject({ batched: true, frequency: 'daily', timeZone: 'Europe/Warsaw' });
    expect(invoice?.nextSlots).toHaveLength(1);
    expect(overview.queueCounts).toEqual({ invoice: 3 });
  });

  it('should enqueue the run job with every batched kind and the whole queue', async () => {
    const result = await controller.startRun(CONNECTION_ID, user);

    expect(result).toEqual({ jobId: 'job-1' });
    expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobType: 'salesDocument.batch.run',
        connectionId: CONNECTION_ID,
        payload: {
          schemaVersion: 1,
          trigger: 'manual',
          documentKinds: ['invoice'],
          segment: 'all',
          startedByUserId: 'user-1',
        },
        idempotencyKey: expect.stringMatching(`^salesDocument:batch:${CONNECTION_ID}:manual:`),
      }),
    );
  });

  it.each([
    ['CONNECTION_NOT_BATCHED', connection({}), null],
    ['CONNECTION_NEEDS_REAUTH', connection(batchedInvoices, 'needs_reauth'), null],
    ['CONNECTION_NOT_ACTIVE', connection(batchedInvoices, 'disabled'), null],
    ['BATCH_RUN_IN_PROGRESS', connection(batchedInvoices), { id: 'run-0' }],
  ])('should refuse with %s and enqueue nothing', async (code, conn, running) => {
    connections.get.mockResolvedValue(conn);
    batches.findRunning.mockResolvedValue(running);

    const attempt = controller.startRun(CONNECTION_ID, user);

    await expect(attempt).rejects.toBeInstanceOf(ConflictException);
    await expect(attempt).rejects.toMatchObject({ response: { code } });
    expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
  });

  it("should answer 404 for another connection's run", async () => {
    batches.getRun.mockResolvedValue({ run: { connectionId: 'other' }, items: [] });

    await expect(controller.getRun(CONNECTION_ID, 'run-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
