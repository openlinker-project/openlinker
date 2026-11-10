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
 *    `insufficient-stock`, `master-unreadable`, `idempotency-key-reused`) or 400 for the two reasons
 *    that are a malformed request (`note-required`, `invalid-quantity`)
 *  - `CorrectionConfirmationRequiredError`       -> 409, `code`
 *    `confirmation-required`, with both D41 thresholds
 *  - `CorrectionContendedError`                  -> 409, `code` `contended`
 *
 * `insufficient-stock` carries a top-level `currentQuantity` (the master stock it
 * was judged against), the same field name `confirmation-required` uses.
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
import type { ApiErrorParams, KnownApiErrorCode } from '@openlinker/shared/errors';
import { codedErrorBody } from '../errors/coded-http.exception';
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
    const { statusCode, code, params, extra } = this.describe(exception);
    response
      .status(statusCode)
      .json(
        codedErrorBody(statusCode, code, exception.message, params, {
          error: exception.name,
          ...extra,
        })
      );
  }

  /**
   * The code each refusal sends. The values predate the code registry (#3863)
   * and are kept verbatim: the reason vocabulary, `confirmation-required` and
   * `contended`. The facts clients read stay top-level in `extra`; their
   * scalars are also in `params`.
   */
  private describe(exception: InventoryCorrectionException): {
    statusCode: HttpStatus;
    code: KnownApiErrorCode;
    params?: ApiErrorParams;
    extra: Record<string, unknown>;
  } {
    if (exception instanceof InventoryCorrectionVariantNotFoundError) {
      return {
        statusCode: HttpStatus.NOT_FOUND,
        code: 'INVENTORY_VARIANT_NOT_FOUND',
        params: { productVariantId: exception.productVariantId },
        extra: {},
      };
    }
    if (exception instanceof InventoryCorrectionTargetRefusedError) {
      return { statusCode: HttpStatus.CONFLICT, code: exception.reason, extra: {} };
    }
    if (exception instanceof CorrectionConfirmationRequiredError) {
      const facts = {
        requestedDelta: exception.requestedDelta,
        currentQuantity: exception.currentQuantity,
        absoluteThresholdUnits: exception.absoluteThresholdUnits,
        relativeThreshold: exception.relativeThreshold,
      };
      return {
        statusCode: HttpStatus.CONFLICT,
        code: 'confirmation-required',
        params: facts,
        extra: facts,
      };
    }
    if (exception instanceof CorrectionContendedError) {
      return { statusCode: HttpStatus.CONFLICT, code: 'contended', extra: {} };
    }
    const malformed =
      exception.reason === 'note-required' || exception.reason === 'invalid-quantity';
    const statusCode = malformed ? HttpStatus.BAD_REQUEST : HttpStatus.CONFLICT;
    if (exception.currentQuantity === undefined) {
      return { statusCode, code: exception.reason, extra: {} };
    }
    const current = { currentQuantity: exception.currentQuantity };
    return { statusCode, code: exception.reason, params: current, extra: current };
  }
}
