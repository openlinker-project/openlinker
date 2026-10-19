/**
 * Routing Dry-Run Service (#2954)
 *
 * Gives `FulfillmentRouterPort.evaluate()` its first caller. It calls
 * `evaluate()` - never `route()` - so no routing decision, work row, hold or
 * idempotency key can come out of it: `RoutingEvaluation` carries no
 * `decisionId` and `evaluate` takes no options. The router is reached through
 * the same resolver the live paths use, so the dry run and the real routing are
 * the same engine over the same facts (stock, locations, rejections).
 *
 * ## Draft rules
 *
 * A draft is validated through `coerceRoutingRule` - the function saved rules
 * pass through - so a draft that could not be saved cannot be evaluated either.
 * It reaches the router only through the guard-only `DraftRuleEvaluator`
 * sub-capability, which `route()` has no counterpart of.
 *
 * ## What is told to the router
 *
 * ADR-062's allowlist, built by the same `projectOrderForRouting` the live
 * paths use. A basket accepts only country, postcode, lines and delivery
 * method, so there is nowhere to put buyer data.
 *
 * @module apps/api/src/oms/application/services
 */
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  buildRoutingShipTo,
  FULFILLMENT_ROUTER_RESOLVER_TOKEN,
  type FulfillmentRouterResolverPort,
  type RoutingInput,
} from '@openlinker/core/fulfillment';
import {
  ORDER_RECORD_SERVICE_TOKEN,
  OrderSnapshotUnavailableError,
  orderFromReadySnapshot,
  projectOrderForRouting,
  type IOrderRecordService,
} from '@openlinker/core/orders';
import { getEnvBoolean } from '@openlinker/shared/config';
import {
  coerceRoutingRule,
  diffRoutingEvaluations,
  isDraftRuleEvaluator,
  OMS_PLATFORM_TYPE,
  type RoutingRule,
} from '@openlinker/oms';

import {
  CONNECTION_SERVICE_TOKEN,
  type IConnectionService,
} from '../../../integrations/application/interfaces/connection.service.interface';
import type {
  DraftRuleInput,
  DryRunRequest,
  DryRunResult,
  IRoutingDryRunService,
} from '../interfaces/routing-dry-run.service.interface';

/** Stands in for an order id when the subject is a basket: it has no works or rejections. */
const BASKET_ORDER_ID = 'dry-run:basket';

@Injectable()
export class RoutingDryRunService implements IRoutingDryRunService {
  constructor(
    @Inject(CONNECTION_SERVICE_TOKEN)
    private readonly connections: IConnectionService,
    @Inject(FULFILLMENT_ROUTER_RESOLVER_TOKEN)
    private readonly routers: FulfillmentRouterResolverPort,
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecords: IOrderRecordService
  ) {}

  async dryRun(connectionId: string, request: DryRunRequest): Promise<DryRunResult> {
    await this.assertOmsConnection(connectionId);

    const draftRules =
      request.draftRules === undefined ? undefined : this.coerceDraft(request.draftRules);

    const router = await this.routers.resolve(connectionId);
    if (router === null) {
      throw new BadRequestException(
        `OpenLinker has no fulfilment router for connection '${connectionId}', so there is ` +
          `nothing to test. Check that the connection is the OpenLinker OMS and is active.`
      );
    }

    const input = await this.buildInput(request);

    // `evaluate`, never `route`: the contract-level guarantee that nothing is committed.
    if (draftRules === undefined) {
      return { input: this.describeInput(input), saved: await router.evaluate(input) };
    }

    if (!isDraftRuleEvaluator(router)) {
      throw new BadRequestException(
        'This router cannot evaluate an unsaved ruleset, so the draft cannot be compared.'
      );
    }

    // Both results come from ONE snapshot of the facts: two separate reads could
    // differ in stock alone and report a rule change that never happened.
    const { saved, draft } = await router.evaluateAgainstDraft(input, draftRules);
    return {
      input: this.describeInput(input),
      saved,
      draft,
      changedLines: diffRoutingEvaluations(saved, draft),
    };
  }

  private async assertOmsConnection(connectionId: string): Promise<void> {
    // `get` raises ConnectionNotFoundException, which the global filter maps to 404.
    const connection = await this.connections.get(connectionId);
    if (connection.platformType !== OMS_PLATFORM_TYPE) {
      throw new BadRequestException(
        `Connection '${connectionId}' is a '${connection.platformType}' connection. ` +
          `Only the OpenLinker OMS connection has a fulfilment router to test.`
      );
    }
  }

  private coerceDraft(draft: readonly DraftRuleInput[]): readonly RoutingRule[] {
    const rules: RoutingRule[] = [];
    const invalid: string[] = [];

    // An explanation cites a rule by id, so two drafts sharing one would make it
    // ambiguous which of them eliminated a location.
    const ids = draft.map((candidate) => candidate.id);
    const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
    if (duplicates.length > 0) {
      throw new BadRequestException({
        message: 'Draft rule ids must be unique.',
        duplicateRuleIds: duplicates,
      });
    }

    for (const candidate of draft) {
      const rule = coerceRoutingRule(candidate);
      if (rule === null) {
        invalid.push(candidate.id);
      } else {
        rules.push(rule);
      }
    }

    if (invalid.length > 0) {
      throw new BadRequestException({
        message:
          'The draft contains rules the router cannot evaluate, so it could not be saved either.',
        invalidRuleIds: invalid,
      });
    }

    // Same ordering the router applies to saved rules: by position, ties by id.
    return [...rules].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  }

  private async buildInput(request: DryRunRequest): Promise<RoutingInput> {
    const { subject } = request;
    const storePii = getEnvBoolean('OL_STORE_PII', true);

    if (subject.basket !== undefined) {
      const { basket } = subject;
      return {
        orderId: BASKET_ORDER_ID,
        lines: basket.lines.map((line, index) => ({
          orderLineId: `basket-line-${index + 1}`,
          productVariantId: line.productVariantId,
          quantity: line.quantity,
        })),
        shipTo: buildRoutingShipTo(
          { countryIso2: basket.countryIso2, postalCode: basket.postalCode ?? null },
          { storePii }
        ),
        requestedDeliveryMethod: basket.deliveryMethod ?? null,
      };
    }

    const orderId = subject.orderId;
    if (orderId === undefined) {
      throw new BadRequestException('Provide either an orderId or a basket.');
    }

    const record = await this.orderRecords.getOrderRecord(orderId);
    if (record === null) {
      throw new NotFoundException(`Order '${orderId}' was not found.`);
    }

    let projection;
    try {
      // `requireBuyer: false`: a routing projection names nobody.
      projection = projectOrderForRouting(
        orderFromReadySnapshot(record, { requireBuyer: false }),
        record.shippingAddressHash,
        storePii
      );
    } catch (error) {
      if (error instanceof OrderSnapshotUnavailableError) {
        throw new BadRequestException(
          `Order '${orderId}' has not been fully ingested yet, so it cannot be tested.`
        );
      }
      throw error;
    }

    if (projection === null) {
      throw new BadRequestException(
        `Order '${orderId}' has no shipping address, so there is nowhere to route it.`
      );
    }

    return { orderId, ...projection };
  }

  private describeInput(input: RoutingInput): DryRunResult['input'] {
    return {
      lines: input.lines,
      shipTo: input.shipTo,
      requestedDeliveryMethod: input.requestedDeliveryMethod,
    };
  }
}
