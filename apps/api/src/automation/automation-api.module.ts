/**
 * Automation API Module (#2363)
 *
 * REST surface for automation v1 — the sibling of `ReturnsReadApiModule` and
 * `CatalogTrustApiModule`: a thin composition over core contexts that own their
 * own persistence.
 *
 * It imports BOTH `AutomationModule` and `OrdersModule`, which is the whole
 * reason the dry run lives here. `OrdersModule` already imports
 * `AutomationModule` (for the T5 packed emission), so composing the two inside
 * `libs/core` would close a DI cycle; an `apps/api` module is a leaf of the
 * graph and closes nothing.
 *
 * Note what is NOT wired: `AUTOMATION_DISPATCH_SERVICE_TOKEN`. It resolves to
 * the #2362 irreversible-action gate rather than the raw dispatcher, but a dry
 * run must reach neither.
 *
 * @module apps/api/src/automation
 */
import { Module } from '@nestjs/common';
import { AutomationModule } from '@openlinker/core/automation';
import { OrdersModule } from '@openlinker/core/orders';

import { AutomationDryRunService } from './application/automation-dry-run.service';
import { AutomationRetryService } from './application/automation-retry.service';
import { AUTOMATION_RETRY_SERVICE_TOKEN } from './application/automation-retry.tokens';
import { AUTOMATION_DRY_RUN_SERVICE_TOKEN } from './application/automation-dry-run.tokens';
import { AutomationsController } from './http/automations.controller';

@Module({
  imports: [AutomationModule, OrdersModule],
  controllers: [AutomationsController],
  providers: [
    AutomationDryRunService,
    { provide: AUTOMATION_DRY_RUN_SERVICE_TOKEN, useExisting: AutomationDryRunService },
    AutomationRetryService,
    { provide: AUTOMATION_RETRY_SERVICE_TOKEN, useExisting: AutomationRetryService },
  ],
})
export class AutomationApiModule {}
