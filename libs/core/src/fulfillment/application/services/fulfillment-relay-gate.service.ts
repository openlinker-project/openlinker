/**
 * Fulfillment Relay Gate Service (#2401, `W3a-12`)
 *
 * Owns the `fulfillment_works.dispatchRelayedAt` at-most-once claim built by
 * #2392 and unused until now, and its release counterpart.
 *
 * Imports nothing outside this context — the zero-sibling-edge-leaf invariant
 * `libs/core/src/__tests__/barrel-purity.spec.ts` pins per leaf. The relay it
 * gates is fired by `orders`; see the interface for why it cannot be fired here.
 *
 * @module libs/core/src/fulfillment/application/services
 * @implements {IFulfillmentRelayGateService}
 */
import { Inject, Injectable } from '@nestjs/common';

import { Logger } from '@openlinker/shared/logging';

import { FulfillmentWorkRepositoryPort } from '../../domain/ports/fulfillment-work-repository.port';
import type { FulfillmentDispatchRelayClaim } from '../../domain/types/fulfillment-progress-event.types';
import { FULFILLMENT_WORK_REPOSITORY_TOKEN } from '../../fulfillment.tokens';
import type { IFulfillmentRelayGateService } from '../interfaces/fulfillment-relay-gate.service.interface';

@Injectable()
export class FulfillmentRelayGateService implements IFulfillmentRelayGateService {
  private readonly logger = new Logger(FulfillmentRelayGateService.name);

  constructor(
    @Inject(FULFILLMENT_WORK_REPOSITORY_TOKEN)
    private readonly workRepository: FulfillmentWorkRepositoryPort
  ) {}

  async claimDispatch(workId: string): Promise<FulfillmentDispatchRelayClaim> {
    // (1) Read before claim, the same ordering `FulfillmentProgressService` uses:
    // an unknown work id must not touch the claim at all.
    const work = await this.workRepository.findById(workId);
    if (!work) {
      return { status: 'unknown-work', workId };
    }

    // (2) The conditional UPDATE is the serialisation point, not the read above.
    // Two triggers observing the same `shipped` transition both reach here; the
    // `WHERE "dispatchRelayedAt" IS NULL` is what makes exactly one win.
    const won = await this.workRepository.claimDispatchRelay(workId, new Date());
    if (!won) {
      return { status: 'already-relayed' };
    }

    if (work.assignedConnectionId === null) {
      // Not a failure: unassigned work, or a holder cleared by a rejection. The
      // caller relays with no author exclusion, which is correct — there is no
      // author to exclude — but it is stated rather than inferred from a `null`.
      this.logger.debug(
        `Dispatch relay claimed for work ${workId}, which carries no holder — ` +
          `relaying with no author exclusion`
      );
    }

    return {
      status: 'claimed',
      orderId: work.orderId,
      holderConnectionId: work.assignedConnectionId,
    };
  }

  async releaseDispatch(workId: string): Promise<void> {
    await this.workRepository.releaseDispatchRelay(workId);
  }
}
