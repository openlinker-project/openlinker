/**
 * Taxonomy Source Unavailable Filter (#2074)
 *
 * Maps `TaxonomySourceUnavailableException` to 422 Unprocessable Entity.
 *
 * The exception extends a bare `Error` and had no HTTP mapping anywhere, so it
 * would default to 500 — misreporting a connection-configuration state as a
 * server fault. It is raised by `DestinationTaxonomyService.resolveScope`, which
 * every taxonomy read funnels through, so #2074 made it reachable from TWO
 * controllers: the new `TaxonomyController` and the repointed marketplace
 * category routes on `MappingOptionsController`. A global filter is what keeps
 * the second one from regressing to a 500 — the reason this is a filter rather
 * than a per-controller catch, matching `CapabilityNotSupportedFilter` (400) and
 * `ConnectionExceptionFilter` (#1087).
 *
 * 422 rather than 400: the request itself is well-formed and the connection
 * exists — it simply has no taxonomy source to read, which the caller cannot fix
 * by changing the request. This matches the shop-side sibling's status for the
 * analogous "this adapter cannot browse" case.
 *
 * @module apps/api/src/common/filters
 * @see {@link TaxonomySourceUnavailableException} for the domain exception shape
 */

import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { TaxonomySourceUnavailableException } from '@openlinker/core/listings';

@Catch(TaxonomySourceUnavailableException)
export class TaxonomySourceUnavailableFilter implements ExceptionFilter {
  catch(exception: TaxonomySourceUnavailableException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    response.status(HttpStatus.UNPROCESSABLE_ENTITY).json({
      statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      error: exception.name,
      // The domain message names the missing capability and the fix (#2063), so
      // it is deliberately surfaced verbatim — it is operator-actionable and
      // carries no credential or platform-internal detail.
      message: exception.message,
    });
  }
}
