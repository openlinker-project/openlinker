/**
 * Amazon Notification Mapper (#4179)
 *
 * Turns the body of an SQS message Amazon SP-API delivered into neutral
 * canonical events, following Amazon's published schema
 * (`schemas/notifications/OrderChangeNotification.json`). Pure.
 *
 *   - `ORDER_CHANGE` -> one `order` event for `AmazonOrderId`, typed by
 *     `OrderChangeType`. The event is a trigger: the order is re-read.
 *   - Any other notification type -> no events, not unreadable: the queue may
 *     receive types this build does not route yet, and they are acknowledged.
 *   - A body that is not JSON or lacks the order id -> unreadable.
 *
 * The routing id is Amazon's `NotificationId`, stable across redeliveries.
 *
 * @module libs/integrations/amazon/src/infrastructure/mappers
 */
import type { CanonicalInboundEvent, InboundQueueMessage } from '@openlinker/core/integrations';

import type { SqsMessage } from '../http/amazon-sqs-client';

interface AmazonNotificationBody {
  readonly NotificationType?: string;
  readonly EventTime?: string;
  readonly Payload?: {
    readonly OrderChangeNotification?: {
      readonly AmazonOrderId?: string;
      readonly OrderChangeType?: string;
    };
  };
  readonly NotificationMetadata?: { readonly NotificationId?: string };
}

export function mapAmazonNotificationMessage(message: SqsMessage): InboundQueueMessage {
  const base = { messageId: message.MessageId, receiptHandle: message.ReceiptHandle };
  let body: AmazonNotificationBody;
  try {
    body = JSON.parse(message.Body ?? '') as AmazonNotificationBody;
  } catch {
    return { ...base, events: [], unreadable: 'body is not JSON' };
  }
  if (typeof body !== 'object' || body === null) {
    return { ...base, events: [], unreadable: 'body is not an object' };
  }
  const messageId = body.NotificationMetadata?.NotificationId ?? message.MessageId;

  if (body.NotificationType !== 'ORDER_CHANGE') {
    return { ...base, messageId, events: [] };
  }
  const change = body.Payload?.OrderChangeNotification;
  if (change?.AmazonOrderId === undefined || change.AmazonOrderId.length === 0) {
    return { ...base, messageId, events: [], unreadable: 'ORDER_CHANGE without AmazonOrderId' };
  }
  const event: CanonicalInboundEvent = {
    domain: 'order',
    externalId: change.AmazonOrderId,
    eventType: change.OrderChangeType ?? 'OrderChange',
    ...(body.EventTime ? { occurredAt: body.EventTime } : {}),
  };
  return { ...base, messageId, events: [event] };
}
