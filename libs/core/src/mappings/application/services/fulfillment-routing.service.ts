/**
 * Fulfillment Routing Service
 *
 * Owns the general fulfillment-routing model (#832, epic #732): read/replace
 * connection-scoped routing rules and resolve a routing decision for an order.
 *
 * `replaceRules` validates each rule's processor for **capability + topology**
 * compatibility (ADR-012) — it does NOT check method-granular eligibility
 * (the OQ-B1 `/shipment-management/delivery-services` question), which is a
 * #833 refinement layered behind this same seam. `resolve` falls back to the
 * `omp_fulfilled` default (today's PrestaShop-fulfilled behaviour) when no
 * rule matches, preserving no-regression.
 *
 * @module application/services
 * @implements {IFulfillmentRoutingService}
 */

import { Inject, Injectable } from '@nestjs/common';
import {
  type CoreCapability,
  IIntegrationsService,
  INTEGRATIONS_SERVICE_TOKEN,
} from '@openlinker/core/integrations';
import type { IFulfillmentRoutingService } from '../interfaces/fulfillment-routing.service.interface';
import { FULFILLMENT_ROUTING_REPOSITORY_TOKEN } from '../../mappings.tokens';
import { FulfillmentRoutingRepositoryPort } from '../../domain/ports/fulfillment-routing-repository.port';
import type { FulfillmentRoutingRule } from '../../domain/entities/fulfillment-routing-rule.entity';
import {
  FULFILLMENT_PROCESSOR_KIND,
  type FulfillmentRoutingQuery,
  type FulfillmentRoutingResolution,
  type FulfillmentRoutingRuleInput,
} from '../../domain/types/fulfillment-routing.types';
import { IncompatibleProcessorException } from '../../domain/exceptions/incompatible-processor.exception';
import { DuplicateRoutingRuleException } from '../../domain/exceptions/duplicate-routing-rule.exception';

/**
 * Capability a connection must declare to be an `omp_fulfilled` processor.
 * Typed as `CoreCapability` so a rename in the closed capability set fails at
 * compile time here.
 */
const ORDER_PROCESSOR_MANAGER_CAPABILITY: CoreCapability = 'OrderProcessorManager';
/**
 * Capability a connection must declare to be a label-generating processor.
 * `ShippingProviderManager` is an open/plugin capability (#763) — not a member
 * of the closed `CoreCapability` set — so it stays a bare literal here, matching
 * the InPost adapter manifest that registers it.
 */
const SHIPPING_PROVIDER_MANAGER_CAPABILITY = 'ShippingProviderManager';

@Injectable()
export class FulfillmentRoutingService implements IFulfillmentRoutingService {
  constructor(
    @Inject(FULFILLMENT_ROUTING_REPOSITORY_TOKEN)
    private readonly repository: FulfillmentRoutingRepositoryPort,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService,
  ) {}

  async getRules(sourceConnectionId: string): Promise<FulfillmentRoutingRule[]> {
    return this.repository.findBySourceConnectionId(sourceConnectionId);
  }

  async replaceRules(
    sourceConnectionId: string,
    items: FulfillmentRoutingRuleInput[],
  ): Promise<FulfillmentRoutingRule[]> {
    // Validate the whole batch before writing any — a single bad rule rejects
    // the entire replace (the repository's delete+insert is atomic). Validating
    // here keeps the `(source, method)` unique constraint and the connection FKs
    // from surfacing as raw QueryFailedErrors.
    this.assertNoDuplicateMethods(items);
    // The source must resolve to a known connection; getAdapter throws
    // ConnectionNotFoundException / ConnectionDisabledException otherwise.
    await this.integrations.getAdapter(sourceConnectionId);
    for (const item of items) {
      await this.assertCompatible(sourceConnectionId, item);
    }
    return this.repository.replaceForConnection(sourceConnectionId, items);
  }

  async resolve(query: FulfillmentRoutingQuery): Promise<FulfillmentRoutingResolution> {
    const { sourceConnectionId, sourceDeliveryMethodId } = query;

    if (sourceDeliveryMethodId) {
      const rule = await this.repository.findRule(sourceConnectionId, sourceDeliveryMethodId);
      if (rule) {
        return {
          processorKind: rule.processorKind,
          processorConnectionId: rule.processorConnectionId,
          source: 'rule',
        };
      }
    }

    // No rule (or no method): today's PrestaShop-fulfilled default. Under
    // fan-out there is no single fulfilling OMP, so processorConnectionId is null.
    return {
      processorKind: FULFILLMENT_PROCESSOR_KIND.OmpFulfilled,
      processorConnectionId: null,
      source: 'default',
    };
  }

  /**
   * Capability + topology compatibility for a single rule. `getAdapter`
   * resolves the connection's adapter metadata and throws
   * `ConnectionNotFoundException` / `ConnectionDisabledException` for an
   * invalid processor connection — those propagate unchanged.
   */
  private async assertCompatible(
    sourceConnectionId: string,
    item: FulfillmentRoutingRuleInput,
  ): Promise<void> {
    const { processorKind, processorConnectionId } = item;
    const { metadata } = await this.integrations.getAdapter(processorConnectionId);
    const capabilities = metadata.supportedCapabilities;

    switch (processorKind) {
      case FULFILLMENT_PROCESSOR_KIND.OmpFulfilled:
        if (!capabilities.includes(ORDER_PROCESSOR_MANAGER_CAPABILITY)) {
          throw new IncompatibleProcessorException(
            processorConnectionId,
            processorKind,
            `does not declare the ${ORDER_PROCESSOR_MANAGER_CAPABILITY} capability`,
          );
        }
        return;

      case FULFILLMENT_PROCESSOR_KIND.OlManagedCarrier:
        if (!capabilities.includes(SHIPPING_PROVIDER_MANAGER_CAPABILITY)) {
          throw new IncompatibleProcessorException(
            processorConnectionId,
            processorKind,
            `does not declare the ${SHIPPING_PROVIDER_MANAGER_CAPABILITY} capability`,
          );
        }
        if (processorConnectionId === sourceConnectionId) {
          throw new IncompatibleProcessorException(
            processorConnectionId,
            processorKind,
            'an OL-managed carrier must be a connection distinct from the order source',
          );
        }
        return;

      case FULFILLMENT_PROCESSOR_KIND.SourceBrokered:
        if (!capabilities.includes(SHIPPING_PROVIDER_MANAGER_CAPABILITY)) {
          throw new IncompatibleProcessorException(
            processorConnectionId,
            processorKind,
            `does not declare the ${SHIPPING_PROVIDER_MANAGER_CAPABILITY} capability`,
          );
        }
        if (processorConnectionId !== sourceConnectionId) {
          throw new IncompatibleProcessorException(
            processorConnectionId,
            processorKind,
            'a source-brokered processor must be the order source connection itself',
          );
        }
        return;

      default: {
        // Exhaustiveness guard: a new FulfillmentProcessorKind added without a
        // matching compatibility rule must fail loud, never pass unvalidated.
        const exhaustive: never = processorKind;
        throw new IncompatibleProcessorException(
          processorConnectionId,
          String(exhaustive),
          'unknown processor kind has no compatibility rule',
        );
      }
    }
  }

  /**
   * Reject a replace batch that maps the same `sourceDeliveryMethodId` to more
   * than one processor — the persisted shape is one rule per `(source, method)`.
   */
  private assertNoDuplicateMethods(items: FulfillmentRoutingRuleInput[]): void {
    const seen = new Set<string>();
    for (const { sourceDeliveryMethodId } of items) {
      if (seen.has(sourceDeliveryMethodId)) {
        throw new DuplicateRoutingRuleException(sourceDeliveryMethodId);
      }
      seen.add(sourceDeliveryMethodId);
    }
  }
}
