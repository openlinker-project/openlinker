/**
 * Inline-Evaluated Action Executor (#3938)
 *
 * The registry's entry for an action that is NOT dispatched: `add-gift` is
 * evaluated inside order ingestion, before reservation, because the gift line has
 * to exist when stock is reserved and routing decides. Nothing emits its trigger
 * (`order.ingested`) through the dispatch seam, so this executor is unreachable
 * in a healthy build - it exists so the registry stays TOTAL over
 * `AutomationActionKind` and so a rule that somehow reaches dispatch fails with a
 * sentence that says what happened, instead of reading as "not built yet".
 *
 * @module libs/core/src/automation/application/services/executors
 * @implements {AutomationActionExecutorPort}
 */
import { Injectable } from '@nestjs/common';

import type {
  AutomationActionExecutionInput,
  AutomationActionExecutorPort,
} from '../../../domain/ports/automation-action-executor.port';
import { ATTRIBUTION_OPENLINKER } from '../../../domain/types/automation-step-result.types';
import type { AutomationStepResult } from '../../../domain/types/automation-step-result.types';

const MESSAGE =
  'This action is applied while the order is imported, not by the automation runner, so there is nothing to run here.';

@Injectable()
export class InlineEvaluatedActionExecutorService implements AutomationActionExecutorPort {
  execute(input: AutomationActionExecutionInput): Promise<AutomationStepResult> {
    return Promise.resolve({
      stepIndex: input.stepIndex,
      action: input.action.action,
      status: 'nothing-to-do',
      detail: MESSAGE,
      report: { attributedTo: ATTRIBUTION_OPENLINKER, message: MESSAGE },
    });
  }
}
