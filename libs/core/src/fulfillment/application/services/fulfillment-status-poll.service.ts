/**
 * Fulfillment Status Poll Service
 *
 * One page of the status poll for a connection: its live, accepted work
 * (oldest first), the holder's snapshot for each, the progress events
 * `deriveProgressEventsFromSnapshot` derives, recorded in order. A failure on
 * one work is counted and logged and never stops the page; the next poll
 * reads it again, and the derived idempotency keys make that safe.
 *
 * @module libs/core/src/fulfillment/application/services
 * @implements {IFulfillmentStatusPollService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';

import { FulfillmentWorkRepositoryPort } from '../../domain/ports/fulfillment-work-repository.port';
import type { FulfillmentRelayIntent } from '../../domain/types/fulfillment-progress-event.types';
import { deriveProgressEventsFromSnapshot } from '../../domain/types/fulfillment-status-poll.types';
import {
  FULFILLMENT_PROGRESS_SERVICE_TOKEN,
  FULFILLMENT_WORK_REPOSITORY_TOKEN,
} from '../../fulfillment.tokens';
import { IFulfillmentProgressService } from '../interfaces/fulfillment-progress.service.interface';
import type { IFulfillmentStatusPollService } from '../interfaces/fulfillment-status-poll.service.interface';
import type {
  PollFulfillmentStatusInput,
  PollFulfillmentStatusResult,
} from '../types/fulfillment-status-poll.types';

/** Work a holder may still move: accepted and not on a terminal status. */
const POLLABLE_STATUSES = ['open', 'scheduled', 'in_progress', 'on_hold'] as const;

@Injectable()
export class FulfillmentStatusPollService implements IFulfillmentStatusPollService {
  private readonly logger = new Logger(FulfillmentStatusPollService.name);

  constructor(
    @Inject(FULFILLMENT_WORK_REPOSITORY_TOKEN)
    private readonly repository: FulfillmentWorkRepositoryPort,
    @Inject(FULFILLMENT_PROGRESS_SERVICE_TOKEN)
    private readonly progress: IFulfillmentProgressService
  ) {}

  async pollConnection(input: PollFulfillmentStatusInput): Promise<PollFulfillmentStatusResult> {
    const page = await this.repository.listWorks({
      assignedConnectionId: [input.connectionId],
      requestStatus: ['accepted'],
      status: [...POLLABLE_STATUSES],
      orderBy: 'createdAt_ASC',
      limit: input.limit,
      offset: input.offset,
    });

    let recorded = 0;
    let failed = 0;
    const intents: FulfillmentRelayIntent[] = [];
    for (const work of page.works) {
      try {
        const snapshot = await input.source.getWorkFulfillmentStatus({
          workId: work.id,
          connectionId: input.connectionId,
        });
        for (const event of deriveProgressEventsFromSnapshot(work, snapshot, input.now)) {
          const outcome = await this.progress.record(event);
          if (outcome.status === 'recorded') {
            recorded += 1;
            intents.push(...outcome.intents);
          } else if (outcome.status === 'precondition-failed') {
            this.logger.warn(
              `Status poll for work ${work.id}: ${event.kind} not applied (${outcome.reason})`
            );
            break;
          }
        }
      } catch (error) {
        failed += 1;
        this.logger.warn(
          `Status poll for work ${work.id} on connection ${input.connectionId} failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    const nextOffset = page.works.length < input.limit ? 0 : input.offset + page.works.length;
    return { polled: page.works.length, recorded, failed, nextOffset, intents };
  }
}
