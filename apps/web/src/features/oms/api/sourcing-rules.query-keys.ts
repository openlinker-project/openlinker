/**
 * Sourcing-rule query keys (#3056)
 *
 * Every key is prefixed `['oms', 'sourcing-rules', connectionId, …]`, which is
 * what makes `byConnection(connectionId)` a valid invalidation ancestor of both
 * the list and every single-rule read on that connection.
 *
 * ## Invalidation is CONNECTION-scoped, not rule-scoped
 *
 * The ruleset's meaning is its ORDER, so almost every write moves rows the
 * mutation did not name: `PUT /order` renumbers all of them, a create inserts
 * at a position, a delete leaves a gap. A key narrower than the connection
 * would refresh the row that was written and leave its neighbours rendering
 * stale positions — i.e. an operator-visible order that is not the order the
 * router uses.
 *
 * `all` exists for a future surface that renders more than one connection's
 * rules; nothing invalidates it today, and a mutation that did would refresh
 * connections it cannot have changed.
 *
 * @module apps/web/src/features/oms/api
 */
import type { SourcingRuleFilters } from './sourcing-rules.types';

export const sourcingRulesQueryKeys = {
  all: ['oms', 'sourcing-rules'] as const,
  byConnection: (connectionId: string) => ['oms', 'sourcing-rules', connectionId] as const,
  /**
   * The rows. The filter object is part of the key, so toggling
   * `includeSuperseded` is a different query rather than a refetch of the same
   * one — and both stay under `byConnection`, so one write refreshes both.
   */
  list: (connectionId: string, filters: SourcingRuleFilters) =>
    ['oms', 'sourcing-rules', connectionId, 'list', filters] as const,
  detail: (connectionId: string, ruleId: string) =>
    ['oms', 'sourcing-rules', connectionId, 'detail', ruleId] as const,
};
