/**
 * @openlinker/plugin-sdk — Public API
 *
 * The plugin-author surface for OpenLinker's per-connection integration
 * plugins (#593). Exposes the `AdapterPlugin` contract, the curated
 * `HostServices` bag, and the `createNestAdapterModule()` helper that
 * bridges a framework-neutral descriptor into a NestJS `DynamicModule`.
 *
 * Plugin authors should not need to import from anywhere else when writing
 * a new adapter. Cross-package value imports (e.g. core ports the plugin's
 * `createCapabilityAdapter` needs to call) come from `@openlinker/core/*`
 * top-level barrels per the project-wide barrel-only rule (#591).
 *
 * Companion docs: `docs/plans/implementation-plan-adapter-plugin-contract.md`
 * (the contract design + in-tree migration recipe).
 *
 * @module libs/plugin-sdk/src
 */
export type { AdapterPlugin } from './adapter-plugin';
export type { HostServices } from './host-services';
export {
  createNestAdapterModule,
  type CreateNestAdapterModuleOptions,
} from './create-nest-adapter-module';
