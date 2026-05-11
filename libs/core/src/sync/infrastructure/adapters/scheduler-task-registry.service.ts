/**
 * Scheduler Task Registry Service
 *
 * Holds `SchedulerTaskConfig` contributions keyed by `taskId`. Integration
 * modules register their cron tasks at bootstrap (#584); `SchedulerService`
 * (in `apps/api`) drains the registry once at `onApplicationBootstrap` and
 * schedules each task via `@nestjs/schedule`.
 *
 * **Signature divergence from sibling registries (deliberate)**:
 * `RetryClassifierRegistryService`, `WebhookProvisioningRegistryService`,
 * `EmailNormalizerRegistryService`, and `ConnectionTesterRegistryService`
 * all index by `adapterKey` because the host dispatches per-adapter at
 * runtime — `get(adapterKey)` returns the matching contributor. Cron tasks
 * are different: they are **additive and drained-once**. The scheduler
 * iterates the full set at boot and never looks up a single contributor by
 * key thereafter. So `register(task)` / `getAll()` is the right shape, even
 * though it reads as drift at first glance. Do not "fix" this back into
 * sibling shape without revisiting the bootstrap-drain model.
 *
 * Silent overwrite on duplicate `taskId` mirrors the sister registries.
 * Duplicate `taskId` would also collide downstream on
 * `SchedulerRegistry.addCronJob`, surfacing as a hard error there — so the
 * "silent" overwrite is not actually silent in practice.
 *
 * @module libs/core/src/sync/infrastructure/adapters
 * @see {@link SchedulerTaskConfig} for the contribution shape.
 */
import { Injectable } from '@nestjs/common';
import { SchedulerTaskConfig } from '../../domain/types/scheduler-task.types';

@Injectable()
export class SchedulerTaskRegistryService {
  private readonly tasks: Map<string, SchedulerTaskConfig> = new Map();

  register(task: SchedulerTaskConfig): void {
    this.tasks.set(task.taskId, task);
  }

  getAll(): SchedulerTaskConfig[] {
    return [...this.tasks.values()];
  }

  has(taskId: string): boolean {
    return this.tasks.has(taskId);
  }
}
