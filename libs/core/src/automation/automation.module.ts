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
import { AutomationRunRepository } from './infrastructure/persistence/repositories/automation-run.repository';
import { AutomationTriggerFiringRepository } from './infrastructure/persistence/repositories/automation-trigger-firing.repository';
import { AutomationRulesService } from './application/services/automation-rules.service';
import { AutomationRunsReadService } from './application/services/automation-runs-read.service';
import { AutomationTriggerEmissionService } from './application/services/automation-trigger-emission.service';
import { AutomationDispatchService } from './application/services/automation-dispatch.service';
import { AutomationIrreversibleGateService } from './application/services/automation-irreversible-gate.service';
import { AutomationDelegateResolverService } from './application/services/automation-delegate-resolver.service';
import { AutomationActionExecutorRegistry } from './application/services/automation-action-executor.registry';
import { LoggingAutomationRunRecorder } from './application/services/automation-run-recorder.service';
import { RelayStatusToSourceExecutorService } from './application/services/executors/relay-status-to-source-executor.service';
import { SendEmailExecutorService } from './application/services/executors/send-email-executor.service';
import { UnavailableActionExecutorService } from './application/services/executors/unavailable-action-executor.service';
import {
  AUTOMATION_DISPATCH_SERVICE_TOKEN,
  AUTOMATION_RULES_SERVICE_TOKEN,
  AUTOMATION_RUNS_READ_SERVICE_TOKEN,
  AUTOMATION_RUN_RECORDER_TOKEN,
  AUTOMATION_RULE_REPOSITORY_TOKEN,
  AUTOMATION_RUN_REPOSITORY_TOKEN,
  AUTOMATION_TRIGGER_EMISSION_SERVICE_TOKEN,
  AUTOMATION_TRIGGER_FIRING_REPOSITORY_TOKEN,
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
    AutomationRunRepository,
    { provide: AUTOMATION_RUN_REPOSITORY_TOKEN, useExisting: AutomationRunRepository },
    AutomationRulesService,
    { provide: AUTOMATION_RULES_SERVICE_TOKEN, useExisting: AutomationRulesService },
    AutomationTriggerFiringRepository,
    {
      provide: AUTOMATION_TRIGGER_FIRING_REPOSITORY_TOKEN,
      useExisting: AutomationTriggerFiringRepository,
    },
    // The dispatch seam has been swapped twice by provider binding alone, which
    // is what declaring it early (#2360) bought. #2362's gate is the CURRENT
    // binding; `AutomationDispatchService` stays a provider because the gate
    // delegates to it — it is no longer what the token resolves to.
    AutomationDelegateResolverService,
    RelayStatusToSourceExecutorService,
    SendEmailExecutorService,
    UnavailableActionExecutorService,
    AutomationActionExecutorRegistry,
    LoggingAutomationRunRecorder,
    { provide: AUTOMATION_RUN_RECORDER_TOKEN, useExisting: LoggingAutomationRunRecorder },
    AutomationDispatchService,
    AutomationIrreversibleGateService,
    {
      provide: AUTOMATION_DISPATCH_SERVICE_TOKEN,
      useExisting: AutomationIrreversibleGateService,
    },
    AutomationTriggerEmissionService,
    {
      provide: AUTOMATION_TRIGGER_EMISSION_SERVICE_TOKEN,
      useExisting: AutomationTriggerEmissionService,
    },
    // Declared AFTER the recorder it reads: `AutomationRunsReadService` answers
    // "are firings persisted in this build" from the bound recorder, which is
    // the only component that knows (#2363).
    AutomationRunsReadService,
    { provide: AUTOMATION_RUNS_READ_SERVICE_TOKEN, useExisting: AutomationRunsReadService },
  ],
  exports: [
    AUTOMATION_RULE_REPOSITORY_TOKEN,
    AUTOMATION_RULES_SERVICE_TOKEN,
    AUTOMATION_TRIGGER_FIRING_REPOSITORY_TOKEN,
    AUTOMATION_DISPATCH_SERVICE_TOKEN,
    AUTOMATION_RUN_RECORDER_TOKEN,
    AUTOMATION_RUNS_READ_SERVICE_TOKEN,
    AUTOMATION_TRIGGER_EMISSION_SERVICE_TOKEN,
    AutomationActionExecutorRegistry,
  ],
})
export class AutomationModule {}
