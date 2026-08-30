/**
 * OMS Module
 *
 * The NestJS composition seam for `@openlinker/oms`, registered in
 * `apps/api/src/plugins.ts` and `apps/worker/src/plugins.ts` as a
 * `PluginEntry`. Empty by design at this stage (#2390): the plugin
 * descriptor, its `AdapterMetadata` manifest and the credential-less
 * connection arrive with #2405 (`W3a-16`).
 *
 * **This module is not decorative.** It is the only thing that makes the
 * rest of the #2390 wiring load-bearing: without a real import of
 * `@openlinker/oms` from `apps/{api,worker}`, the jest integration
 * `moduleNameMapper` entries, the per-app tsconfig `paths` and the
 * `Dockerfile` COPY lines are never exercised, and every one of them
 * would be unverifiable. `FxIntegrationModule` is the shipped precedent
 * for a `PluginEntry` that carries no manifest and no capability.
 *
 * @module libs/oms/src
 * @see docs/architecture/adrs/055-oms-as-credentialless-connection-plugin.md
 */
import { Module } from '@nestjs/common';

@Module({})
export class OmsModule {}
