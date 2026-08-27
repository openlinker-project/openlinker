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
import {
  parseAutomationRule,
  parseAutomationRules,
  parseAutomationRunLog,
  parseAutomationSummary,
  parseAutomationVocabulary,
  type ParsedAutomationRules,
  type ParsedAutomationSummary,
} from './automation.schema';
import type {
  AutomationRule,
  AutomationRuleWriteInput,
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
  /** `PUT /automations/:id` — a full replace. Admin only. */
  replace: (ruleId: string, input: AutomationRuleWriteInput) => Promise<AutomationRule>;
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

    async replace(ruleId, input): Promise<AutomationRule> {
      const raw = await request<unknown>(`/automations/${encodeURIComponent(ruleId)}`, {
        method: 'PUT',
        body: JSON.stringify(input),
      });
      return parseAutomationRule(raw);
    },

    async remove(ruleId): Promise<void> {
      await request<unknown>(`/automations/${encodeURIComponent(ruleId)}`, {
        method: 'DELETE',
      });
    },
  };
}
