/**
 * The OMS fulfilment-router resolver — the one body behind `FulfillmentRouterResolverPort` (#2408)
 *
 * Answers *"is there a fulfilment router for this connection?"* for the whole
 * installation. Both production call sites — #2396's ingestion intercept and the
 * `fulfillment.work.route` handler — reach this through the port, so they cannot
 * disagree about whether a router exists. Two answers to that question is a
 * double shipment; see the port's own header.
 *
 * ## Why the platform check, and why `platformType`
 *
 * Authority A2 is `config-only` (#2403), so **any** connection may claim
 * `sourcingAuthority` — #2407 gates that claim on having an active location, not
 * on the connection being an OMS one. Building `OlFulfillmentRouter` for a
 * third party's connection would then read *their* connection id as the ruleset
 * scope, find no rules, and report every line unfulfillable — which
 * `RoutingCommitService` refuses as `plan-carries-unfulfillable`, i.e. a
 * configuration mistake wearing the costume of a routing bug.
 *
 * The discriminator is `platformType`, not `adapterKey`: an `openlinker.oms.v2`
 * adapter would leave every existing connection pinned to `v1`, so an
 * `adapterKey` check would silently stop resolving for them on the day that
 * ships. And it is not the A2 claim alone, for the reason just given.
 *
 * ## The three `null` causes are told apart, on purpose
 *
 * Both call sites used to emit one `log`-level line reading "no router is
 * wired", which covered a deliberately router-less install, a non-OMS connection
 * claiming A2, and a connection that could not be read. Only the first is
 * routine. The other two are operator-fixable misconfigurations that would
 * otherwise be invisible — an operator who enables sourcing authority on a
 * PrestaShop connection gets total silence — so they warn HERE, where the cause
 * is known, rather than at a call site that only sees `null`.
 *
 * @module libs/oms/src/routing
 * @see docs/architecture/adrs/055-oms-as-credentialless-connection-plugin.md
 */
import type {
  FulfillmentRouterPort,
  FulfillmentRouterResolverPort,
  IFulfillmentWorkQueryService,
} from '@openlinker/core/fulfillment';
import type { ConnectionPort } from '@openlinker/core/identifier-mapping';
import type { IInventoryQueryService, ILocationService } from '@openlinker/core/inventory';
import { Logger } from '@openlinker/shared/logging';

import { OMS_PLATFORM_TYPE } from '../oms.constants';
import { createOlFulfillmentRouter } from './ol-fulfillment-router';
import type { RoutingRuleSourcePort } from './routing-rule-source.port';

export interface OmsFulfillmentRouterResolverDeps {
  readonly connections: ConnectionPort;
  readonly rules: RoutingRuleSourcePort;
  readonly locations: ILocationService;
  readonly inventory: IInventoryQueryService;
  readonly works: IFulfillmentWorkQueryService;
  /** Injected so the pipeline stays a pure function of its inputs, clock included. */
  readonly now?: () => Date;
}

export function createOmsFulfillmentRouterResolver(
  deps: OmsFulfillmentRouterResolverDeps
): FulfillmentRouterResolverPort {
  const logger = new Logger('OmsFulfillmentRouterResolver');

  return {
    async resolve(connectionId: string): Promise<FulfillmentRouterPort | null> {
      let platformType: string;

      try {
        platformType = (await deps.connections.get(connectionId)).platformType;
      } catch (error) {
        // Degrade to today's path rather than failing ingestion — but loudly.
        // A connection that claims A2 and cannot be read is a real fault, and
        // the order it silently un-routes is invisible everywhere else.
        logger.warn(
          `Could not read connection ${connectionId} while resolving a fulfilment router; ` +
            `the order follows today's path unrouted. ` +
            `${error instanceof Error ? error.message : String(error)}`
        );
        return null;
      }

      if (platformType !== OMS_PLATFORM_TYPE) {
        logger.warn(
          `Connection ${connectionId} claims fulfilment sourcing authority (A2) but its ` +
            `platformType is '${platformType}', not '${OMS_PLATFORM_TYPE}'. OpenLinker has no ` +
            `router for it, so nothing is routed. Either enable the OMS connection instead, or ` +
            `clear \`config.sourcingAuthority\` on this one.`
        );
        return null;
      }

      return createOlFulfillmentRouter({
        connectionId,
        rules: deps.rules,
        locations: deps.locations,
        inventory: deps.inventory,
        works: deps.works,
        now: deps.now,
      });
    },
  };
}
