/**
 * Sync Job Handler Registry
 *
 * Maps job types to their corresponding handler implementations and their
 * concurrency lane (ADR-050, #2278). Registration is the authoritative home
 * of the jobType→lane mapping — the lane is a required parameter, so a new
 * handler cannot be registered without the judgment being made, and the
 * runner derives lane membership for claiming from this registry.
 *
 * @module apps/worker/src/sync/handlers
 */
import { Injectable } from '@nestjs/common';
import type { SyncJobHandler, JobType, SyncJobLane } from '@openlinker/core/sync';
import { JobTypeValues } from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';

interface RegisteredHandler {
  handler: SyncJobHandler;
  lane: SyncJobLane;
}

@Injectable()
export class SyncJobHandlerRegistry {
  private readonly logger = new Logger(SyncJobHandlerRegistry.name);
  private readonly handlers = new Map<JobType, RegisteredHandler>();

  /**
   * Register a handler for a specific job type under a concurrency lane.
   *
   * The lane is REQUIRED (ADR-050 decision 1): an unassigned jobType must be
   * a loud failure, never a silent default — the compiler enforces the
   * common case here, and the runner's boot-time full-union assertion covers
   * the rest.
   *
   * @param jobType - The job type this handler processes
   * @param handler - The handler implementation
   * @param lane - The ADR-050 concurrency lane this job type executes under
   */
  register(jobType: JobType, handler: SyncJobHandler, lane: SyncJobLane): void {
    if (this.handlers.has(jobType)) {
      this.logger.warn(`Handler for job type ${jobType} already registered, overwriting`);
    }
    this.handlers.set(jobType, { handler, lane });
    this.logger.log(`Registered handler for job type: ${jobType} (lane: ${lane})`);
  }

  /**
   * Get handler for a job type
   *
   * @param jobType - The job type to get handler for
   * @returns Handler instance or null if not found
   */
  getHandler(jobType: string): SyncJobHandler | null {
    // Validate job type
    if (!(JobTypeValues as readonly string[]).includes(jobType)) {
      this.logger.warn(`Invalid job type: ${jobType}`);
      return null;
    }

    const registered = this.handlers.get(jobType as JobType);
    if (!registered) {
      this.logger.warn(`No handler registered for job type: ${jobType}`);
      return null;
    }
    return registered.handler;
  }

  /**
   * Get the concurrency lane a job type was registered under, or null when
   * the type is unregistered.
   */
  getLane(jobType: string): SyncJobLane | null {
    return this.handlers.get(jobType as JobType)?.lane ?? null;
  }

  /**
   * Get every registered job type assigned to the given lane — the lane
   * membership the runner passes to `findAndLockDueJobsForLane`.
   */
  getJobTypesByLane(lane: SyncJobLane): JobType[] {
    return Array.from(this.handlers.entries())
      .filter(([, registered]) => registered.lane === lane)
      .map(([jobType]) => jobType);
  }

  /**
   * Get all registered job types
   *
   * @returns Array of registered job type strings
   */
  getRegisteredJobTypes(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Assert the lane partition covers EVERY member of `JobTypeValues`
   * (ADR-050 decision 1 / ADR-051 decision 6, #2278).
   *
   * Lane-aware claiming selects rows by `"jobType" = ANY(<lane membership>)`,
   * so a jobType outside the partition would be silently stranded in `queued`
   * forever — strictly worse than the loud `markDead` an unhandled type got
   * under the legacy claim. Called at the END of handler registration (which
   * owns the mapping); NestJS does not guarantee lifecycle-hook ordering
   * between providers, so the runner must not carry this assertion itself.
   *
   * @throws Error naming every uncovered job type
   */
  assertFullLaneCoverage(): void {
    const uncovered = JobTypeValues.filter((jobType) => !this.handlers.has(jobType));
    if (uncovered.length > 0) {
      throw new Error(
        `Lane coverage assertion failed (ADR-050): ${uncovered.length} job type(s) have no ` +
          `registered handler+lane and would be silently stranded in 'queued' by lane-aware ` +
          `claiming: ${uncovered.join(', ')}. Register each in HandlerRegistrationService with ` +
          `a lane chosen by cost-of-starvation.`
      );
    }
  }
}
