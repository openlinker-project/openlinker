/**
 * mapAmazonNotificationMessage tests (#4179)
 *
 * @module libs/integrations/amazon/src/infrastructure/mappers/__tests__
 */
import { mapAmazonNotificationMessage } from '../amazon-notification.mapper';

const orderChange = {
  NotificationVersion: '1.0',
  NotificationType: 'ORDER_CHANGE',
  PayloadVersion: '1.0',
  EventTime: '2026-11-17T10:00:00.000Z',
  Payload: {
    OrderChangeNotification: {
      NotificationLevel: 'OrderLevel',
      SellerId: 'A2SELLER',
      AmazonOrderId: '302-1234567-7654321',
      OrderChangeType: 'OrderStatusChange',
    },
  },
  NotificationMetadata: { NotificationId: 'notif-1', SubscriptionId: 's', ApplicationId: 'a', PublishTime: 'p' },
};

describe('mapAmazonNotificationMessage', () => {
  it('should turn an ORDER_CHANGE into one order event keyed by the notification id', () => {
    const message = mapAmazonNotificationMessage({ MessageId: 'sqs-1', ReceiptHandle: 'h', Body: JSON.stringify(orderChange) });
    expect(message).toEqual({
      messageId: 'notif-1',
      receiptHandle: 'h',
      events: [
        {
          domain: 'order',
          externalId: '302-1234567-7654321',
          eventType: 'OrderStatusChange',
          occurredAt: '2026-11-17T10:00:00.000Z',
        },
      ],
    });
  });

  it('should acknowledge a notification type it does not route, without calling it unreadable', () => {
    const message = mapAmazonNotificationMessage({
      MessageId: 'sqs-2',
      ReceiptHandle: 'h',
      Body: JSON.stringify({ NotificationType: 'ANY_OFFER_CHANGED' }),
    });
    expect(message.events).toEqual([]);
    expect(message.unreadable).toBeUndefined();
  });

  it('should mark a body that is not JSON as unreadable', () => {
    expect(mapAmazonNotificationMessage({ MessageId: 'm', ReceiptHandle: 'h', Body: 'hello' }).unreadable).toBeDefined();
  });

  it('should mark an ORDER_CHANGE without an order id as unreadable', () => {
    const body = { ...orderChange, Payload: { OrderChangeNotification: {} } };
    const message = mapAmazonNotificationMessage({ MessageId: 'm', ReceiptHandle: 'h', Body: JSON.stringify(body) });
    expect(message.unreadable).toContain('AmazonOrderId');
  });
});
