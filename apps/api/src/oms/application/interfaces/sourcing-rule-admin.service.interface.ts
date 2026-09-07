/**
 * Sourcing Rule Admin Service Interface
 *
 * The API-layer contract for authoring the OL router's ordered ruleset (#2953).
 * The service validates what `libs/oms` structurally cannot — that the target
 * connection exists and is an OMS connection, and that every referenced location
 * is real — then delegates to `RoutingRuleAdminPort`.
 *
 * @module apps/api/src/oms/application/interfaces
 * @see {@link SourcingRuleAdminService} for the implementation
 */
import type {
  CreateRoutingRuleInput,
  RoutingRuleRecord,
  UpdateRoutingRuleInput,
} from '@openlinker/oms';

export const SOURCING_RULE_ADMIN_SERVICE_TOKEN = Symbol('ISourcingRuleAdminService');

/** Create input minus `connectionId`, which the route supplies. */
export type CreateSourcingRuleRequest = Omit<CreateRoutingRuleInput, 'connectionId'>;

export type UpdateSourcingRuleRequest = UpdateRoutingRuleInput;

export interface ISourcingRuleAdminService {
  /**
   * The connection's rules in evaluation order. Retired rows (`effectiveTo <=
   * now`) are excluded unless `includeSuperseded` — note that a row retiring in
   * the FUTURE is still returned, because the router is still evaluating it.
   */
  listRules(
    connectionId: string,
    includeSuperseded?: boolean
  ): Promise<readonly RoutingRuleRecord[]>;

  /** Raises `RoutingRuleNotFoundError` rather than returning null — the route answers 404. */
  getRule(connectionId: string, ruleId: string): Promise<RoutingRuleRecord>;

  createRule(
    connectionId: string,
    input: CreateSourcingRuleRequest
  ): Promise<RoutingRuleRecord>;

  updateRule(
    connectionId: string,
    ruleId: string,
    patch: UpdateSourcingRuleRequest
  ): Promise<RoutingRuleRecord>;

  deleteRule(connectionId: string, ruleId: string): Promise<void>;

  /** Exhaustive over the connection's non-retired rules; renumbers to a dense `1..N`. */
  reorderRules(
    connectionId: string,
    orderedRuleIds: readonly string[]
  ): Promise<readonly RoutingRuleRecord[]>;
}
