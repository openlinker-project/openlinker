/**
 * Automation API Client (#2364)
 *
 * Typed client for the #2363 automation surface. Every response is run through
 * the feature's Zod parse rather than cast, so a contract break surfaces as a
 * reported drop instead of an `undefined` rendered into a cell.
 *
 * Two contract details are load-bearing and are enforced here rather than left
 * to call sites:
 *
 * **`GET /automations` REQUIRES `?trigger=`** — the service exposes
 * `listRulesByTrigger` and no list-all, and the index is keyed on the trigger,
 * so an unfiltered call is an HTTP 400. `listByTrigger` takes the trigger as a
 * required argument; there is deliberately no `list()`.
 *
 * **The rule write is `PUT`, not `PATCH`** — the backend re-validates and
 * re-hashes a COMPLETE input, so a partial body nulls `conditions` / `actions`
 * through the narrowers. `replace` therefore takes the whole definition, and
 * `setActive` (below, in the hook) rebuilds it from the loaded rule rather than
 * sending `{isActive}` alone.
 *
 * @module apps/web/src/features/automation/api
 */
import { z } from 'zod';

import {
  parseAutomationDryRun,
  parseAutomationRule,
  parseAutomationRules,
  parseAutomationRun,
  parseAutomationRunLog,
  parseAutomationSummary,
  parseAutomationVocabulary,
  type ParsedAutomationRules,
  type ParsedAutomationSummary,
} from './automation.schema';
import type { AutomationActivityFilters } from '../lib/automation-activity-filters';
import type {
  AutomationDryRunResult,
  AutomationEvaluateInput,
  AutomationRule,
  AutomationRuleWriteInput,
  AutomationRun,
  AutomationRunLog,
  AutomationTrigger,
  AutomationVocabulary,
} from './automation.types';

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

export interface AutomationsApi {
  /** `GET /automations/vocabulary` — the ONLY source of triggers, actions, availability and legality. */
  getVocabulary: () => Promise<AutomationVocabulary>;
  /** `GET /automations/summary` — rule counts for all eight triggers, zeros included. */
  getSummary: () => Promise<ParsedAutomationSummary>;
  /** `GET /automations?trigger=` — the rules on one trigger, active and inactive. */
  listByTrigger: (trigger: AutomationTrigger) => Promise<ParsedAutomationRules>;
  /** `GET /automations/:id`. */
  get: (ruleId: string) => Promise<AutomationRule>;
  /**
   * `GET /automations/:id/runs` — this rule's most recent firings.
   *
   * Resolves to `null` when the envelope cannot be read. Callers must branch on
   * `recordingAvailable` before reading `runs`: while it is false an empty log
   * means the run write path has not landed, NOT that the rule never fired.
   */
  listRuns: (ruleId: string) => Promise<AutomationRunLog | null>;
  /**
   * `POST /automations` — create a rule. Admin only.
   *
   * Refuses with 409 (`AutomationRuleConflictError`) when an identical
   * definition already covers an overlapping window, and 400 for an illegal
   * pair / condition field / step count — each carrying structured fields the
   * composer reads instead of parsing the message.
   */
  create: (input: AutomationRuleWriteInput) => Promise<AutomationRule>;
  /**
   * `GET /automations/runs` — recent firings, newest first.
   *
   * ONE read serves both the activity list and an order's timeline: pass a
   * subject to scope it. That is what makes "one record, four readings" visibly
   * true rather than merely asserted — two endpoints over the same rows could
   * disagree about them.
   *
   * Resolves to `null` when the envelope cannot be read, never a synthesised
   * `recordingAvailable: false`.
   */
  listRunsBySubject: (
    subjectKind: string,
    subjectId: string,
  ) => Promise<AutomationRunLog | null>;
  /**
   * `GET /automations/runs` — the filtered activity feed (#2386).
   *
   * Every filter is narrowing; an unrecognised value is dropped by the filter
   * layer before it reaches here, so the feed never asks the API to honour
   * something it cannot express.
   */
  listRunFeed: (
    filters: AutomationActivityFilters,
    pagination?: { limit?: number; offset?: number },
  ) => Promise<AutomationRunLog | null>;
  /** `GET /automations/attention-count` — how many firings need attention (#2387). */
  getAttentionCount: () => Promise<number>;
  /**
   * `POST /automations/runs/:runId/retry` — re-run that firing's rule. Admin only.
   *
   * Resolves to the ORIGINAL run, re-projected, so the caller sees the attention
   * state clear without a second read. Rejects with the API error when the run is
   * not retryable — the caller should not have offered the action, since
   * `AutomationRun.retryable` says so.
   */
  retryRun: (runId: string) => Promise<AutomationRun>;
  /**
   * `POST /automations/runs/:runId/dismiss` — record that a person handled it.
   *
   * Clears the attention state ONLY. The run stays failed.
   */
  dismissRun: (runId: string) => Promise<AutomationRun>;
  /** `PUT /automations/:id` — a full replace. Admin only. */
  replace: (ruleId: string, input: AutomationRuleWriteInput) => Promise<AutomationRule>;
  /**
   * `POST /automations/evaluate` — would this rule have fired for that order?
   *
   * **Commits nothing and dispatches nothing.** Accepts a saved `ruleId` or an
   * unsaved `rule` draft — exactly one, never both. The draft arm is the point:
   * §5.6(a) exists so a money rule can be tested BEFORE it is armed.
   *
   * Returns a verdict for EVERY rule scoped to the trigger, so a two-money-rules
   * collision is visible before it costs a second label.
   *
   * A draft re-validates exactly as a save does, so an incomplete draft answers
   * with the save's own 400s.
   */
  evaluate: (input: AutomationEvaluateInput) => Promise<AutomationDryRunResult>;
  /** `DELETE /automations/:id`. Admin only. */
  remove: (ruleId: string) => Promise<void>;
}

export function createAutomationsApi(request: ApiRequest): AutomationsApi {
  return {
    async getVocabulary(): Promise<AutomationVocabulary> {
      return parseAutomationVocabulary(await request<unknown>('/automations/vocabulary'));
    },

    async getSummary(): Promise<ParsedAutomationSummary> {
      return parseAutomationSummary(await request<unknown>('/automations/summary'));
    },

    async listByTrigger(trigger): Promise<ParsedAutomationRules> {
      const raw = await request<unknown>(
        `/automations?trigger=${encodeURIComponent(trigger)}`,
      );
      return parseAutomationRules(raw);
    },

    async get(ruleId): Promise<AutomationRule> {
      return parseAutomationRule(
        await request<unknown>(`/automations/${encodeURIComponent(ruleId)}`),
      );
    },

    async listRuns(ruleId): Promise<AutomationRunLog | null> {
      return parseAutomationRunLog(
        await request<unknown>(`/automations/${encodeURIComponent(ruleId)}/runs`),
      );
    },

    async create(input): Promise<AutomationRule> {
      const raw = await request<unknown>('/automations', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      return parseAutomationRule(raw);
    },

    async listRunsBySubject(subjectKind, subjectId): Promise<AutomationRunLog | null> {
      const query = new URLSearchParams({ subjectKind, subjectId });
      return parseAutomationRunLog(await request<unknown>(`/automations/runs?${query.toString()}`));
    },

    async listRunFeed(filters, pagination): Promise<AutomationRunLog | null> {
      const params = new URLSearchParams();
      if (filters.ruleId) params.set('ruleId', filters.ruleId);
      if (filters.trigger) params.set('trigger', filters.trigger);
      if (filters.outcome) params.set('outcome', filters.outcome);
      if (filters.from) params.set('from', filters.from);
      if (filters.to) params.set('to', filters.to);
      if (filters.orderId) params.set('orderId', filters.orderId);
      if (filters.attentionOnly) params.set('attentionOnly', 'true');
      if (pagination?.limit !== undefined) params.set('limit', String(pagination.limit));
      if (pagination?.offset !== undefined) params.set('offset', String(pagination.offset));
      const query = params.toString();
      return parseAutomationRunLog(
        await request<unknown>(`/automations/runs${query.length > 0 ? `?${query}` : ''}`),
      );
    },

    async getAttentionCount(): Promise<number> {
      const raw = await request<unknown>('/automations/attention-count');
      const parsed = z.object({ count: z.number() }).safeParse(raw);
      // A shape we cannot read reports ZERO rather than throwing: an attention
      // count is a decoration on pages whose real content is elsewhere, and
      // failing the page over it would be worse than under-reporting a badge the
      // list itself still shows.
      return parsed.success ? parsed.data.count : 0;
    },
    async retryRun(runId): Promise<AutomationRun> {
      const run = parseAutomationRun(
        await request<unknown>(`/automations/runs/${encodeURIComponent(runId)}/retry`, {
          method: 'POST',
        }),
      );
      if (run === null) throw new Error('The automation run could not be read after running again.');
      return run;
    },
    async dismissRun(runId): Promise<AutomationRun> {
      const run = parseAutomationRun(
        await request<unknown>(`/automations/runs/${encodeURIComponent(runId)}/dismiss`, {
          method: 'POST',
        }),
      );
      if (run === null) throw new Error('The automation run could not be read after being marked handled.');
      return run;
    },
    async replace(ruleId, input): Promise<AutomationRule> {
      const raw = await request<unknown>(`/automations/${encodeURIComponent(ruleId)}`, {
        method: 'PUT',
        body: JSON.stringify(input),
      });
      return parseAutomationRule(raw);
    },

    async evaluate(input): Promise<AutomationDryRunResult> {
      const raw = await request<unknown>('/automations/evaluate', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      return parseAutomationDryRun(raw);
    },

    async remove(ruleId): Promise<void> {
      await request<unknown>(`/automations/${encodeURIComponent(ruleId)}`, {
        method: 'DELETE',
      });
    },
  };
}
