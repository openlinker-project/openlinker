/**
 * FulfillmentWorkStatusPollHandler tests
 *
 * @module apps/worker/src/sync/handlers/__tests__
 */
import type { IFulfillmentStatusPollService } from '@openlinker/core/fulfillment';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { IFulfillmentWorkDispatchRouterService } from '@openlinker/core/shipping';
import type { ISyncCursorsService, SyncJobEntity } from '@openlinker/core/sync';

import { FulfillmentWorkStatusPollHandler } from '../fulfillment-work-status-poll.handler';

const job = {
  id: 'job-1',
  jobType: 'fulfillment.work.statusPoll',
  connectionId: 'conn-amz',
  payload: { schemaVersion: 1, pageLimit: 10, cursorKey: 'amazon.mcf.statusPollOffset' },
} as unknown as SyncJobEntity;

function setup(executor: object) {
  const integrations = { getCapabilityAdapter: jest.fn().mockResolvedValue(executor) };
  const poll = {
    pollConnection: jest.fn().mockResolvedValue({
      polled: 2,
      recorded: 3,
      failed: 0,
      nextOffset: 0,
      intents: [
        { kind: 'dispatch', workId: 'w-1' },
        { kind: 'reroute', workId: 'w-2', blockedHolderId: 'conn-amz' },
      ],
    }),
  };
  const router = { routeDispatch: jest.fn().mockResolvedValue({ kind: 'relayed' }) };
  const cursors = {
    getCursor: jest.fn().mockResolvedValue('10'),
    advanceCursor: jest.fn().mockResolvedValue(undefined),
  };
  const handler = new FulfillmentWorkStatusPollHandler(
    integrations as unknown as IIntegrationsService,
    poll as unknown as IFulfillmentStatusPollService,
    router as unknown as IFulfillmentWorkDispatchRouterService,
    cursors as unknown as ISyncCursorsService
  );
  return { handler, integrations, poll, router, cursors };
}

describe('FulfillmentWorkStatusPollHandler', () => {
  const statusSource = { requestFulfillment: jest.fn(), getWorkFulfillmentStatus: jest.fn() };

  it('should poll from the stored offset, relay each dispatch and store the next offset', async () => {
    const { handler, poll, router, cursors } = setup(statusSource);

    await expect(handler.execute(job)).resolves.toEqual({ outcome: 'ok' });

    expect(poll.pollConnection).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: 'conn-amz', source: statusSource, limit: 10, offset: 10 })
    );
    expect(router.routeDispatch).toHaveBeenCalledTimes(1);
    expect(router.routeDispatch).toHaveBeenCalledWith('w-1');
    expect(cursors.advanceCursor).toHaveBeenCalledWith('conn-amz', 'amazon.mcf.statusPollOffset', '0');
  });

  it('should keep going when a relay fails, leaving it to the relay sweep', async () => {
    const { handler, router } = setup(statusSource);
    router.routeDispatch.mockRejectedValue(new Error('source down'));

    await expect(handler.execute(job)).resolves.toEqual({ outcome: 'ok' });
  });

  it('should end as a business failure when the executor offers no status read', async () => {
    const { handler, poll } = setup({ requestFulfillment: jest.fn() });

    await expect(handler.execute(job)).resolves.toEqual({ outcome: 'business_failure' });
    expect(poll.pollConnection).not.toHaveBeenCalled();
  });
});
