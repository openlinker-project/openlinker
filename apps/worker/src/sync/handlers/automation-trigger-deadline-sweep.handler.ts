/**
 * Automation Deadline Sweep Handler (#2360, Wave-2 spec §5.2)
 *
 * The `deadline-sweep` half of automation v1. T4 `order.dispatch_deadline_near`
 * is its only consumer today; T3 joins it unchanged once `order_holds` lands.
 *
 * ## Why the composition lives HERE and not in `libs/core/src/automation`
 *
 * The sweep needs an `orders` read and an `automation` evaluation. Putting the
 * read inside `automation` would create an `automation -> orders` edge which,
 * together with T5's `orders -> automation` emission, is a module cycle — one
 * that would then need `ModuleRef` to survive. #2100 sets the precedent for
 * avoiding rather than surviving it: `AutoIssueTriggerService.onOrderTransition`
 * is CALLED FROM `OrderIngestionService` so that `invoicing` needs no
 * `OrdersModule` token. The worker handler may inject both freely, so it asks
 * for the candidate page, projects the facts, and hands them over — and
 * `automation` imports no sibling context at all. It also matches #2359's
 * contract, which takes an already-assembled facts projection precisely so the
 * assembling caller owns the read.
 *
 * ## Why `runBoundedSweep` is deliberately NOT called
 *
 * That helper is the scan-offset fan-out family: it enqueues one CHILD per item.
 * This pass **enqueues nothing** (#2330's rule — a page of deadline work must
 * not fan out into an unbounded child wave), and a child job would carry no work
 * #2361 does not already own. What is reused is the family's *properties*: a
 * page budget, a per-scope lock whose TTL covers one run, and a rolling scan
 * offset — so the pass is budgeted, resumable and lock-serialised.
 *
 * The candidate query is **not** filtered on `automation_trigger_firings`: that
 * is an `automation` table (a cross-context join needing ADR-036 treatment) and
 * the firing key is per RULE, a grain the query cannot see. Dedup is the firing
 * claim, so an already-fired pair is re-read each cycle and simply loses.
 *
 * ## `occurredAt` is the CROSSING, never the deadline
 *
 * `occurredAt = dispatchByAt - withinHours`. `dispatchByAt` is a FUTURE instant
 * relative to this sweep, so passing it would clear #2359's retroactivity floor
 * (`occurredAt < rule.createdAt`) unconditionally, and a rule created today
 * would fire for every order already inside its window. T4 is legal for
 * `dispatch-shipment` under the §5.4 matrix, so that is "40 orders, 40 labels"
 * with real money spent. A spec pins this, because the wrong value is plausible
 * enough that a reader will "simplify" it back.
 *
 * @module apps/worker/src/sync/handlers
 * @see docs/specs/product-spec-oms-wave2-operator-experience.md §5.2
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  AUTOMATION_RULES_SERVICE_TOKEN,
  AUTOMATION_TRIGGER_EMISSION_SERVICE_TOKEN,
  type AutomationRule,
  type IAutomationRulesService,
  type IAutomationTriggerEmissionService,
} from '@openlinker/core/automation';
import {
  ORDER_RECORD_SERVICE_TOKEN,
  type IOrderRecordService,
} from '@openlinker/core/orders';
import {
  SYNC_CURSORS_SERVICE_TOKEN,
  SYNC_LOCK_TOKEN,
  SyncJobExecutionError,
  type ISyncCursorsService,
  type SyncJob,
  type SyncJobHandler,
  type SyncJobHandlerResult,
  type SyncLockPort,
} from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';

/** Candidates examined per run. Each is a rule evaluation plus at most one conditional INSERT. */
const DEFAULT_PAGE_LIMIT = 200;
/** Covers one RUN, never one cycle — the #2218 rule. */
const LOCK_TTL_MS = 5 * 60 * 1000;
const CURSOR_KEY = 'automation.deadlineSweep.scanOffset';
/** The master sweeps' "cycle complete" sentinel — `ISyncCursorsService` exposes no delete. */
const CURSOR_CLEARED = '';

/** The distinct, usable `hoursBefore` thresholds across the armed T4 rules. */
function collectThresholds(rules: readonly { triggerConfig: unknown }[]): ReadonlySet<number> {
  const thresholds = new Set<number>();
  for (const rule of rules) {
    const config = rule.triggerConfig as { hoursBefore?: unknown };
    // A T3/T4 rule can read back with `{}` when its config did not narrow
    // (#2358's read path degrades rather than dropping the row), so a missing or
    // non-positive threshold is skipped rather than defaulted — the safe
    // direction, and #2359 reports the same rule as `trigger-config-invalid`.
    if (typeof config.hoursBefore === 'number' && config.hoursBefore > 0) {
      thresholds.add(config.hoursBefore);
    }
  }
  return thresholds;
}

/**
 * A deliberate STRUCTURAL narrowing of `OrderRecord` — only the three fields this
 * sweep reads. Not a domain type; it decouples from the entity on purpose, so keep
 * the field names in step with it.
 */
interface DeadlineCandidate {
  readonly internalOrderId: string;
  readonly dispatchByAt: Date | null;
  readonly sourceConnectionId: string;
}

@Injectable()
export class AutomationTriggerDeadlineSweepHandler implements SyncJobHandler {
  private readonly logger = new Logger(AutomationTriggerDeadlineSweepHandler.name);

  constructor(
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecords: IOrderRecordService,
    // Through the service interface, never the repository port: a repository
    // port is an INTRA-context contract and crossing the boundary with one is a
    // `check-cross-context-imports` deny.
    @Inject(AUTOMATION_RULES_SERVICE_TOKEN)
    private readonly rules: IAutomationRulesService,
    @Inject(AUTOMATION_TRIGGER_EMISSION_SERVICE_TOKEN)
    private readonly emission: IAutomationTriggerEmissionService,
    // `ISyncCursorsService`, not `ConnectionCursorRepositoryPort`: a repository
    // port is an intra-context contract and may not cross a context boundary.
    @Inject(SYNC_CURSORS_SERVICE_TOKEN)
    private readonly cursors: ISyncCursorsService,
    @Inject(SYNC_LOCK_TOKEN)
    private readonly locks: SyncLockPort,
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const lockKey = `automation:deadline-sweep:${job.connectionId}`;
    const lockToken = await this.locks.acquire(lockKey, LOCK_TTL_MS);
    if (lockToken === null) {
      this.logger.debug(
        `Automation deadline sweep already in progress for connection ${job.connectionId}`,
      );
      return { outcome: 'ok' };
    }

    try {
      await this.sweep(job);
      return { outcome: 'ok' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `Automation deadline sweep failed: ${message}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined,
      );
    } finally {
      await this.locks.release(lockKey, lockToken).catch(() => undefined);
    }
  }

  private async sweep(job: SyncJob): Promise<void> {
    // Every T4 rule carries its own `hoursBefore`, so the read window is the
    // WIDEST any rule asks for; each rule's own threshold is then applied by the
    // evaluator via its `occurredAt`. A per-rule query would be N queries for
    // one page of orders.
    const rules = await this.rules.listRulesByTrigger('order.dispatch_deadline_near');
    const widestHours = Math.max(0, ...collectThresholds(rules));

    if (widestHours <= 0) {
      // No armed T4 rule with a usable threshold — nothing to sweep. Clearing the
      // cursor means a rule added later starts a fresh cycle rather than
      // resuming into the middle of a page it never saw.
      await this.cursors.advanceCursor(job.connectionId, CURSOR_KEY, CURSOR_CLEARED);
      return;
    }

    const now = new Date();
    const windowEnd = new Date(now.getTime() + widestHours * 60 * 60 * 1000);
    const offset = await this.readOffset(job.connectionId);

    const candidates = await this.orderRecords.findDispatchDeadlineCandidates(job.connectionId, {
      now,
      windowEnd,
      limit: DEFAULT_PAGE_LIMIT,
      offset,
    });

    // Computed ONCE per run, not per candidate: the rule set is fixed for the
    // whole page, so recomputing it inside the loop was O(candidates x rules)
    // for an answer that cannot change.
    const thresholds = collectThresholds(rules);
    for (const candidate of candidates) {
      if (candidate.dispatchByAt === null) continue;
      await this.emitForCandidate(candidate, thresholds, now, rules);
    }

    if (candidates.length < DEFAULT_PAGE_LIMIT) {
      // Page exhausted: the cycle is complete, so the next tick starts over.
      await this.cursors.advanceCursor(job.connectionId, CURSOR_KEY, CURSOR_CLEARED);
    } else {
      // Advance by rows READ, not by rows that fired — a pair that lost its
      // claim still consumed a row, and paging by outcome would re-read it
      // forever.
      await this.cursors.advanceCursor(
        job.connectionId,
        CURSOR_KEY,
        String(offset + candidates.length),
      );
    }
  }

  /**
   * Emit T4 for one order, once per distinct `hoursBefore` among the armed rules.
   *
   * The evaluator is per-(trigger, facts), and `occurredAt` depends on the
   * rule's own `hoursBefore` — so rules are grouped by threshold and one
   * emission runs per group. Rules whose window this order has not yet entered
   * are simply not in a group whose crossing has passed.
   */
  private async emitForCandidate(
    candidate: DeadlineCandidate,
    thresholds: ReadonlySet<number>,
    now: Date,
    rules: readonly AutomationRule[],
  ): Promise<void> {
    const deadline = candidate.dispatchByAt;
    if (deadline === null) return;

    for (const hoursBefore of thresholds) {
      const crossing = new Date(deadline.getTime() - hoursBefore * 60 * 60 * 1000);
      // Not yet inside this rule's window — nothing has happened to fire on.
      if (crossing.getTime() > now.getTime()) continue;

      await this.emission.emit({
        trigger: 'order.dispatch_deadline_near',
        facts: {
          subjectKind: 'order',
          subjectId: candidate.internalOrderId,
          // THE CROSSING, not the deadline. See the class docblock.
          occurredAt: crossing,
          sourceConnectionId: candidate.sourceConnectionId,
        },
        now,
        // Already loaded for this whole page — see `AutomationEmissionInput.rules`.
        rules,
      });
    }
  }

  private async readOffset(connectionId: string): Promise<number> {
    const raw = await this.cursors.getCursor(connectionId, CURSOR_KEY);
    // `''` is the cleared value the master sweeps use to mean "cycle complete";
    // there is no delete on the service interface.
    if (raw === null || raw === CURSOR_CLEARED) return 0;
    const parsed = Number.parseInt(raw, 10);
    // A malformed cursor starts a fresh cycle rather than wedging the sweep —
    // the #2218 defensive-parse rule.
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
  }
}
