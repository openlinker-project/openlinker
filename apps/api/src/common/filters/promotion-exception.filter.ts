/**
 * Promotion Exception Filter (#3935)
 *
 * Maps the `promotions` context's four domain refusals onto distinct statuses and
 * structured bodies: not found -> 404, an identical overlapping definition -> 409,
 * a malformed definition or a non-exhaustive reorder -> 400, each carrying the
 * facts that name it as fields rather than only in the message.
 *
 * Global rather than a controller-local catch, like the automation filter:
 * the same service is reachable from the dry run's draft path and the write
 * routes. Registered through `global-filters.ts`.
 *
 * @module apps/api/src/common/filters
 */
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import {
  PromotionConflictError,
  PromotionInvalidError,
  PromotionNotFoundError,
  PromotionReorderMismatchError,
} from '@openlinker/core/promotions';

type PromotionRefusal =
  | PromotionConflictError
  | PromotionInvalidError
  | PromotionNotFoundError
  | PromotionReorderMismatchError;

@Catch(
  PromotionConflictError,
  PromotionInvalidError,
  PromotionNotFoundError,
  PromotionReorderMismatchError
)
export class PromotionExceptionFilter implements ExceptionFilter {
  catch(exception: PromotionRefusal, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const statusCode =
      exception instanceof PromotionNotFoundError
        ? HttpStatus.NOT_FOUND
        : exception instanceof PromotionConflictError
          ? HttpStatus.CONFLICT
          : HttpStatus.BAD_REQUEST;
    response.status(statusCode).json({
      statusCode,
      error: exception.name,
      message: exception.message,
      ...this.detailsOf(exception),
    });
  }

  private detailsOf(exception: PromotionRefusal): Record<string, unknown> {
    if (exception instanceof PromotionInvalidError) {
      return { part: exception.part, index: exception.index };
    }
    if (exception instanceof PromotionReorderMismatchError) {
      return {
        missingPromotionIds: exception.missingPromotionIds,
        unknownPromotionIds: exception.unknownPromotionIds,
      };
    }
    if (exception instanceof PromotionConflictError) {
      return { conflictingPromotionId: exception.conflictingPromotionId };
    }
    return { promotionId: exception.promotionId };
  }
}
