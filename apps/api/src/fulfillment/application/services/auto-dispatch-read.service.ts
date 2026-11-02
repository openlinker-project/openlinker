/**
 * Auto-Dispatch Read Service (#2729)
 *
 * The refusal read and the settings preview. Neither decides anything itself:
 * the refusal classification is `classifyAutoDispatchJob` and the preview
 * decision is `planAutoDispatch`, both in `@openlinker/core/shipping`, so what
 * an operator reads here cannot disagree with what the worker handler does.
 *
 * ## Refusals come from `sync_jobs`, not a table of their own
 *
 * The handler's outcome table is the source of truth: a TERMINAL refusal is a
 * succeeded job with `outcome = 'business_failure'` and an `outcomeReason`; a
 * carrier outage or a timing race THROWS, so it is a `queued` job with
 * attempts behind it (or a `dead` one once the ladder is spent), carrying an
 * error. Reading only `business_failure` would show the operator the
 * refusals they can fix and hide the ones that are still being retried - the
 * very split the panel exists to draw. `lastError` is never returned: a
 * carrier's message can carry recipient detail.
 *
 * @module apps/api/src/fulfillment/application/services
 * @implements {IAutoDispatchReadService}
 */
import { Inject, Injectable } from '@nestjs/common';

import {
  FULFILLMENT_WORKLIST_SERVICE_TOKEN,
  type FulfillmentWorkView,
  type IFulfillmentWorklistService,
} from '@openlinker/core/fulfillment';
import {
  CONNECTION_PORT_TOKEN,
  readAutoDispatchConfig,
  readAutoDispatchParcelDefaults,
  type AutoDispatchParcelDefaults,
  type ConnectionPort,
} from '@openlinker/core/identifier-mapping';
import { planAutoDispatch, classifyAutoDispatchJob } from '@openlinker/core/shipping';
import {
  SYNC_JOBS_SERVICE_TOKEN,
  type ISyncJobsService,
  type SyncJob,
  type SyncJobFilters,
} from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';

import type {
  AutoDispatchDraftConfig,
  AutoDispatchHolderView,
  AutoDispatchPreviewItem,
  AutoDispatchPreviewView,
  AutoDispatchRefusalsView,
  AutoDispatchRefusalView,
  IAutoDispatchReadService,
} from '../interfaces/auto-dispatch-read.service.interface';
import {
  AUTO_DISPATCH_PLAN_CONTEXT_LOADER_TOKEN,
  type IAutoDispatchPlanContextLoader,
} from './auto-dispatch-plan-context.loader';

const AUTO_DISPATCH_JOB_TYPE = 'fulfillment.work.autoDispatch';
const FULFILLMENT_EXECUTOR_CAPABILITY = 'FulfillmentExecutor';

/** Rows read per source before merging; bounds the three queries the read makes. */
const SOURCE_PAGE_SIZE = 100;

@Injectable()
export class AutoDispatchReadService implements IAutoDispatchReadService {
  private readonly logger = new Logger(AutoDispatchReadService.name);

  constructor(
    @Inject(CONNECTION_PORT_TOKEN) private readonly connections: ConnectionPort,
    @Inject(SYNC_JOBS_SERVICE_TOKEN) private readonly syncJobs: ISyncJobsService,
    @Inject(FULFILLMENT_WORKLIST_SERVICE_TOKEN)
    private readonly worklist: IFulfillmentWorklistService,
    @Inject(AUTO_DISPATCH_PLAN_CONTEXT_LOADER_TOKEN)
    private readonly planContext: IAutoDispatchPlanContextLoader
  ) {}

  async listRefusals(connectionId: string, limit: number): Promise<AutoDispatchRefusalsView> {
    const holder = await this.describeHolder(connectionId);

    const base: SyncJobFilters = { connectionId, jobType: AUTO_DISPATCH_JOB_TYPE };
    const page = { limit: SOURCE_PAGE_SIZE, offset: 0 };
    const [terminal, dead, queued] = await Promise.all([
      this.syncJobs.findJobs({ ...base, outcome: 'business_failure' }, page),
      this.syncJobs.findJobs({ ...base, status: 'dead' }, page),
      this.syncJobs.findJobs({ ...base, status: 'queued' }, page),
    ]);

    const refusals = [
      ...terminal.items,
      ...dead.items,
      // A queued job with no attempts behind it is simply waiting its turn,
      // not a refusal; one that has failed at least once is on the ladder.
      ...queued.items.filter((job) => job.attempts > 0 && job.lastError !== null),
    ]
      .map((job) => this.toRefusal(job))
      .filter((view): view is AutoDispatchRefusalView => view !== null)
      .sort((a, b) => b.since.getTime() - a.since.getTime());

    return {
      holder,
      needsInput: refusals.filter((view) => view.bucket === 'needs-input').slice(0, limit),
      retrying: refusals.filter((view) => view.bucket === 'retrying').slice(0, limit),
    };
  }

  async preview(
    connectionId: string,
    draft: AutoDispatchDraftConfig,
    limit: number
  ): Promise<AutoDispatchPreviewView> {
    const holder = await this.describeHolder(connectionId);
    // The draft goes through the same coercion the saved config does, so a value
    // the real read would drop (a blank template, a non-positive weight) is
    // dropped here too and the preview cannot show a parcel the worker would not.
    const config = readAutoDispatchParcelDefaults({ autoDispatch: draft });

    const page = await this.worklist.list({ assignedConnectionId: [connectionId], limit });
    const items = await Promise.all(page.works.map((work) => this.previewWork(work, config)));

    return { holder, items };
  }

  private async previewWork(
    work: FulfillmentWorkView,
    config: AutoDispatchParcelDefaults
  ): Promise<AutoDispatchPreviewItem> {
    const refused = (refusal: AutoDispatchPreviewItem['refusal']): AutoDispatchPreviewItem => ({
      workId: work.id,
      orderId: work.orderId,
      weightGrams: null,
      template: null,
      dimensions: null,
      refusal,
    });

    // One work whose facts cannot be read must not take the whole preview down:
    // it is reported as the unreadable row it is, and the others still answer.
    let context;
    try {
      context = await this.planContext.load(work);
    } catch (error) {
      this.logger.warn(
        `auto-dispatch preview could not read work ${work.id}: ` +
          `${error instanceof Error ? error.message : String(error)}`
      );
      return refused('order-unreadable');
    }
    if (context === null || context.order === null) {
      return refused('order-unreadable');
    }

    const plan = planAutoDispatch({
      lines: work.lines,
      variantWeightGrams: context.variantWeightGrams,
      parcelProfile: context.parcelProfile,
      config,
      order: context.order,
      requirementsFor: context.requirementsFor,
    });
    if (plan.kind === 'refused') {
      return refused(plan.reason);
    }

    return {
      workId: work.id,
      orderId: work.orderId,
      weightGrams: plan.parcel.weightGrams ?? null,
      template: plan.parcel.template ?? null,
      dimensions: plan.parcel.dimensions ?? null,
      refusal: null,
    };
  }

  private toRefusal(job: SyncJob): AutoDispatchRefusalView | null {
    const classified = classifyAutoDispatchJob({
      status: job.status,
      outcome: job.outcome ?? null,
      outcomeReason: job.outcomeReason ?? null,
    });
    if (classified === null) {
      return null;
    }
    const payload = job.payload as { workId?: unknown; orderId?: unknown };
    return {
      jobId: job.id,
      workId: typeof payload.workId === 'string' ? payload.workId : null,
      orderId: typeof payload.orderId === 'string' ? payload.orderId : null,
      code: classified.code,
      bucket: classified.bucket,
      // The persisted-shape type allows an ISO string; the entity carries a Date.
      since: new Date(job.updatedAt),
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
    };
  }

  private async describeHolder(connectionId: string): Promise<AutoDispatchHolderView> {
    const connection = await this.connections.get(connectionId);
    return {
      connectionId: connection.id,
      name: connection.name,
      platformType: connection.platformType,
      holdsWork: connection.enabledCapabilities.includes(FULFILLMENT_EXECUTOR_CAPABILITY),
      autoDispatchEnabled: readAutoDispatchConfig(connection.config).enabled,
    };
  }
}
