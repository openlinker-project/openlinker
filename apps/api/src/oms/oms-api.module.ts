/**
 * OMS API Module (#2953)
 *
 * The first api-side module for the OL-OMS plugin: the operator surface for
 * authoring the fulfilment router's ordered ruleset.
 *
 * ## Two imports, and the reason each is the one it is
 *
 * **`IntegrationsModule` is the HOST wrapper, never `PluginRegistryModule`.**
 * The latter is a `@Module({})` shell with a static `forRoot` — importing the
 * bare class yields an EMPTY module, so `ROUTING_RULE_ADMIN_TOKEN` would not
 * resolve, and calling `forRoot` again would double-register every plugin. The
 * host wrapper re-exports it, which is how `FulfillmentRouterBindingModule`
 * already reaches `ROUTING_RULE_SOURCE_TOKEN` from the same `OmsModule`. It also
 * supplies `CONNECTION_SERVICE_TOKEN`, which it exports explicitly.
 *
 * **`InventoryModule` is CORE's, never the API's own wrapper.** The api wrapper
 * (`apps/api/src/inventory/inventory.module.ts`) imports core's module for its
 * two controllers and declares NO `exports` array at all, so importing it would
 * hand this module nothing and `LOCATION_SERVICE_TOKEN` would not resolve — an
 * API BOOT FAILURE rather than a degraded feature, and one that no unit test can
 * catch because `pnpm test` never builds the Nest graph. Both traps are recorded
 * at the top of `docs/lessons.md`.
 *
 * @module apps/api/src/oms
 */
import { Module } from '@nestjs/common';
import { InventoryModule as CoreInventoryModule } from '@openlinker/core/inventory';

import { IntegrationsModule } from '../integrations/integrations.module';
import { SOURCING_RULE_ADMIN_SERVICE_TOKEN } from './application/interfaces/sourcing-rule-admin.service.interface';
import { SourcingRuleAdminService } from './application/services/sourcing-rule-admin.service';
import { OmsSourcingRulesController } from './http/oms-sourcing-rules.controller';

@Module({
  imports: [IntegrationsModule, CoreInventoryModule],
  controllers: [OmsSourcingRulesController],
  providers: [
    SourcingRuleAdminService,
    { provide: SOURCING_RULE_ADMIN_SERVICE_TOKEN, useExisting: SourcingRuleAdminService },
  ],
})
export class OmsApiModule {}
