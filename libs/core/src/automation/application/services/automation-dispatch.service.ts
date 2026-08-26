/**
 * Inert Automation Dispatch Service (#2360)
 *
 * The declared-but-not-yet-wired implementation of {@link IAutomationDispatchService}.
 * It logs what WOULD have run and returns.
 *
 * **This is not a working automation, and the log copy says so.** An operator
 * (or a future reader) who sees a firing recorded and no action taken must be
 * able to tell "the executors are not built yet" from "the executor failed" —
 * those lead to entirely different investigations. #2361 (the six executors)
 * and #2362 (the at-most-one gate) replace this provider; nothing else changes.
 *
 * The FILE is named for the contract (`automation-dispatch.service.ts`) while
 * the class is named for what this implementation currently is. #2361/#2362
 * replace the class; the contract, and therefore the filename, does not move.
 *
 * @module libs/core/src/automation/application/services
 * @implements {IAutomationDispatchService}
 */
import { Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';

import type {
  AutomationDispatchInput,
  IAutomationDispatchService,
} from '../interfaces/automation-dispatch.service.interface';

@Injectable()
export class InertAutomationDispatchService implements IAutomationDispatchService {
  private readonly logger = new Logger(InertAutomationDispatchService.name);

  dispatch(input: AutomationDispatchInput): Promise<void> {
    for (const rule of input.matchedRules) {
      this.logger.log(
        `Automation "${rule.name}" (${rule.id}) matched ${input.trigger} for ` +
          `${input.facts.subjectKind} ${input.facts.subjectId} with ${rule.actions.length} step(s) — ` +
          `dispatch not yet wired (#2361 executors / #2362 at-most-one gate). Nothing ran.`,
      );
    }
    return Promise.resolve();
  }
}
