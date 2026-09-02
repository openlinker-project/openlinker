/**
 * Fulfillment Authority API Module (#2353)
 *
 * The HTTP surface over the `fulfillment-authority` leaf. The composition lives
 * here rather than in `libs/core` because the leaf carries an EMPTY
 * cross-context allow-set (ADR-053) and a service reading connections would need
 * one — see `AuthorityStatusService`'s docblock.
 *
 * @module apps/api/src/fulfillment-authority
 */
import { Module } from '@nestjs/common';
import { OrdersModule } from '@openlinker/core/orders';
import { IntegrationsModule } from '../integrations/integrations.module';
import { AUTHORITY_STATUS_SERVICE_TOKEN } from './application/interfaces/authority-status.service.interface';
import { AuthorityStatusService } from './application/services/authority-status.service';
import { FulfillmentAuthorityController } from './http/fulfillment-authority.controller';

@Module({
  imports: [IntegrationsModule, OrdersModule],
  controllers: [FulfillmentAuthorityController],
  providers: [
    AuthorityStatusService,
    { provide: AUTHORITY_STATUS_SERVICE_TOKEN, useExisting: AuthorityStatusService },
  ],
})
export class FulfillmentAuthorityApiModule {}
