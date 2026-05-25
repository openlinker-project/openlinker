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
import { Logger } from '@openlinker/shared/logging';
import {
  type CoreCapability,
  IIntegrationsService,
  INTEGRATIONS_SERVICE_TOKEN,
} from '@openlinker/core/integrations';
import { CONNECTION_PORT_TOKEN, type ConnectionPort } from '@openlinker/core/identifier-mapping';
import type { IFulfillmentRoutingService } from '../interfaces/fulfillment-routing.service.interface';
import { FULFILLMENT_ROUTING_REPOSITORY_TOKEN } from '../../mappings.tokens';
import { FulfillmentRoutingRepositoryPort } from '../../domain/ports/fulfillment-routing-repository.port';
import type { FulfillmentRoutingRule } from '../../domain/entities/fulfillment-routing-rule.entity';
import {
  type CandidateProcessor,
  FULFILLMENT_PROCESSOR_KIND,
  FulfillmentProcessorKindValues,
  type FulfillmentProcessorKind,
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
  private readonly logger = new Logger(FulfillmentRoutingService.name);

  constructor(
    @Inject(FULFILLMENT_ROUTING_REPOSITORY_TOKEN)
    private readonly repository: FulfillmentRoutingRepositoryPort,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService,
    @Inject(CONNECTION_PORT_TOKEN)
    private readonly connectionPort: ConnectionPort,
  ) {}

  async getRules(sourceConnectionId: string): Promise<FulfillmentRoutingRule[]> {
    return this.repository.findBySourceConnectionId(sourceConnectionId);
  }

  async getCandidateProcessors(sourceConnectionId: string): Promise<CandidateProcessor[]> {
    // Validates the source exists + is active (throws ConnectionNotFound /
    // ConnectionDisabled, mapped to 404/400 at the HTTP boundary).
    await this.integrations.getAdapter(sourceConnectionId);

    // Metadata-only enumeration: `getAdapter` is a metadata-only lookup (no
    // adapter instance is constructed), so listing candidates can't fail on a
    // connection whose adapter wouldn't construct (e.g. missing credentials).
    const connections = await this.connectionPort.list({ status: 'active' });

    const candidates: CandidateProcessor[] = [];
    for (const connection of connections) {
      // A connection whose adapter metadata can't be resolved (e.g. its plugin
      // was removed, leaving a stale adapterKey) is simply not an offerable
      // processor — skip it rather than blanking the whole candidate list.
      let capabilities: readonly string[];
      try {
        const { metadata } = await this.integrations.getAdapter(connection.id);
        capabilities = metadata.supportedCapabilities;
      } catch (error) {
        this.logger.debug(
          `Skipping connection ${connection.id} in candidate enumeration: ` +
            `adapter metadata unresolved (${(error as Error).message})`,
        );
        continue;
      }
      for (const processorKind of FulfillmentProcessorKindValues) {
        if (
          this.evaluateCompatibility(processorKind, sourceConnectionId, connection.id, capabilities)
            .compatible
        ) {
          candidates.push({ processorKind, processorConnectionId: connection.id });
        }
      }
    }
    return candidates;
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
   * Capability + topology compatibility for a single rule (write path).
   * Resolves the processor connection's adapter metadata (`getAdapter` throws
   * `ConnectionNotFoundException` / `ConnectionDisabledException` for an
   * invalid processor connection — those propagate unchanged) and delegates
   * the decision to the shared `evaluateCompatibility` predicate.
   */
  private async assertCompatible(
    sourceConnectionId: string,
    item: FulfillmentRoutingRuleInput,
  ): Promise<void> {
    const { processorKind, processorConnectionId } = item;
    const { metadata } = await this.integrations.getAdapter(processorConnectionId);
    const { compatible, reason } = this.evaluateCompatibility(
      processorKind,
      sourceConnectionId,
      processorConnectionId,
      metadata.supportedCapabilities,
    );
    if (!compatible) {
      throw new IncompatibleProcessorException(processorConnectionId, processorKind, reason);
    }
  }

  /**
   * Pure per-kind capability + topology predicate — the **single source of
   * truth** shared by `assertCompatible` (write-path validation) and
   * `getCandidateProcessors` (read-path offer-set). Keeping both paths on one
   * predicate guarantees the routing-config UI never offers a processor that
   * `replaceRules` would reject, nor hides one it would accept (#836).
   */
  private evaluateCompatibility(
    processorKind: FulfillmentProcessorKind,
    sourceConnectionId: string,
    processorConnectionId: string,
    capabilities: readonly string[],
  ): { compatible: boolean; reason: string } {
    switch (processorKind) {
      case FULFILLMENT_PROCESSOR_KIND.OmpFulfilled:
        return capabilities.includes(ORDER_PROCESSOR_MANAGER_CAPABILITY)
          ? { compatible: true, reason: '' }
          : {
              compatible: false,
              reason: `does not declare the ${ORDER_PROCESSOR_MANAGER_CAPABILITY} capability`,
            };

      case FULFILLMENT_PROCESSOR_KIND.OlManagedCarrier:
        if (!capabilities.includes(SHIPPING_PROVIDER_MANAGER_CAPABILITY)) {
          return {
            compatible: false,
            reason: `does not declare the ${SHIPPING_PROVIDER_MANAGER_CAPABILITY} capability`,
          };
        }
        if (processorConnectionId === sourceConnectionId) {
          return {
            compatible: false,
            reason: 'an OL-managed carrier must be a connection distinct from the order source',
          };
        }
        return { compatible: true, reason: '' };

      case FULFILLMENT_PROCESSOR_KIND.SourceBrokered:
        if (!capabilities.includes(SHIPPING_PROVIDER_MANAGER_CAPABILITY)) {
          return {
            compatible: false,
            reason: `does not declare the ${SHIPPING_PROVIDER_MANAGER_CAPABILITY} capability`,
          };
        }
        if (processorConnectionId !== sourceConnectionId) {
          return {
            compatible: false,
            reason: 'a source-brokered processor must be the order source connection itself',
          };
        }
        return { compatible: true, reason: '' };

      default: {
        // Exhaustiveness guard: a new FulfillmentProcessorKind added without a
        // matching compatibility rule must fail loud, never pass unvalidated.
        const exhaustive: never = processorKind;
        return {
          compatible: false,
          reason: `unknown processor kind '${String(exhaustive)}' has no compatibility rule`,
        };
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
