/**
 * Sourcing Rule Admin Service (#2953)
 *
 * The API-layer composition over `RoutingRuleAdminPort`. It exists because the
 * three validations below need `IConnectionService` and `ILocationService`, and
 * `libs/oms` reaching for a host application service would invert the direction
 * the plugin descriptor establishes (core services are handed to
 * `createOmsPlugin` as a factory closure, never pulled). This is the shipped
 * `SalesDocumentCapabilityGuardService` shape (#2170): the connection check
 * happens HERE, before delegating to the owning package's port.
 *
 * ## The vocabulary check round-trips through `coerceRoutingRule`
 *
 * A per-field `@IsIn` cannot express the kind-to-name pairing: `{kind: 'filter',
 * name: 'nearest'}` satisfies "a member of the filter names OR the sort names"
 * and is rejected by the coercer, so it would persist a row that saves happily
 * and never routes. Building the candidate and narrowing it with the SAME
 * function the read path uses makes "authorable" and "routable" impossible to
 * diverge — a new vocabulary member is accepted here the moment the coercer
 * accepts it, and never before.
 *
 * A PATCH is validated as the MERGED row, which has two consequences worth
 * knowing: an unrecognised row cannot be patched at all (its remedy is DELETE),
 * and a `name` moved to the wrong kind's vocabulary is refused rather than
 * persisted.
 *
 * @module apps/api/src/oms/application/services
 */
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { LOCATION_SERVICE_TOKEN, type ILocationService } from '@openlinker/core/inventory';
import { Logger } from '@openlinker/shared/logging';
import {
  coerceRoutingRule,
  OMS_PLATFORM_TYPE,
  ROUTING_RULE_ADMIN_TOKEN,
  RoutingRuleNotFoundError,
  type RoutingRuleAdminPort,
  type RoutingRuleRecord,
  type RoutingSortName,
} from '@openlinker/oms';

import {
  CONNECTION_SERVICE_TOKEN,
  type IConnectionService,
} from '../../../integrations/application/interfaces/connection.service.interface';
import type {
  CreateSourcingRuleRequest,
  ISourcingRuleAdminService,
  UpdateSourcingRuleRequest,
} from '../interfaces/sourcing-rule-admin.service.interface';

/**
 * The one sort that reads `priorityLocationIds`; every other rule must leave it
 * empty. Typed as `RoutingSortName` so a rename of that vocabulary member is a
 * compile error here rather than a guard that silently stops matching.
 */
const PRIORITY_SORT_NAME: RoutingSortName = 'priority';

@Injectable()
export class SourcingRuleAdminService implements ISourcingRuleAdminService {
  private readonly logger = new Logger(SourcingRuleAdminService.name);

  constructor(
    @Inject(ROUTING_RULE_ADMIN_TOKEN)
    private readonly rules: RoutingRuleAdminPort,
    @Inject(CONNECTION_SERVICE_TOKEN)
    private readonly connections: IConnectionService,
    @Inject(LOCATION_SERVICE_TOKEN)
    private readonly locations: ILocationService
  ) {}

  async listRules(
    connectionId: string,
    includeSuperseded = false
  ): Promise<readonly RoutingRuleRecord[]> {
    await this.assertOmsConnection(connectionId);
    return this.rules.listRules(connectionId, { includeSuperseded });
  }

  async getRule(connectionId: string, ruleId: string): Promise<RoutingRuleRecord> {
    await this.assertOmsConnection(connectionId);
    const rule = await this.rules.getRule(connectionId, ruleId);
    if (rule === null) {
      throw new RoutingRuleNotFoundError(connectionId, ruleId);
    }
    return rule;
  }

  async createRule(
    connectionId: string,
    input: CreateSourcingRuleRequest
  ): Promise<RoutingRuleRecord> {
    await this.assertOmsConnection(connectionId);

    const priorityLocationIds = input.priorityLocationIds ?? [];
    this.assertRoutable({
      kind: input.kind,
      name: input.name,
      afterAction: input.afterAction,
      priorityLocationIds,
    });
    this.assertEffectiveWindow(input.effectiveFrom ?? null, input.effectiveTo ?? null);
    await this.assertLocationsExist(priorityLocationIds);

    return this.rules.createRule({ ...input, connectionId, priorityLocationIds });
  }

  async updateRule(
    connectionId: string,
    ruleId: string,
    patch: UpdateSourcingRuleRequest
  ): Promise<RoutingRuleRecord> {
    const existing = await this.getRule(connectionId, ruleId);

    // Validate the row as it WILL BE, not the patch in isolation — a `name`
    // change is only legal against the row's own `kind`, which the patch does
    // not carry (kind is half the identity under the unique index).
    const merged = {
      kind: existing.kind,
      name: patch.name ?? existing.name,
      afterAction: patch.afterAction ?? existing.afterAction,
      priorityLocationIds: patch.priorityLocationIds ?? existing.priorityLocationIds,
    };
    // NOT `existing.recognised` — the flag means "the STORED row was already
    // unevaluable", so it is the negation. Getting it backwards costs nothing
    // functionally (both arms refuse) and everything diagnostically: the
    // operator is told to fix a name they cannot fix, instead of to delete.
    this.assertRoutable(merged, !existing.recognised);
    this.assertEffectiveWindow(
      patch.effectiveFrom !== undefined ? patch.effectiveFrom : existing.effectiveFrom,
      patch.effectiveTo !== undefined ? patch.effectiveTo : existing.effectiveTo
    );
    if (patch.priorityLocationIds !== undefined) {
      await this.assertLocationsExist(patch.priorityLocationIds);
    }

    return this.rules.updateRule(connectionId, ruleId, patch);
  }

  async deleteRule(connectionId: string, ruleId: string): Promise<void> {
    await this.assertOmsConnection(connectionId);
    const deleted = await this.rules.deleteRule(connectionId, ruleId);
    if (!deleted) {
      throw new RoutingRuleNotFoundError(connectionId, ruleId);
    }
  }

  async reorderRules(
    connectionId: string,
    orderedRuleIds: readonly string[]
  ): Promise<readonly RoutingRuleRecord[]> {
    await this.assertOmsConnection(connectionId);
    return this.rules.reorderRules(connectionId, orderedRuleIds);
  }

  /**
   * Refuse a connection the OL router will never build for.
   *
   * `createOmsFulfillmentRouterResolver` discriminates on `platformType`, so
   * rules authored against anything else persist rows nothing ever reads — the
   * silent-no-op shape #2407 refuses with a named remedy rather than accepting.
   * `IConnectionService.get` raises `ConnectionNotFoundException`, which the
   * global `ConnectionExceptionFilter` already maps to 404.
   */
  private async assertOmsConnection(connectionId: string): Promise<void> {
    const connection = await this.connections.get(connectionId);
    if (connection.platformType !== OMS_PLATFORM_TYPE) {
      this.logger.warn(
        `Refused sourcing-rule authoring on connection ${connectionId}: platformType is ` +
          `'${connection.platformType}', not '${OMS_PLATFORM_TYPE}'.`
      );
      throw new BadRequestException(
        `Connection '${connectionId}' is a '${connection.platformType}' connection. ` +
          `Fulfilment sourcing rules are only evaluated for the OpenLinker OMS connection, ` +
          `so rules authored here would never be read. Enable the OpenLinker OMS and author ` +
          `them on that connection instead.`
      );
    }
  }

  private assertRoutable(
    candidate: {
      kind: string;
      name: string;
      afterAction: string;
      priorityLocationIds: readonly string[];
    },
    wasAlreadyUnrecognised = false
  ): void {
    // `id` and `position` are supplied only to satisfy the coercer's shape —
    // it validates the vocabulary triple, which is all this check is about.
    const routable = coerceRoutingRule({
      id: 'validation-probe',
      position: 0,
      kind: candidate.kind,
      name: candidate.name,
      afterAction: candidate.afterAction,
      priorityLocationIds: candidate.priorityLocationIds,
    });

    if (routable === null) {
      throw new BadRequestException(
        wasAlreadyUnrecognised
          ? `This rule uses a kind/name combination this version of OpenLinker does not ` +
            `understand ('${candidate.kind}' / '${candidate.name}'), so it is not being ` +
            `evaluated and cannot be edited. Delete it and create a replacement.`
          : `'${candidate.name}' is not a valid ${candidate.kind} rule name, or ` +
            `'${candidate.afterAction}' is not a valid after-action. A rule whose kind and ` +
            `name disagree would be saved and then silently never evaluated.`
      );
    }

    // The coercer keeps `priorityLocationIds` only on a sort rule and reads it
    // only for `priority`. Anywhere else the value would persist and be read by
    // nothing, so the operator must not be able to believe they configured it.
    const readsPriorityLocations =
      routable.kind === 'sort' && routable.name === PRIORITY_SORT_NAME;
    if (!readsPriorityLocations && candidate.priorityLocationIds.length > 0) {
      throw new BadRequestException(
        `priorityLocationIds is only read by the '${PRIORITY_SORT_NAME}' sort. ` +
          `A '${candidate.name}' rule ignores it, so it must be left empty.`
      );
    }
  }

  private assertEffectiveWindow(from: Date | null, to: Date | null): void {
    if (from !== null && to !== null && to.getTime() <= from.getTime()) {
      throw new BadRequestException(
        'effectiveTo must be after effectiveFrom — a rule whose window closes before it opens ' +
          'is never evaluated.'
      );
    }
  }

  /**
   * A `priority` sort naming a location that does not exist ranks nothing for
   * that entry, silently. Checked at authoring time, where there is an operator
   * to tell; a location deleted AFTERWARDS is not closed here and is a
   * documented limitation.
   */
  private async assertLocationsExist(locationIds: readonly string[]): Promise<void> {
    if (locationIds.length === 0) {
      return;
    }

    const unique = [...new Set(locationIds)];
    const resolved = await Promise.all(unique.map((id) => this.locations.getLocation(id)));
    const unknown = unique.filter((_, index) => resolved[index] === null);

    if (unknown.length > 0) {
      throw new BadRequestException(
        `No inventory location exists for: ${unknown.join(', ')}. ` +
          `A priority sort naming an unknown location ranks nothing for that entry.`
      );
    }
  }
}
