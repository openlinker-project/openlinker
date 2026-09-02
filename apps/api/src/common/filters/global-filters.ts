/**
 * The global exception-filter roster (review of PR #2675)
 *
 * One producer, two consumers: `main.ts` (production) and the integration
 * harness's `configureApp`. Before this the roster was written out twice, and
 * the second copy is the one that decides what every int-spec's status-code
 * assertion is actually testing — so a filter added to `main.ts` and forgotten
 * in the harness leaves the whole suite exercising a DIFFERENT error pipeline
 * from the one that ships, with every assertion still green because a 500 is
 * only ever asserted where it is expected.
 *
 * That is a check that stops checking without going red, which is exactly the
 * class this roster is now shaped to make impossible: there is nowhere left for
 * the two to disagree.
 *
 * Filters catch disjoint exception types, so registration order is irrelevant.
 *
 * @module apps/api/src/common/filters
 */
import type { ExceptionFilter } from '@nestjs/common';
import { AutomationExceptionFilter } from './automation-exception.filter';
import { AvailabilityUnknownFilter } from './availability-unknown.filter';
import { CapabilityNotSupportedFilter } from './capability-not-supported.filter';
import { ConnectionExceptionFilter } from './connection-exception.filter';
import { InventoryLocationExceptionFilter } from './inventory-location-exception.filter';
import { ReturnsExceptionFilter } from './returns-exception.filter';
import { TaxonomySourceUnavailableFilter } from './taxonomy-source-unavailable.filter';

/**
 * Fresh instances per call: an app under test and the production app must not
 * share filter objects, and nothing here holds state worth reusing.
 */
export function buildGlobalExceptionFilters(): ExceptionFilter[] {
  return [
    new CapabilityNotSupportedFilter(),
    new ConnectionExceptionFilter(),
    new TaxonomySourceUnavailableFilter(),
    new InventoryLocationExceptionFilter(),
    new AvailabilityUnknownFilter(),
    new ReturnsExceptionFilter(),
    new AutomationExceptionFilter(),
  ];
}
