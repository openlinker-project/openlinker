/**
 * Promotions Module (#3935)
 *
 * Registers the four ORM entities, the three repositories and the two
 * application services. No cross-context imports: facts and supply arrive as
 * arguments, so `orders` depends on this context and never the reverse.
 *
 * @module libs/core/src/promotions
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PromotionApplicationService } from './application/services/promotion-application.service';
import { PromotionService } from './application/services/promotion.service';
import { PromotionApplicationOrmEntity } from './infrastructure/persistence/entities/promotion-application.orm-entity';
import { PromotionGrantOrmEntity } from './infrastructure/persistence/entities/promotion-grant.orm-entity';
import { PromotionStateOrmEntity } from './infrastructure/persistence/entities/promotion-state.orm-entity';
import { PromotionOrmEntity } from './infrastructure/persistence/entities/promotion.orm-entity';
import { PromotionApplicationLogRepository } from './infrastructure/persistence/repositories/promotion-application-log.repository';
import { PromotionLedgerRepository } from './infrastructure/persistence/repositories/promotion-ledger.repository';
import { PromotionRepository } from './infrastructure/persistence/repositories/promotion.repository';
import {
  PROMOTION_APPLICATION_LOG_TOKEN,
  PROMOTION_APPLICATION_SERVICE_TOKEN,
  PROMOTION_LEDGER_TOKEN,
  PROMOTION_REPOSITORY_TOKEN,
  PROMOTION_SERVICE_TOKEN,
} from './promotions.tokens';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PromotionOrmEntity,
      PromotionStateOrmEntity,
      PromotionGrantOrmEntity,
      PromotionApplicationOrmEntity,
    ]),
  ],
  providers: [
    PromotionRepository,
    { provide: PROMOTION_REPOSITORY_TOKEN, useExisting: PromotionRepository },
    PromotionLedgerRepository,
    { provide: PROMOTION_LEDGER_TOKEN, useExisting: PromotionLedgerRepository },
    PromotionApplicationLogRepository,
    { provide: PROMOTION_APPLICATION_LOG_TOKEN, useExisting: PromotionApplicationLogRepository },
    PromotionService,
    { provide: PROMOTION_SERVICE_TOKEN, useExisting: PromotionService },
    PromotionApplicationService,
    { provide: PROMOTION_APPLICATION_SERVICE_TOKEN, useExisting: PromotionApplicationService },
  ],
  exports: [
    PROMOTION_SERVICE_TOKEN,
    PROMOTION_APPLICATION_SERVICE_TOKEN,
    PROMOTION_APPLICATION_LOG_TOKEN,
  ],
})
export class PromotionsModule {}
