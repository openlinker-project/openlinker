/**
 * Inventory Correction Exception Filter (#3566)
 *
 * Maps the refusals the manual stock correction raises BEFORE the product master
 * is reached. Every body carries a machine-readable `code` (the closed reason),
 * because the dialog branches on it and a status alone cannot tell "no master
 * owns this" from "confirm this large change":
 *
 *  - `InventoryCorrectionVariantNotFoundError`   -> 404
 *  - `InventoryCorrectionTargetRefusedError`     -> 409, `code` = target reason
 *  - `InventoryCorrectionRefusedError`           -> 409 (`no-change`,
 *    `master-unreadable`, `idempotency-key-reused`) or 400 for the two reasons
 *    that are a malformed request (`note-required`, `invalid-quantity`)
 *  - `CorrectionConfirmationRequiredError`       -> 409, `code`
 *    `confirmation-required`, with both D41 thresholds
 *  - `CorrectionContendedError`                  -> 409, `code` `contended`
 *
 * Outcomes AFTER the boundary (refused by the master, in doubt) are not errors:
 * the controller returns them as 200 responses.
 *
 * Registered in `global-filters.ts`, which `main.ts` and the integration harness
 * both consume.
 *
 * @module apps/api/src/common/filters
 */
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import {
  CorrectionConfirmationRequiredError,
  CorrectionContendedError,
  InventoryCorrectionRefusedError,
  InventoryCorrectionTargetRefusedError,
  InventoryCorrectionVariantNotFoundError,
} from '@openlinker/core/inventory';

type InventoryCorrectionException =
  | InventoryCorrectionVariantNotFoundError
  | InventoryCorrectionTargetRefusedError
  | InventoryCorrectionRefusedError
  | CorrectionConfirmationRequiredError
  | CorrectionContendedError;

@Catch(
  InventoryCorrectionVariantNotFoundError,
  InventoryCorrectionTargetRefusedError,
  InventoryCorrectionRefusedError,
  CorrectionConfirmationRequiredError,
  CorrectionContendedError
)
export class InventoryCorrectionExceptionFilter implements ExceptionFilter {
  catch(exception: InventoryCorrectionException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const { statusCode, code, extra } = this.describe(exception);
    response.status(statusCode).json({
      statusCode,
      error: exception.name,
      ...(code !== undefined && { code }),
      message: exception.message,
      ...extra,
    });
  }

  private describe(exception: InventoryCorrectionException): {
    statusCode: HttpStatus;
    code?: string;
    extra: Record<string, unknown>;
  } {
    if (exception instanceof InventoryCorrectionVariantNotFoundError) {
      return { statusCode: HttpStatus.NOT_FOUND, extra: {} };
    }
    if (exception instanceof InventoryCorrectionTargetRefusedError) {
      return { statusCode: HttpStatus.CONFLICT, code: exception.reason, extra: {} };
    }
    if (exception instanceof CorrectionConfirmationRequiredError) {
      return {
        statusCode: HttpStatus.CONFLICT,
        code: 'confirmation-required',
        extra: {
          requestedDelta: exception.requestedDelta,
          currentQuantity: exception.currentQuantity,
          absoluteThresholdUnits: exception.absoluteThresholdUnits,
          relativeThreshold: exception.relativeThreshold,
        },
      };
    }
    if (exception instanceof CorrectionContendedError) {
      return { statusCode: HttpStatus.CONFLICT, code: 'contended', extra: {} };
    }
    const malformed = exception.reason === 'note-required' || exception.reason === 'invalid-quantity';
    return {
      statusCode: malformed ? HttpStatus.BAD_REQUEST : HttpStatus.CONFLICT,
      code: exception.reason,
      extra: {},
    };
  }
}
