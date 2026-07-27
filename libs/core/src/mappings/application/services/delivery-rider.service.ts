/**
 * Delivery Rider Service
 *
 * Resolves the delivery-rider hint (#1792, epic #1776) for a defaulted order:
 * maps the raw source delivery method to a candidate carrier via the pure
 * {@link matchCandidateCarrier} heuristic, then reads carrier state through the
 * integrations seam — connected carriers via `listCapabilityAdapters`, and the
 * set of carriers OL *supports* from the adapter registry — to pick between
 * `unmapped` (Add mapping), `not-connected` (Connect), or `none`.
 *
 * INVARIANT: this service is a pure read-side hint. It takes NO dependency on
 * `FulfillmentRoutingService` and nothing it returns feeds back into routing —
 * the heuristic only picks which hint to render, never where a parcel goes. A
 * wrong or missing guess degrades to `none`, never to a wrong dispatch.
 *
 * @module application/services
 * @implements {IDeliveryRiderService}
 */

import { Inject, Injectable } from '@nestjs/common';
import {
  ADAPTER_REGISTRY_TOKEN,
  type AdapterRegistryPort,
  IIntegrationsService,
  INTEGRATIONS_SERVICE_TOKEN,
} from '@openlinker/core/integrations';
import type { IDeliveryRiderService } from '../interfaces/delivery-rider.service.interface';
import { matchCandidateCarrier } from '../../domain/delivery-rider-heuristic';
import type {
  CandidateCarrier,
  DeliveryRiderInput,
  DeliveryRiderResolution,
} from '../../domain/types/delivery-rider.types';

/**
 * Capability a connection/adapter must declare to be a rider-eligible carrier.
 * `ShippingProviderManager` is an open/plugin capability (#763) — not a member
 * of the closed `CoreCapability` set — so it stays a bare literal, matching the
 * InPost/DPD adapter manifests that register it.
 */
const SHIPPING_PROVIDER_MANAGER_CAPABILITY = 'ShippingProviderManager';

/**
 * Order-independent carrier state read once per batch: which carrier
 * `platformType`s have an active, capability-enabled connection, and which are
 * supported (an adapter is registered declaring the capability).
 */
interface CarrierState {
  connectedPlatformTypes: Set<string>;
  supportedPlatformTypes: Set<string>;
}

@Injectable()
export class DeliveryRiderService implements IDeliveryRiderService {
  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService,
    @Inject(ADAPTER_REGISTRY_TOKEN)
    private readonly adapterRegistry: AdapterRegistryPort,
  ) {}

  async resolve(input: DeliveryRiderInput): Promise<DeliveryRiderResolution> {
    // Disabled-carrier rule (#1799) takes precedence and needs no carrier-state
    // read — the routing rule already named the (now-disabled) carrier.
    if (input.routedProcessorDisabled) {
      return this.disabledRider(input);
    }
    const candidate = this.candidateFor(input);
    if (!candidate) {
      return { rider: 'none' };
    }
    const state = await this.loadCarrierState();
    return this.evaluate(candidate, state);
  }

  async resolveBatch(inputs: DeliveryRiderInput[]): Promise<DeliveryRiderResolution[]> {
    const candidates = inputs.map((input) => this.candidateFor(input));

    // Skip the carrier-state reads entirely unless at least one input has a
    // default-path candidate — a page of rule-resolved / no-match / disabled
    // orders costs zero integration round trips (the disabled branch is
    // resolved from the input alone).
    if (candidates.every((candidate) => candidate === null)) {
      return inputs.map((input) =>
        input.routedProcessorDisabled ? this.disabledRider(input) : { rider: 'none' },
      );
    }

    const state = await this.loadCarrierState();
    return inputs.map((input, i) => {
      if (input.routedProcessorDisabled) {
        return this.disabledRider(input);
      }
      const candidate = candidates[i];
      return candidate ? this.evaluate(candidate, state) : { rider: 'none' };
    });
  }

  /**
   * The candidate carrier for an input, or `null` when the default-path rider
   * must not fire: a non-`default` resolution, or a method that maps to no known
   * carrier. This is the only place the heuristic runs for the default path.
   */
  private candidateFor(input: DeliveryRiderInput): CandidateCarrier | null {
    if (input.resolutionSource !== 'default') {
      return null;
    }
    return matchCandidateCarrier(input.sourceDeliveryMethod);
  }

  /**
   * The `disabled` rider (#1799): a rule mapped the method to a carrier whose
   * connection is now disabled. A disabled route must never be invisible, so
   * this ALWAYS returns `{ rider: 'disabled' }`. The carrier label comes from
   * the same method-name heuristic the default path uses; when it matches we
   * enrich the rider with the `candidateCarrier`, but when it does not we still
   * surface the `disabled` rider (without a carrier name) - the operator must
   * always be told the route is a dead end, even if we can't name the carrier.
   */
  private disabledRider(input: DeliveryRiderInput): DeliveryRiderResolution {
    const candidate = matchCandidateCarrier(input.sourceDeliveryMethod);
    return candidate ? { rider: 'disabled', candidateCarrier: candidate } : { rider: 'disabled' };
  }

  /** Map a matched candidate + carrier state to the rider decision. */
  private evaluate(candidate: CandidateCarrier, state: CarrierState): DeliveryRiderResolution {
    if (state.connectedPlatformTypes.has(candidate.platformType)) {
      return { rider: 'unmapped', candidateCarrier: candidate };
    }
    if (state.supportedPlatformTypes.has(candidate.platformType)) {
      return { rider: 'not-connected', candidateCarrier: candidate };
    }
    return { rider: 'none' };
  }

  /**
   * Read the order-independent carrier state once. `connectedPlatformTypes`
   * comes from active, capability-enabled `ShippingProviderManager` connections
   * (lazy: no adapter is constructed — only `connection.platformType` is read).
   * `supportedPlatformTypes` comes from the adapter registry — the authoritative
   * "supported carrier" source (#1792), never a hardcoded list.
   */
  private async loadCarrierState(): Promise<CarrierState> {
    // "Connected" deliberately means the connection has ShippingProviderManager
    // *enabled* (listCapabilityAdapters gates on connection.enabledCapabilities,
    // not just adapter support), so a carrier-type connection that hasn't
    // enabled shipping is intentionally treated as `not-connected`, not `unmapped`.
    const connected = await this.integrations.listCapabilityAdapters<unknown>({
      capability: SHIPPING_PROVIDER_MANAGER_CAPABILITY,
      lazy: true,
    });
    const connectedPlatformTypes = new Set(
      connected.map((entry) => entry.connection.platformType),
    );

    const adapters = await this.adapterRegistry.listAdapters();
    const supportedPlatformTypes = new Set(
      adapters
        .filter((metadata) =>
          metadata.supportedCapabilities.includes(SHIPPING_PROVIDER_MANAGER_CAPABILITY),
        )
        .map((metadata) => metadata.platformType),
    );

    return { connectedPlatformTypes, supportedPlatformTypes };
  }
}
