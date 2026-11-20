/**
 * Amazon scheduler tasks tests (#4179)
 *
 * @module libs/integrations/amazon/src/infrastructure/scheduler/__tests__
 */
import type { Connection } from '@openlinker/core/identifier-mapping';

import {
  buildAmazonNotificationsDrainTask,
  buildAmazonOfferTasks,
  buildAmazonSchedulerTasks,
} from '../amazon-scheduler-tasks';

const QUEUE_URL = 'https://sqs.eu-west-1.amazonaws.com/123456789012/amazon-notifications';

function connection(id: string, config: Record<string, unknown>, capabilities: string[] = ['OrderSource']): Connection {
  return { id, config, enabledCapabilities: capabilities } as unknown as Connection;
}

describe('buildAmazonNotificationsDrainTask', () => {
  it('should drain only active Amazon connections with OrderSource and a notification queue', async () => {
    const listConnections = jest.fn().mockResolvedValue([
      connection('with-queue', { notificationQueueUrl: QUEUE_URL }),
      connection('no-queue', {}),
      connection('bad-queue', { notificationQueueUrl: 'https://example.com/queue' }),
      connection('no-capability', { notificationQueueUrl: QUEUE_URL }, []),
    ]);
    const task = buildAmazonNotificationsDrainTask(listConnections);

    const selected = await task.connectionFilter?.();

    expect(listConnections).toHaveBeenCalledWith({ platformType: 'amazon', status: 'active' });
    expect(selected?.map((entry) => entry.id)).toEqual(['with-queue']);
  });

  it('should be off by default and enqueue the drain job', () => {
    const task = buildAmazonNotificationsDrainTask(jest.fn());

    expect(task).toMatchObject({
      taskId: 'amazon-notifications-drain',
      jobType: 'marketplace.notifications.drain',
      enabledEnvVar: 'OL_AMAZON_NOTIFICATIONS_DRAIN_SCHEDULER_ENABLED',
      enabledDefault: false,
    });
  });
});

describe('buildAmazonOfferTasks', () => {
  it('should schedule only active Amazon connections with OfferManager and a merchant token', async () => {
    const listConnections = jest.fn().mockResolvedValue([
      connection('ready', { sellerId: 'A2SELLER123' }, ['OfferManager']),
      connection('no-seller', {}, ['OfferManager']),
      connection('bad-seller', { sellerId: 'not a token' }, ['OfferManager']),
      connection('no-capability', { sellerId: 'A2SELLER123' }, ['OrderSource']),
    ]);
    const tasks = buildAmazonOfferTasks(listConnections);

    expect(tasks.map((task) => task.taskId)).toEqual(['amazon-offers-sync', 'amazon-offer-status-sync']);
    for (const task of tasks) {
      const selected = await task.connectionFilter?.();
      expect(selected?.map((entry) => entry.id)).toEqual(['ready']);
      expect(task.enabledDefault).toBe(false);
    }
    expect(listConnections).toHaveBeenCalledWith({ platformType: 'amazon', status: 'active' });
  });
});

describe('buildAmazonSchedulerTasks', () => {
  it('should register the source fulfillment read-back, off by default and needing only OrderSource', () => {
    const task = buildAmazonSchedulerTasks().find(
      (entry) => entry.taskId === 'amazon-source-fulfillment-status-sync',
    );

    expect(task).toMatchObject({
      jobType: 'marketplace.sourceFulfillment.statusSync',
      requiredCapability: 'OrderSource',
      enabledEnvVar: 'OL_AMAZON_SOURCE_FULFILLMENT_STATUS_SYNC_SCHEDULER_ENABLED',
      enabledDefault: false,
    });
    expect(task?.generatePayload({} as Connection)).toEqual({
      schemaVersion: 1,
      limit: 20,
      cursorKey: 'amazon.sourceFulfillmentStatus.scanOffset',
      updatedSinceDays: 30,
    });
  });
});
