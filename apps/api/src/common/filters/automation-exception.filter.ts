/**
 * Automation Exception Filter (#2363)
 *
 * Maps the `automation` context's eight domain refusals onto distinct HTTP
 * statuses, and — decisively — onto distinct STRUCTURED BODIES.
 *
 * They are eight separate exception types rather than one with a reason string
 * precisely so a caller can tell them apart, and the issue's second acceptance
 * criterion requires exactly that: *"an illegal trigger→action pair is rejected
 * at the API with a 400 naming the pair"*. Each error already carries the facts
 * that name it (`trigger`, `action`, `field`, `index`, …), so those ride
 * alongside the message as real fields — a renderer that had to parse the copy
 * would drift the first time the wording changed.
 *
 * - `AutomationRuleNotFoundError`           → **404**.
 * - `AutomationRuleConflictError`           → **409**. An identical definition already
 *   covers an overlapping window; both would fire, doubling every email and every
 *   label. Not 400 — the request was well formed and the state is fixable.
 * - `AutomationIllegalPairError`            → **400** + `trigger` / `action` / `index`.
 * - `AutomationIllegalConditionFieldError`  → **400** + `trigger` / `field` / `index`.
 * - `AutomationInvalidConditionError`       → **400** + `index`.
 * - `AutomationInvalidActionError`          → **400** + `index`.
 * - `AutomationInvalidTriggerConfigError`   → **400** + `trigger`.
 * - `AutomationStepCountError`              → **400** + `count` / `min` / `max`.
 *
 * A global filter rather than a controller-local catch, matching every other
 * domain exception in the tree: the same `AutomationRulesService` is reachable
 * from the dry run's draft path as well as from the write routes, and a local
 * catch would leave the second caller answering 500 for a state the first one
 * explains. Registered in `main.ts` and mirrored in the integration harness's
 * `configureApp`, or int-specs would see 500s the running app never returns.
 *
 * @module apps/api/src/common/filters
 */
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import {
  AutomationIllegalConditionFieldError,
  AutomationIllegalPairError,
  AutomationInvalidActionError,
  AutomationInvalidConditionError,
  AutomationInvalidTriggerConfigError,
  AutomationRuleConflictError,
  AutomationRuleNotFoundError,
  AutomationStepCountError,
} from '@openlinker/core/automation';

type AutomationRefusal =
  | AutomationIllegalConditionFieldError
  | AutomationIllegalPairError
  | AutomationInvalidActionError
  | AutomationInvalidConditionError
  | AutomationInvalidTriggerConfigError
  | AutomationRuleConflictError
  | AutomationRuleNotFoundError
  | AutomationStepCountError;

@Catch(
  AutomationIllegalConditionFieldError,
  AutomationIllegalPairError,
  AutomationInvalidActionError,
  AutomationInvalidConditionError,
  AutomationInvalidTriggerConfigError,
  AutomationRuleConflictError,
  AutomationRuleNotFoundError,
  AutomationStepCountError
)
export class AutomationExceptionFilter implements ExceptionFilter {
  catch(exception: AutomationRefusal, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const statusCode = this.resolveStatus(exception);

    response.status(statusCode).json({
      statusCode,
      error: exception.name,
      message: exception.message,
      ...this.detailsOf(exception),
    });
  }

  private resolveStatus(exception: AutomationRefusal): number {
    if (exception instanceof AutomationRuleNotFoundError) return HttpStatus.NOT_FOUND;
    if (exception instanceof AutomationRuleConflictError) return HttpStatus.CONFLICT;
    return HttpStatus.BAD_REQUEST;
  }

  /**
   * The facts each error carries, as fields.
   *
   * Ordered most-specific-first: `AutomationIllegalConditionFieldError` and
   * `AutomationIllegalPairError` both expose `trigger`, so a generic
   * trigger-only arm placed first would swallow the pair the AC requires the
   * body to name.
   */
  private detailsOf(exception: AutomationRefusal): Record<string, unknown> {
    if (exception instanceof AutomationIllegalPairError) {
      return {
        trigger: exception.trigger,
        action: exception.action,
        index: exception.index,
      };
    }
    if (exception instanceof AutomationIllegalConditionFieldError) {
      return {
        trigger: exception.trigger,
        field: exception.field,
        index: exception.index,
      };
    }
    if (exception instanceof AutomationInvalidTriggerConfigError) {
      return { trigger: exception.trigger };
    }
    if (exception instanceof AutomationStepCountError) {
      return { count: exception.count, min: exception.min, max: exception.max };
    }
    if (
      exception instanceof AutomationInvalidConditionError ||
      exception instanceof AutomationInvalidActionError
    ) {
      return { index: exception.index };
    }
    if (exception instanceof AutomationRuleConflictError) {
      return {
        trigger: exception.trigger,
        conflictingRuleId: exception.conflictingRuleId,
      };
    }
    return { ruleId: exception.ruleId };
  }
}
