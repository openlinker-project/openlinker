/**
 * Amazon Order Source with a notification queue (#4179)
 *
 * The Amazon `OrderSource` plus `InboundQueueReader`: reads the order change
 * notifications Amazon SP-API delivers to the operator's SQS queue, translated
 * by `mapAmazonNotificationMessage`.
 *
 * A separate class, built by the factory only when the connection names a
 * queue and its AWS key. A connection without one gets the plain
 * `AmazonOrderSourceAdapter`, so `isInboundQueueReader` answers no for it and
 * the drain handler can tell "no queue" from a failed read.
 *
 * @module libs/integrations/amazon/src/infrastructure/adapters/order-source
 * @implements {InboundQueueReader}
 */
import type { InboundQueueMessage, InboundQueueReader } from '@openlinker/core/integrations';

import type { AmazonConnectionConfig } from '../../../domain/types/amazon-config.types';
import type { AmazonSpApiClient } from '../../http/amazon-spapi-client';
import type { AmazonSqsClient } from '../../http/amazon-sqs-client';
import { mapAmazonNotificationMessage } from '../../mappers/amazon-notification.mapper';
import type { AmazonReturnReader } from '../returns/amazon-return-reader';
import { AmazonOrderSourceAdapter } from './amazon-order-source.adapter';

export class AmazonQueuedOrderSourceAdapter extends AmazonOrderSourceAdapter implements InboundQueueReader {
  constructor(
    connectionId: string,
    client: AmazonSpApiClient,
    config: AmazonConnectionConfig,
    private readonly notificationQueue: AmazonSqsClient,
    now?: () => Date,
    returns?: AmazonReturnReader,
  ) {
    super(connectionId, client, config, now, returns);
  }

  async receiveInboundMessages(input: { readonly maxMessages: number }): Promise<InboundQueueMessage[]> {
    const messages = await this.notificationQueue.receiveMessages(input.maxMessages);
    return messages.map((message) => mapAmazonNotificationMessage(message));
  }

  async acknowledgeInboundMessages(receiptHandles: readonly string[]): Promise<void> {
    await this.notificationQueue.deleteMessages(receiptHandles);
  }
}
