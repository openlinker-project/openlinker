/**
 * Inventory Location Exception Filter
 *
 * Maps the inventory-location domain errors (#2313) into accurate HTTP statuses
 * for the locations CRUD API (#2316). Without it NestJS defaults to 500, which
 * would report an operator's own input — a code they already used, a location
 * they already stocked — as a server fault:
 *
 *  - `DuplicateLocationCodeError` → 409 Conflict
 *  - `LocationNotFoundException`  → 404 Not Found
 *  - `LocationInUseError`         → 409 Conflict
 *
 * Both 409s are state conflicts rather than malformed input, which is why they
 * are not 400: the request is well-formed and would be accepted against a
 * different current state (the `ConnectionDisabledException` precedent).
 *
 * Sibling of `CapabilityNotSupportedFilter` / `ConnectionExceptionFilter`;
 * registered globally in `main.ts` and mirrored in the integration harness's
 * `configureApp`, or int-specs would see 500s the running app never returns.
 * The filters catch disjoint exception types, so registration order is
 * irrelevant.
 *
 * @module apps/api/src/common/filters
 */

import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import {
  DuplicateLocationCodeError,
  LocationInUseError,
  LocationNotFoundException,
} from '@openlinker/core/inventory';

type InventoryLocationException =
  | DuplicateLocationCodeError
  | LocationNotFoundException
  | LocationInUseError;

@Catch(DuplicateLocationCodeError, LocationNotFoundException, LocationInUseError)
export class InventoryLocationExceptionFilter implements ExceptionFilter {
  catch(exception: InventoryLocationException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const statusCode =
      exception instanceof LocationNotFoundException
        ? HttpStatus.NOT_FOUND
        : HttpStatus.CONFLICT;
    response.status(statusCode).json({
      statusCode,
      error: exception.name,
      message: exception.message,
    });
  }
}
