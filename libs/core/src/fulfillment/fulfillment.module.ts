/**
 * Fulfillment Module (#2392)
 *
 * Registers the three `fulfillment_*` ORM entities and the work repository
 * behind its port token.
 *
 * **This is the module #2391's barrel warned about**: *"Framework-freedom ends
 * the day this context gains a module (#2392, ADR-053 says so explicitly)."*
 * What must NOT lapse — and does not — is the property that actually carries
 * weight: **zero sibling-context VALUE edges**. This module imports no sibling
 * context at all; its only `imports` entry is its own
 * `TypeOrmModule.forFeature`. `sales-documents` is the precedent that gained a
 * module, repositories and ORM entities and remained a valid registered leaf.
 *
 * Registering the entities here is also what puts the three tables into the
 * INTEGRATION-TEST schema: `libs/shared/src/database/database.module.ts` uses
 * `autoLoadEntities: true` + `synchronize`, and there is no entity list
 * anywhere, so a table reaches the test database only by being on a
 * `forFeature` of a module the host app transitively imports.
 *
 * @module libs/core/src/fulfillment
 * @see docs/architecture/adrs/053-fulfillment-authority-vocabulary-leaf.md
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { FulfillmentHandshakeService } from './application/services/fulfillment-handshake.service';
import { FulfillmentProgressService } from './application/services/fulfillment-progress.service';
import {
  FULFILLMENT_HANDSHAKE_SERVICE_TOKEN,
  FULFILLMENT_PROGRESS_CLAIM_REPOSITORY_TOKEN,
  FULFILLMENT_PROGRESS_SERVICE_TOKEN,
  FULFILLMENT_WORK_REPOSITORY_TOKEN,
  ROUTING_DECISION_REPOSITORY_TOKEN,
} from './fulfillment.tokens';
import { FulfillmentProgressClaimOrmEntity } from './infrastructure/persistence/entities/fulfillment-progress-claim.orm-entity';
import { FulfillmentProgressClaimRepository } from './infrastructure/persistence/repositories/fulfillment-progress-claim.repository';
import { FulfillmentHoldOrmEntity } from './infrastructure/persistence/entities/fulfillment-hold.orm-entity';
import { FulfillmentWorkLineOrmEntity } from './infrastructure/persistence/entities/fulfillment-work-line.orm-entity';
import { FulfillmentWorkRejectionOrmEntity } from './infrastructure/persistence/entities/fulfillment-work-rejection.orm-entity';
import { FulfillmentWorkOrmEntity } from './infrastructure/persistence/entities/fulfillment-work.orm-entity';
import { RoutingDecisionOrmEntity } from './infrastructure/persistence/entities/routing-decision.orm-entity';
import { FulfillmentWorkRepository } from './infrastructure/persistence/repositories/fulfillment-work.repository';
import { RoutingDecisionRepository } from './infrastructure/persistence/repositories/routing-decision.repository';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      FulfillmentWorkOrmEntity,
      FulfillmentWorkLineOrmEntity,
      FulfillmentHoldOrmEntity,
      FulfillmentWorkRejectionOrmEntity,
      FulfillmentProgressClaimOrmEntity,
      RoutingDecisionOrmEntity,
    ]),
  ],
  providers: [
    FulfillmentWorkRepository,
    { provide: FULFILLMENT_WORK_REPOSITORY_TOKEN, useExisting: FulfillmentWorkRepository },
    FulfillmentHandshakeService,
    { provide: FULFILLMENT_HANDSHAKE_SERVICE_TOKEN, useExisting: FulfillmentHandshakeService },
    FulfillmentProgressClaimRepository,
    {
      provide: FULFILLMENT_PROGRESS_CLAIM_REPOSITORY_TOKEN,
      useExisting: FulfillmentProgressClaimRepository,
    },
    FulfillmentProgressService,
    { provide: FULFILLMENT_PROGRESS_SERVICE_TOKEN, useExisting: FulfillmentProgressService },
    RoutingDecisionRepository,
    { provide: ROUTING_DECISION_REPOSITORY_TOKEN, useExisting: RoutingDecisionRepository },
  ],
  exports: [
    FULFILLMENT_WORK_REPOSITORY_TOKEN,
    FULFILLMENT_HANDSHAKE_SERVICE_TOKEN,
    FULFILLMENT_PROGRESS_SERVICE_TOKEN,
    ROUTING_DECISION_REPOSITORY_TOKEN,
  ],
})
export class FulfillmentModule {}
