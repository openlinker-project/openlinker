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
 * merely intended — `libs/oms` is in `scripts/check-outbound-http.mjs`'s
 * `SCAN_ROOTS` and in the bare-`fetch` ESLint ban.
 *
 * @module libs/oms/src
 * @see docs/architecture/adrs/055-oms-as-credentialless-connection-plugin.md
 */
export { OmsModule } from './oms.module';
