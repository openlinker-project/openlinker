/**
 * Sync Job Handler Registry
 *
 * Maps job types to their corresponding handler implementations. Provides
 * a centralized way to resolve handlers for specific job types.
 *
 * @module apps/worker/src/sync/handlers
 */
import { Injectable } from '@nestjs/common';
import { SyncJobHandler, JobType, JobTypeValues } from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';

@Injectable()
export class SyncJobHandlerRegistry {
  private readonly logger = new Logger(SyncJobHandlerRegistry.name);
  private readonly handlers = new Map<JobType, SyncJobHandler>();

  /**
   * Register a handler for a specific job type
   *
   * @param jobType - The job type this handler processes
   * @param handler - The handler implementation
   */
  register(jobType: JobType, handler: SyncJobHandler): void {
    if (this.handlers.has(jobType)) {
      this.logger.warn(`Handler for job type ${jobType} already registered, overwriting`);
    }
    this.handlers.set(jobType, handler);
    this.logger.log(`Registered handler for job type: ${jobType}`);
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

    const handler = this.handlers.get(jobType as JobType);
    if (!handler) {
      this.logger.warn(`No handler registered for job type: ${jobType}`);
      return null;
    }
    return handler;
  }

  /**
   * Get all registered job types
   *
   * @returns Array of registered job type strings
   */
  getRegisteredJobTypes(): string[] {
    return Array.from(this.handlers.keys());
  }
}

