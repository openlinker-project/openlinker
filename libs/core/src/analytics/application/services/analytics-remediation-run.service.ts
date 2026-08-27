/**
 * Analytics Remediation Run Service
 *
 * Implements `IAnalyticsRemediationRunService` (#2468). A thin, deliberately
 * behaviour-light wrapper over the ledger repository: the run's lifecycle is
 * decided by whoever is doing the repair (the `analytics.currency.recalculate`
 * handler), not here, because only that caller can re-read the population and
 * know whether the category is actually clear.
 *
 * The one rule this service does own is that a `'failed'` run must carry a
 * non-empty `detail`. That is enforced here rather than at the HTTP boundary
 * because the only writer is a worker handler, which has no DTO validation
 * layer in front of it.
 *
 * @module libs/core/src/analytics/application/services
 * @implements {IAnalyticsRemediationRunService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import { ANALYTICS_REMEDIATION_RUN_REPOSITORY_TOKEN } from '../../analytics.tokens';
import type { AnalyticsRemediationRun } from '../../domain/entities/analytics-remediation-run.entity';
import { AnalyticsRemediationRunRepositoryPort } from '../../domain/ports/analytics-remediation-run-repository.port';
import type { AnalyticsRemediationRunView } from '../../domain/types/analytics-remediation-run.types';
import type { IAnalyticsRemediationRunService } from './analytics-remediation-run.service.interface';

@Injectable()
export class AnalyticsRemediationRunService implements IAnalyticsRemediationRunService {
  private readonly logger = new Logger(AnalyticsRemediationRunService.name);

  constructor(
    @Inject(ANALYTICS_REMEDIATION_RUN_REPOSITORY_TOKEN)
    private readonly repository: AnalyticsRemediationRunRepositoryPort
  ) {}

  async openRun(input: {
    category: string;
    affectedCount: number;
    triggeredByUserId: string;
  }): Promise<AnalyticsRemediationRunView> {
    const run = await this.repository.createRun(
      {
        category: input.category,
        affectedCount: input.affectedCount,
        triggeredByUserId: input.triggeredByUserId,
      },
      'in-progress'
    );
    this.logger.log(
      `analytics_remediation_runs.open category=${input.category} run=${run.id} ` +
        `affectedCount=${input.affectedCount} actor=${input.triggeredByUserId}`
    );
    return this.toView(run);
  }

  async getRun(runId: string): Promise<AnalyticsRemediationRunView | null> {
    const run = await this.repository.findById(runId);
    return run ? this.toView(run) : null;
  }

  async getOpenRun(category: string): Promise<AnalyticsRemediationRunView | null> {
    const run = await this.repository.findOpenByCategory(category);
    return run ? this.toView(run) : null;
  }

  async markResolved(runId: string): Promise<boolean> {
    const won = await this.repository.transitionIfOpen(runId, 'resolved', null);
    if (won) {
      this.logger.log(`analytics_remediation_runs.resolved run=${runId}`);
    } else {
      this.logger.debug(
        `analytics_remediation_runs.resolved skipped: run ${runId} was already terminal`
      );
    }
    return won;
  }

  async markFailed(runId: string, detail: string): Promise<boolean> {
    const trimmed = detail.trim();
    if (trimmed === '') {
      throw new Error(
        `A failed remediation run must carry a non-empty detail (run ${runId})`
      );
    }
    const won = await this.repository.transitionIfOpen(runId, 'failed', trimmed);
    if (won) {
      this.logger.warn(`analytics_remediation_runs.failed run=${runId} detail=${trimmed}`);
    } else {
      this.logger.debug(
        `analytics_remediation_runs.failed skipped: run ${runId} was already terminal`
      );
    }
    return won;
  }

  private toView(run: AnalyticsRemediationRun): AnalyticsRemediationRunView {
    return {
      id: run.id,
      category: run.category,
      status: run.status,
      detail: run.detail,
      affectedCount: run.affectedCount,
      triggeredByUserId: run.triggeredByUserId,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    };
  }
}
