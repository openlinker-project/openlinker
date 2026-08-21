/**
 * Role Coverage Assertion Service
 *
 * Boot-time guard for the `jobs` role (#2279, ADR-051): asserts that every
 * `JobType` in the core vocabulary has a registered handler, and FAILS THE
 * BOOT naming the uncovered types otherwise. In a split deployment a handler
 * that silently never registered would surface only as jobs aging into
 * `dead` hours later; a named boot failure surfaces it at deploy time.
 *
 * Runs at `onApplicationBootstrap`, after `HandlerRegistrationService`'s
 * `onModuleInit` has populated the registry (NestJS guarantees the order).
 *
 * @module apps/worker/src/sync
 */
import type { OnApplicationBootstrap } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { JobTypeValues } from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';
import { SyncJobHandlerRegistry } from './handlers/sync-job-handler.registry';

@Injectable()
export class RoleCoverageAssertionService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RoleCoverageAssertionService.name);

  constructor(private readonly handlerRegistry: SyncJobHandlerRegistry) {}

  onApplicationBootstrap(): void {
    const registered = new Set(this.handlerRegistry.getRegisteredJobTypes());
    const uncovered = JobTypeValues.filter((jobType) => !registered.has(jobType));

    if (uncovered.length > 0) {
      throw new Error(
        `Job-role coverage assertion failed: ${uncovered.length} job type(s) have no registered handler: ` +
          `${uncovered.join(', ')}. A job of these types would sit queued until dead. ` +
          `Register a handler in HandlerRegistrationService or remove the type from JobTypeValues.`
      );
    }

    this.logger.log(
      `Job-role coverage assertion passed: all ${JobTypeValues.length} job types have handlers`
    );
  }
}
