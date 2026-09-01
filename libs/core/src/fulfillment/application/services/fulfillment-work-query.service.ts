/**
 * Fulfillment Work Query Service (#2402, `W3a-13`)
 *
 * Surfaces the pre-existing `FulfillmentWorkRepositoryPort.findByOrderId` across
 * the context boundary and applies the multiplicity policy in one place. See the
 * interface for why there is no connection axis.
 *
 * @module libs/core/src/fulfillment/application/services
 * @implements {IFulfillmentWorkQueryService}
 */
import { Inject, Injectable } from '@nestjs/common';

import { Logger } from '@openlinker/shared/logging';

import { FULFILLMENT_WORK_REPOSITORY_TOKEN } from '../../fulfillment.tokens';
import { FulfillmentWorkRepositoryPort } from '../../domain/ports/fulfillment-work-repository.port';
import type { FulfillmentWorkLinkResolution } from '../../domain/types/fulfillment-work-link.types';
import type { IFulfillmentWorkQueryService } from '../interfaces/fulfillment-work-query.service.interface';

@Injectable()
export class FulfillmentWorkQueryService implements IFulfillmentWorkQueryService {
  private readonly logger = new Logger(FulfillmentWorkQueryService.name);

  constructor(
    @Inject(FULFILLMENT_WORK_REPOSITORY_TOKEN)
    private readonly works: FulfillmentWorkRepositoryPort
  ) {}

  async listBlockingRejectionConnectionIds(orderId: string): Promise<readonly string[]> {
    const works = await this.works.findByOrderId(orderId);

    const connectionIds = new Set<string>();
    for (const work of works) {
      const rejections = await this.works.listBlockingRejections(work.id);
      for (const rejection of rejections) {
        connectionIds.add(rejection.connectionId);
      }
    }

    return [...connectionIds];
  }

  async resolveLinkForOrder(orderId: string): Promise<FulfillmentWorkLinkResolution> {
    const works = await this.works.findByOrderId(orderId);

    if (works.length === 0) return { kind: 'none' };
    if (works.length === 1) return { kind: 'unique', workId: works[0].id };

    // Logged at `warn`, not `debug`: a shipment that stays unlinked is
    // invisible on every downstream surface, so the one place it is observable
    // is here. Naming #2727 gives the gap an address rather than leaving a
    // future reader to rediscover why the column is NULL on a split order.
    const workIds = works.map((work) => work.id);
    this.logger.warn(
      `Order ${orderId} is covered by ${String(works.length)} fulfillment works ` +
        `(${workIds.join(', ')}); leaving the shipment link unset — attributing one ` +
        `shipment across several works needs line grain (#2727).`
    );
    return { kind: 'ambiguous', workIds };
  }
}
