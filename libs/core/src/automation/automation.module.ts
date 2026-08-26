/**
 * Automation Module (#2358)
 *
 * Registers the three ORM entities, the rule repository and the write-path
 * service. No cross-context imports in `imports: []` — this concern needs none
 * of its own.
 *
 * **All three entities are registered, though only one has a repository.**
 * `automation_runs` (write path: #2385) and `automation_trigger_firings`
 * (writer: #2360) are registered here precisely because `forFeature` is what
 * makes `autoLoadEntities` create their tables in the integration harness. A
 * table that no test environment builds is a table whose migration nobody
 * verifies.
 *
 * @module libs/core/src/automation
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AutomationRuleOrmEntity } from './infrastructure/persistence/entities/automation-rule.orm-entity';
import { AutomationRunOrmEntity } from './infrastructure/persistence/entities/automation-run.orm-entity';
import { AutomationTriggerFiringOrmEntity } from './infrastructure/persistence/entities/automation-trigger-firing.orm-entity';
import { AutomationRuleRepository } from './infrastructure/persistence/repositories/automation-rule.repository';
import { AutomationRulesService } from './application/services/automation-rules.service';
import {
  AUTOMATION_RULES_SERVICE_TOKEN,
  AUTOMATION_RULE_REPOSITORY_TOKEN,
} from './automation.tokens';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AutomationRuleOrmEntity,
      AutomationRunOrmEntity,
      AutomationTriggerFiringOrmEntity,
    ]),
  ],
  providers: [
    AutomationRuleRepository,
    { provide: AUTOMATION_RULE_REPOSITORY_TOKEN, useExisting: AutomationRuleRepository },
    AutomationRulesService,
    { provide: AUTOMATION_RULES_SERVICE_TOKEN, useExisting: AutomationRulesService },
  ],
  exports: [AUTOMATION_RULE_REPOSITORY_TOKEN, AUTOMATION_RULES_SERVICE_TOKEN],
})
export class AutomationModule {}
