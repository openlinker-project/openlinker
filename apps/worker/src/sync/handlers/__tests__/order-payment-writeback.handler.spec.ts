/**
 * OrderPaymentWritebackHandler specs (#3963)
 */
import type { SyncJob } from '@openlinker/core/sync';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import { OrderPaymentWritebackHandler } from '../order-payment-writeback.handler';

function job(overrides: Partial<Record<string, unknown>> = {}): SyncJob {
  return {
    id: 'job-1',
    jobType: 'order.paymentWriteback.push',
    connectionId: 'dest-ps',
    payload: { schemaVersion: 1, internalOrderId: 'ol_order_1', sourceConnectionId: 'src-allegro' },
    attempts: 0,
    maxAttempts: 8,
    ...overrides,
  } as unknown as SyncJob;
}

describe('OrderPaymentWritebackHandler', () => {
  let push: jest.Mock;
  let handler: OrderPaymentWritebackHandler;

  beforeEach(() => {
    push = jest.fn().mockResolvedValue('done');
    handler = new OrderPaymentWritebackHandler({ push } as never);
  });

  it('should push for the destination named by the job and finish ok', async () => {
    await expect(handler.execute(job())).resolves.toEqual({ outcome: 'ok' });
    expect(push).toHaveBeenCalledWith({
      internalOrderId: 'ol_order_1',
      destinationConnectionId: 'dest-ps',
      sourceConnectionId: 'src-allegro',
      isLastAttempt: false,
    });
  });

  it('should throw so the runner retries while the shop is still failing', async () => {
    push.mockResolvedValue('retrying');

    await expect(handler.execute(job())).rejects.toBeInstanceOf(SyncJobExecutionError);
  });

  it('should tell the service when this is the last attempt', async () => {
    await handler.execute(job({ attempts: 7, maxAttempts: 8 }));

    expect(push).toHaveBeenCalledWith(expect.objectContaining({ isLastAttempt: true }));
  });

  it('should reject a payload without a source connection', async () => {
    await expect(
      handler.execute(job({ payload: { schemaVersion: 1, internalOrderId: 'ol_order_1' } }))
    ).rejects.toBeInstanceOf(SyncJobExecutionError);
    expect(push).not.toHaveBeenCalled();
  });
});
