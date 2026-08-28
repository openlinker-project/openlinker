/**
 * Operational Settings Service
 *
 * Resolves the sweep budgets and deletion-audit cadence across
 * `DB row -> env var -> code default`, and owns the server-side bounds on a
 * write (#2651). The `PosthogSettingsService` / `ReportingCurrencySettingsService`
 * shape: a singleton row, a `ConfigService` env rung, and a view that reports
 * WHICH rung answered.
 *
 * Two properties are load-bearing rather than incidental.
 *
 * **No cache.** `resolve()` reads the row every call, because the worker calls
 * it once per tick and the whole point of the surface is that a change takes
 * effect without a restart. A singleton primary-key lookup is sub-millisecond,
 * which is the same reason `MultiProviderAiCompletionAdapter` reads its active
 * provider through the database on every completion (#452).
 *
 * **The deletion audit has no off switch here.** #2222 made
 * `master.product.reconcile` the deletion authority; an operator switching it
 * off silently reopens #1689 - a deleted product whose offers keep selling. So
 * `OperationalSettingsInput` carries a cadence and no enablement, and a cadence
 * that fires less often than weekly is refused as a disable in disguise rather
 * than accepted as a very slow schedule.
 *
 * @module libs/core/src/operational-settings/application/services
 * @implements {IOperationalSettingsService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CronTime } from 'cron';
import { InvalidOperationalSettingError } from '../../domain/exceptions/operational-settings.exception';
import { OperationalSettingsRepositoryPort } from '../../domain/ports/operational-settings-repository.port';
import {
  DELETION_AUDIT_CADENCE_DEFAULT,
  DELETION_AUDIT_CADENCE_ENV_VAR,
  OPERATIONAL_SETTING_BOUNDS,
  OPERATIONAL_SETTING_KEYS,
  checkOperationalSettingBound,
  resolveOperationalSetting,
  type OperationalSettingKey,
  type OperationalSettingsInput,
  type OperationalSettingsView,
  type ResolvedOperationalNumber,
  type ResolvedOperationalSetting,
} from '../../domain/types/operational-settings.types';
import { OPERATIONAL_SETTINGS_REPOSITORY_TOKEN } from '../../operational-settings.tokens';
import type { IOperationalSettingsService } from './operational-settings.service.interface';

/**
 * The longest gap between two consecutive firings a cadence may have.
 *
 * Seven days admits every sane operator schedule (hourly, nightly, weekly) and
 * refuses the monthly/annual expressions that are a disable wearing a cron
 * expression - `0 0 1 1 *` runs the deletion authority once a year, which is
 * #1689 reopened with extra steps.
 */
const MAX_DELETION_AUDIT_GAP_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class OperationalSettingsService implements IOperationalSettingsService {
  constructor(
    @Inject(OPERATIONAL_SETTINGS_REPOSITORY_TOKEN)
    private readonly repository: OperationalSettingsRepositoryPort,
    private readonly configService: ConfigService
  ) {}

  async resolve(): Promise<OperationalSettingsView> {
    const stored = await this.repository.findSettings();

    const numeric = (key: OperationalSettingKey): ResolvedOperationalNumber =>
      resolveOperationalSetting(
        key,
        stored?.[key] ?? null,
        this.configService.get<string>(OPERATIONAL_SETTING_BOUNDS[key].envVar)
      );

    return {
      catalogueSweepBudget: numeric('catalogueSweepBudget'),
      inventorySweepBudget: numeric('inventorySweepBudget'),
      sweepPageSize: numeric('sweepPageSize'),
      deletionAuditBudget: numeric('deletionAuditBudget'),
      deletionAuditCadence: this.resolveCadence(stored?.deletionAuditCadence ?? null),
      deletionAuditAlwaysEnabled: true,
      // `null` on the env / default rungs — there is no row to have been
      // written. A row that exists but sets nothing still reports its stamp:
      // "an operator cleared these back to the defaults" is a fact worth
      // showing, and is not the same as "nobody has ever touched this".
      updatedAt: stored?.updatedAt ?? null,
      updatedBy: stored?.updatedBy ?? null,
    };
  }

  async updateSettings(input: OperationalSettingsInput, updatedBy: string | null): Promise<void> {
    const acknowledged = input.acknowledgeAboveRecommended === true;

    for (const key of OPERATIONAL_SETTING_KEYS) {
      const value = input[key];
      if (value === undefined || value === null) {
        continue;
      }
      if (typeof value !== 'number') {
        throw new InvalidOperationalSettingError(key, `${key} must be a number or null`);
      }
      const problem = checkOperationalSettingBound(key, value, acknowledged);
      if (problem !== null) {
        throw new InvalidOperationalSettingError(key, problem);
      }
    }

    if (input.deletionAuditCadence !== undefined && input.deletionAuditCadence !== null) {
      this.assertUsableCadence(input.deletionAuditCadence);
    }

    // The acknowledgement is permission for THIS request, not a stored
    // preference. It is dropped before persistence so it cannot silently
    // license a later write, and so it can never become a column that outlives
    // the decision it recorded. Built by naming the persisted fields rather
    // than by spreading `input` minus one key: a field added to the input type
    // should have to be listed here on purpose.
    await this.repository.upsertSettings(
      {
        ...(input.catalogueSweepBudget !== undefined && {
          catalogueSweepBudget: input.catalogueSweepBudget,
        }),
        ...(input.inventorySweepBudget !== undefined && {
          inventorySweepBudget: input.inventorySweepBudget,
        }),
        ...(input.sweepPageSize !== undefined && { sweepPageSize: input.sweepPageSize }),
        ...(input.deletionAuditBudget !== undefined && {
          deletionAuditBudget: input.deletionAuditBudget,
        }),
        ...(input.deletionAuditCadence !== undefined && {
          deletionAuditCadence: input.deletionAuditCadence,
        }),
      },
      updatedBy
    );
  }

  /**
   * The cadence rung, with the stored value re-validated on the way out.
   *
   * A row edited straight in the database, or written before this validation
   * existed, must not be able to hand `SchedulerService` an expression that
   * makes `new CronJob` throw - that aborts the whole registration loop and
   * leaves the fleet with NO scheduled tasks at all (`scheduler.service.ts`
   * unwinds its latch precisely because of this). Falling back is the safe
   * direction: the audit runs at its default cadence instead of nothing
   * running at all.
   */
  private resolveCadence(stored: string | null): ResolvedOperationalSetting<string> {
    if (stored !== null && this.isUsableCadence(stored)) {
      return { value: stored, source: 'setting' };
    }
    const fromEnv = this.configService.get<string>(DELETION_AUDIT_CADENCE_ENV_VAR);
    if (fromEnv !== undefined && fromEnv.trim().length > 0 && this.isUsableCadence(fromEnv)) {
      return { value: fromEnv, source: 'env' };
    }
    return { value: DELETION_AUDIT_CADENCE_DEFAULT, source: 'default' };
  }

  private assertUsableCadence(expression: string): void {
    const fields = expression.trim().split(/\s+/);
    if (fields.length < 5 || fields.length > 6) {
      // `@hourly` and friends are refused deliberately: an alias set is a
      // second vocabulary to validate the "cannot be disabled" rule against,
      // and every alias has a five-field spelling.
      throw new InvalidOperationalSettingError(
        'deletionAuditCadence',
        'deletionAuditCadence must be a 5- or 6-field cron expression'
      );
    }

    let gapMs: number;
    try {
      const cronTime = new CronTime(expression);
      const first = cronTime.getNextDateFrom(new Date());
      const second = cronTime.getNextDateFrom(first.toJSDate());
      gapMs = second.toMillis() - first.toMillis();
    } catch {
      throw new InvalidOperationalSettingError(
        'deletionAuditCadence',
        'deletionAuditCadence is not a valid cron expression'
      );
    }

    if (gapMs > MAX_DELETION_AUDIT_GAP_MS) {
      throw new InvalidOperationalSettingError(
        'deletionAuditCadence',
        'deletionAuditCadence must fire at least once every 7 days — the deletion audit is the deletion authority and cannot be disabled through this surface'
      );
    }
  }

  private isUsableCadence(expression: string): boolean {
    try {
      this.assertUsableCadence(expression);
      return true;
    } catch {
      return false;
    }
  }
}
