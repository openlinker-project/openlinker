/**
 * SalesDocumentBatchController - unit tests (#3583)
 *
 * The controller is a thin HTTP layer: the overview and the "Run now" policy
 * live in `ISalesDocumentBatchService` (and are tested there). These cases pin
 * the roles, the DTO mapping and the refusal -> status code mapping.
 *
 * @module apps/api/src/sales-documents/http
 */
import { ConflictException, NotFoundException } from '@nestjs/common';
import type { ISalesDocumentBatchService } from '@openlinker/core/orders';
import { ROLES_KEY } from '../../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { SalesDocumentBatchController } from './sales-document-batch.controller';

const CONNECTION_ID = '11111111-1111-4111-8111-111111111111';
const user = { id: 'user-1', username: 'op', role: 'operator' } as AuthenticatedUser;

describe('SalesDocumentBatchController', () => {
  let batches: {
    getOverview: jest.Mock;
    requestRun: jest.Mock;
    getRun: jest.Mock;
  };
  let controller: SalesDocumentBatchController;

  beforeEach(() => {
    batches = {
      getOverview: jest.fn(),
      requestRun: jest.fn(),
      getRun: jest.fn(),
    };
    controller = new SalesDocumentBatchController(
      batches as unknown as ISalesDocumentBatchService,
    );
  });

  it('should let only admin and operator start a run, and viewers read', () => {
    const roles = (method: keyof SalesDocumentBatchController): unknown =>
      Reflect.getMetadata(ROLES_KEY, SalesDocumentBatchController.prototype[method]);
    expect(roles('startRun')).toEqual(['admin', 'operator']);
    expect(roles('getOverview')).toEqual(['admin', 'operator', 'viewer']);
    expect(roles('getRun')).toEqual(['admin', 'operator', 'viewer']);
  });

  it('should map the overview to its DTO', async () => {
    batches.getOverview.mockResolvedValue({
      connectionId: CONNECTION_ID,
      kinds: [
        {
          documentKind: 'invoice',
          batched: true,
          schedule: {
            frequency: 'daily',
            time: '18:00',
            everyHours: 24,
            timeZone: 'Europe/Warsaw',
            effectiveFrom: new Date(0),
          },
          nextSlots: [{ segment: 'all', slotAt: new Date('2026-01-15T17:00:00Z') }],
        },
        { documentKind: 'fiscal-receipt', batched: false, schedule: null, nextSlots: [] },
      ],
      queueCounts: { invoice: 3 },
      runningRun: null,
    });

    const overview = await controller.getOverview(CONNECTION_ID);

    expect(overview.schedules).toEqual([
      {
        documentKind: 'invoice',
        batched: true,
        frequency: 'daily',
        time: '18:00',
        everyHours: 24,
        timeZone: 'Europe/Warsaw',
        nextSlots: [{ segment: 'all', slotAt: '2026-01-15T17:00:00.000Z' }],
      },
      {
        documentKind: 'fiscal-receipt',
        batched: false,
        frequency: null,
        time: null,
        everyHours: null,
        timeZone: null,
        nextSlots: [],
      },
    ]);
    expect(overview.queueCounts).toEqual({ invoice: 3 });
  });

  it('should answer 404 for the overview of a connection that does not exist', async () => {
    batches.getOverview.mockResolvedValue(null);

    await expect(controller.getOverview(CONNECTION_ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('should start a run for the current user and return the job id', async () => {
    batches.requestRun.mockResolvedValue({
      status: 'enqueued',
      jobId: 'job-1',
      documentKinds: ['invoice'],
    });

    await expect(controller.startRun(CONNECTION_ID, user)).resolves.toEqual({ jobId: 'job-1' });
    expect(batches.requestRun).toHaveBeenCalledWith({
      connectionId: CONNECTION_ID,
      startedByUserId: 'user-1',
    });
  });

  it.each([
    ['not-batched', 'CONNECTION_NOT_BATCHED'],
    ['connection-needs-reauth', 'CONNECTION_NEEDS_REAUTH'],
    ['connection-not-active', 'CONNECTION_NOT_ACTIVE'],
    ['run-in-progress', 'BATCH_RUN_IN_PROGRESS'],
  ])('should answer 409 %s with code %s', async (reason, code) => {
    batches.requestRun.mockResolvedValue({ status: 'refused', reason });

    const attempt = controller.startRun(CONNECTION_ID, user);

    await expect(attempt).rejects.toBeInstanceOf(ConflictException);
    await expect(attempt).rejects.toMatchObject({ response: { code } });
  });

  it('should answer 404 when starting a run on a connection that does not exist', async () => {
    batches.requestRun.mockResolvedValue({ status: 'refused', reason: 'connection-not-found' });

    await expect(controller.startRun(CONNECTION_ID, user)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("should answer 404 for another connection's run", async () => {
    batches.getRun.mockResolvedValue({ run: { connectionId: 'other' }, items: [] });

    await expect(controller.getRun(CONNECTION_ID, 'run-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
