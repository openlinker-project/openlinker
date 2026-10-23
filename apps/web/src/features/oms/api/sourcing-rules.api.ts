/**
 * Sourcing-rule API client (#3056)
 *
 * Thin typed access to the six #2953 routes. Every response is parsed through
 * the boundary schema.
 *
 * ## Only DEFINED params are emitted
 *
 * `URLSearchParams` stringifies `undefined` to the literal `"undefined"`, which
 * `ListSourcingRulesQueryDto` would then try to validate. An absent filter must
 * be an absent param — and because that DTO coerces `'true'`/`'1'` only,
 * `includeSuperseded: false` is sent explicitly rather than omitted, so the
 * emitted URL states what was asked for instead of relying on a default.
 *
 * ## Every path segment is `encodeURIComponent`-ed
 *
 * A rule id is server-minted, but a `connectionId` reaches this client from a
 * route param, i.e. from the address bar.
 *
 * ## `remove` resolves to `void`
 *
 * `DELETE` answers 204 with no body. The shared `request` helper returns
 * whatever `readResponseBody` produced, so there is nothing to parse and
 * nothing to return; a caller that wanted the deleted row would be reading a
 * body the API does not send.
 *
 * @module apps/web/src/features/oms/api
 */
import { parseSourcingRule, parseSourcingRuleList } from './sourcing-rules.schema';
import type {
  CreateSourcingRuleRequest,
  ReorderSourcingRulesRequest,
  SourcingRule,
  SourcingRuleFilters,
  UpdateSourcingRuleRequest,
} from './sourcing-rules.types';

export interface SourcingRulesApi {
  /** The connection's rules, in evaluation order. */
  list: (connectionId: string, filters?: SourcingRuleFilters) => Promise<SourcingRule[]>;
  /** One rule by id. A rule on ANOTHER connection answers 404, never 403. */
  get: (connectionId: string, ruleId: string) => Promise<SourcingRule>;
  create: (connectionId: string, body: CreateSourcingRuleRequest) => Promise<SourcingRule>;
  /** Patch. `kind` is not patchable — changing it is delete-and-recreate. */
  update: (
    connectionId: string,
    ruleId: string,
    body: UpdateSourcingRuleRequest
  ) => Promise<SourcingRule>;
  /**
   * Renumber every non-retired rule to a dense `1..N`. EXHAUSTIVE: a body
   * naming a subset answers 409 and writes nothing.
   */
  reorder: (
    connectionId: string,
    body: ReorderSourcingRulesRequest
  ) => Promise<SourcingRule[]>;
  /**
   * HARD delete, including history. To retire a rule while keeping the record,
   * PATCH `effectiveTo` instead.
   */
  remove: (connectionId: string, ruleId: string) => Promise<void>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

/** `/connections/:id/sourcing-rules` plus only the params that are actually set. */
export function buildSourcingRulesPath(
  connectionId: string,
  filters: SourcingRuleFilters = {}
): string {
  const base = `/connections/${encodeURIComponent(connectionId)}/sourcing-rules`;
  const params = new URLSearchParams();
  if (filters.includeSuperseded !== undefined) {
    params.set('includeSuperseded', String(filters.includeSuperseded));
  }
  const query = params.toString();
  return query.length > 0 ? `${base}?${query}` : base;
}

function rulePath(connectionId: string, ruleId: string): string {
  return `/connections/${encodeURIComponent(connectionId)}/sourcing-rules/${encodeURIComponent(ruleId)}`;
}

export function createSourcingRulesApi(request: ApiRequest): SourcingRulesApi {
  return {
    async list(connectionId, filters = {}): Promise<SourcingRule[]> {
      const payload = await request<unknown>(buildSourcingRulesPath(connectionId, filters));
      return parseSourcingRuleList(payload);
    },
    async get(connectionId, ruleId): Promise<SourcingRule> {
      const payload = await request<unknown>(rulePath(connectionId, ruleId));
      return parseSourcingRule(payload);
    },
    async create(connectionId, body): Promise<SourcingRule> {
      const payload = await request<unknown>(buildSourcingRulesPath(connectionId), {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return parseSourcingRule(payload);
    },
    async update(connectionId, ruleId, body): Promise<SourcingRule> {
      const payload = await request<unknown>(rulePath(connectionId, ruleId), {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      return parseSourcingRule(payload);
    },
    async reorder(connectionId, body): Promise<SourcingRule[]> {
      const payload = await request<unknown>(
        `${buildSourcingRulesPath(connectionId)}/order`,
        { method: 'PUT', body: JSON.stringify(body) }
      );
      return parseSourcingRuleList(payload);
    },
    async remove(connectionId, ruleId): Promise<void> {
      await request<unknown>(rulePath(connectionId, ruleId), { method: 'DELETE' });
    },
  };
}
