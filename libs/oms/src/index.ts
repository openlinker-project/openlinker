/**
 * `@openlinker/oms` — public barrel
 *
 * OpenLinker's own OMS, shipped as a first-party product package beside
 * `libs/core` (ADR-055, DESIGN §9). Deliberately **not** under
 * `libs/integrations/`: every `integrations-*` package integrates an
 * external system, so that prefix would read as "an adapter to somebody
 * else's OMS" and collide with future third-party OMS adapters
 * (`integrations-fluent`, `integrations-linnworks`), while this package
 * *is* the OMS.
 *
 * **Barrel-only.** The package `exports` map publishes this entry point
 * and nothing else, matching the `libs/core` discipline (#591): a deep
 * path fails at Node runtime with `ERR_PACKAGE_PATH_NOT_EXPORTED`. The
 * `@openlinker/oms/*` mapper entries in the jest integration configs are
 * a sanctioned test-only exception and are not a public subpath.
 *
 * **No HTTP, no credentials.** The OL-OMS answers from OpenLinker's own
 * tables rather than a vendor API, so there is no network boundary to
 * adapt across; adding one would put an HTTP hop on the ATP publish hot
 * path for an in-process consumer (DESIGN §9). That is enforced, not
 * merely intended, by two COMPLEMENTARY guards — neither of which subsumes
 * the other. `libs/oms` is in `scripts/check-outbound-http.mjs`'s
 * `SCAN_ROOTS` and in the bare-`fetch` ESLint ban, which catch a bare
 * `fetch(` in source text; and `__tests__/no-http-in-dependency-graph.spec.ts`
 * (#2409) asserts the transitive workspace dependency graph declares no HTTP
 * client, which is what catches an `axios`/`got`/`undici` reached by an
 * ordinary import — invisible to a source grep and to `no-restricted-globals`
 * alike.
 *
 * @module libs/oms/src
 * @see docs/architecture/adrs/055-oms-as-credentialless-connection-plugin.md
 */
export { OlFulfillmentExecutorAdapter } from './execution/ol-fulfillment-executor.adapter';
export { OmsModule } from './oms.module';
export { createOmsPlugin, omsAdapterManifest } from './oms.plugin';
export type { OmsPluginDeps } from './oms.plugin';
export { OMS_ADAPTER_KEY, OMS_BRAND, OMS_PLATFORM_TYPE } from './oms.constants';

export { createOlFulfillmentRouter, OlFulfillmentRouter } from './routing/ol-fulfillment-router';
export type { OlFulfillmentRouterDeps } from './routing/ol-fulfillment-router';
export { evaluateRouting } from './routing/evaluate-routing';
export type { RoutingPipelineResult } from './routing/evaluate-routing';
export { coerceRoutingRule, coerceRoutingRules, isRoutingRule } from './routing/routing-rule.types';
export type { RoutingFilterRule, RoutingRule, RoutingRuleBase, RoutingSortRule } from './routing/routing-rule.types';
export {
  mostRestrictiveAfterAction,
  RoutingAfterActionValues,
  RoutingFilterNameValues,
  RoutingRuleKindValues,
  RoutingSortNameValues,
} from './routing/routing-vocabulary.types';
export type {
  RoutingAfterAction,
  RoutingFilterName,
  RoutingRuleKind,
  RoutingSortName,
} from './routing/routing-vocabulary.types';
export { stockKey } from './routing/routing-facts.types';
export type { RoutingCandidate, RoutingFacts } from './routing/routing-facts.types';
export type { RoutingRuleSourcePort } from './routing/routing-rule-source.port';
export * from './oms.tokens';
