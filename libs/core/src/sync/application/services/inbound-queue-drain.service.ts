/**
 * Inbound Queue Drain Service (#4179)
 *
 * See `IInboundQueueDrainService`. Each event of a message is routed with the
 * message id (suffixed with the event's position when a message carries more
 * than one) as its source event id, so the job dedup key is stable across
 * redeliveries of the same message.
 *
 * @module application/services
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';

import { INBOUND_ROUTING_POLICY_TOKEN } from '../../sync.tokens';
import type { IInboundQueueDrainService } from '../interfaces/inbound-queue-drain.service.interface';
import { IInboundRoutingPolicyService } from '../interfaces/inbound-routing-policy.service.interface';
import type {
  InboundQueueDrainInput,
  InboundQueueDrainResult,
} from '../types/inbound-queue-drain.types';

@Injectable()
export class InboundQueueDrainService implements IInboundQueueDrainService {
  private readonly logger = new Logger(InboundQueueDrainService.name);

  constructor(
    @Inject(INBOUND_ROUTING_POLICY_TOKEN)
    private readonly routingPolicy: IInboundRoutingPolicyService,
  ) {}

  async drain(input: InboundQueueDrainInput): Promise<InboundQueueDrainResult> {
    const messages = await input.reader.receiveInboundMessages({ maxMessages: input.maxMessages });
    let enqueued = 0;
    let ungated = 0;
    let unreadable = 0;
    let retained = 0;
    const handles: string[] = [];

    for (const message of messages) {
      if (message.events.length === 0) {
        if (message.unreadable !== undefined) {
          unreadable += 1;
          this.logger.warn(
            `inbound_queue_message_unreadable connection=${input.connection.id} message=${message.messageId}: ${message.unreadable}`,
          );
        }
        handles.push(message.receiptHandle);
        continue;
      }
      try {
        for (const [index, event] of message.events.entries()) {
          const sourceEventId = message.events.length === 1 ? message.messageId : `${message.messageId}:${String(index)}`;
          const outcome = await this.routingPolicy.route(
            event,
            input.connection,
            input.supportedCapabilities,
            sourceEventId,
          );
          if (outcome.status === 'enqueued') {
            enqueued += 1;
          } else {
            ungated += 1;
          }
        }
        handles.push(message.receiptHandle);
      } catch (error) {
        retained += 1;
        const detail = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `inbound_queue_message_retained connection=${input.connection.id} message=${message.messageId}: ${detail}`,
        );
      }
    }

    if (handles.length > 0) {
      await input.reader.acknowledgeInboundMessages(handles);
    }
    return {
      received: messages.length,
      enqueued,
      ungated,
      unreadable,
      acknowledged: handles.length,
      retained,
    };
  }
}
