/**
 * Operational Settings Service
 *
 * Resolves the sweep budgets and deletion-audit cadence across
 * `DB row -> env var -> code default`, and owns the server-side bounds on a
 * write (#2651). The `PosthogSettingsService` / `ReportingCurrencySettingsService`
 * shape: a singleton row, a `ConfigService` env rung, and a view that reports
 * WHICH rung answered.
 *
 * Three properties are load-bearing rather than incidental.
 *
 * **The env rung is this PROCESS's environment, and the answer says so.** This
 * service runs in both the api and the worker, which load their own `.env` and
 * carry separate `environment:` blocks in `docker-compose.yml` - and since
 * #2279 the sweeps run in the WORKER. So an env rung resolved here answers for
 * the api, never for the process that applies the value. Every resolved value
 * therefore carries `workerMayDiffer` (`source !== 'setting'`): only a value
 * read from the shared settings ROW is authoritative for both processes. The
 * rung is still reported rather than dropped, because dropping it would answer
 * `default` for a value an env var really did change (#2660 review).
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
  CATALOGUE_SWEEP_CADENCE_DEFAULT,
  CATALOGUE_SWEEP_CADENCE_ENV_VAR,
  DELETION_AUDIT_CADENCE_DEFAULT,
  DELETION_AUDIT_CADENCE_ENV_VAR,
  INVENTORY_SWEEP_CADENCE_DEFAULT,
  INVENTORY_SWEEP_CADENCE_ENV_VAR,
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

/**
 * How far ahead the gap check probes (#2660 review).
 *
 * Measuring the gap between the NEXT TWO firings is not the same question as
 * "does this fire at least weekly". `0 0 1,2 1 *` puts two firings a day apart
 * and then nothing for a year, so the two-firing check accepted it, the audit
 * ran twice a year, and #1689 reopened behind a gate reporting it closed. The
 * shape is stable from any starting point, so a longer walk was needed.
 *
 * It probes by TIME rather than by occurrence. Walking N consecutive firings
 * cannot be made sound at any fixed N - a day-of-month list fires 28 times in
 * January and then not for eleven months, so the offending gap always sits just
 * past whatever N is chosen. Stepping forward one maximum-gap at a time and
 * asking "is there a firing within the next 7 days from HERE" tests the actual
 * property, at a cost independent of how densely the expression fires: 53
 * `getNextDateFrom` calls for a year, whatever the cadence.
 */
const DELETION_AUDIT_PROBE_SPAN_MS = 366 * 24 * 60 * 60 * 1000;

/**
 * Whether the cron library can parse an expression at all.
 *
 * Deliberately NOT the deletion-audit gap rule: the sweep cadences carry no
 * "cannot be disabled" invariant, so a slow sweep is an operator's choice and
 * only an unparseable one is refused (and then only by falling back).
 */
function isParseableCron(expression: string): boolean {
  try {
    const parsed = new CronTime(expression);
    return parsed !== null;
  } catch {
    return false;
  }
}

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
      // Read-only, and never `source: 'setting'` - there is no column for
      // either. Reported so a consumer computing a full-pass length uses the
      // cadence actually in force (#2660 review): both are settable through the
      // WORKER's environment, and a consumer assuming the shipped 20 / 15
      // minutes is off by an order of magnitude on an install that changed one.
      catalogueSweepCadence: this.resolveEnvCadence(
        CATALOGUE_SWEEP_CADENCE_ENV_VAR,
        CATALOGUE_SWEEP_CADENCE_DEFAULT
      ),
      inventorySweepCadence: this.resolveEnvCadence(
        INVENTORY_SWEEP_CADENCE_ENV_VAR,
        INVENTORY_SWEEP_CADENCE_DEFAULT
      ),
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
      return { value: stored, source: 'setting', workerMayDiffer: false };
    }
    const fromEnv = this.configService.get<string>(DELETION_AUDIT_CADENCE_ENV_VAR);
    if (fromEnv !== undefined && fromEnv.trim().length > 0 && this.isUsableCadence(fromEnv)) {
      return { value: fromEnv, source: 'env', workerMayDiffer: true };
    }
    return { value: DELETION_AUDIT_CADENCE_DEFAULT, source: 'default', workerMayDiffer: true };
  }

  /**
   * A cadence this surface reports but cannot set.
   *
   * Always `workerMayDiffer: true`: there is no row to read, so the value can
   * only ever come from THIS process's environment or from the shipped default,
   * and the scheduler that registers it runs in the worker (#2279). A malformed
   * value falls back to the default rather than being reported verbatim - the
   * scheduler would fall back too, so reporting the malformed string would name
   * a cadence nothing runs on.
   */
  private resolveEnvCadence(
    envVar: string,
    fallback: string
  ): ResolvedOperationalSetting<string> {
    const fromEnv = this.configService.get<string>(envVar);
    if (fromEnv !== undefined && fromEnv.trim().length > 0 && isParseableCron(fromEnv.trim())) {
      return { value: fromEnv.trim(), source: 'env', workerMayDiffer: true };
    }
    return { value: fallback, source: 'default', workerMayDiffer: true };
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

    let cronTime: CronTime;
    try {
      cronTime = new CronTime(expression);
    } catch {
      throw new InvalidOperationalSettingError(
        'deletionAuditCadence',
        'deletionAuditCadence is not a valid cron expression'
      );
    }

    // A probe that THROWS is the cron library reporting that it found no
    // matching date at all - which is this same refusal, not a parse failure,
    // so it must not be reported as an invalid expression.
    let exceedsMaxGap = false;
    const start = Date.now();
    const horizon = start + DELETION_AUDIT_PROBE_SPAN_MS;
    for (let probe = start; probe <= horizon; probe += MAX_DELETION_AUDIT_GAP_MS) {
      let next: number;
      try {
        next = cronTime.getNextDateFrom(new Date(probe)).toMillis();
      } catch {
        exceedsMaxGap = true;
        break;
      }
      if (next - probe > MAX_DELETION_AUDIT_GAP_MS) {
        exceedsMaxGap = true;
        break;
      }
    }

    if (exceedsMaxGap) {
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
