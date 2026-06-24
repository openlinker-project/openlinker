# Pre-Implement Readiness Gate — #991 Erli Offers Vertical-Slice Int-Specs

**Date**: 2026-06-16
**Plan**: `docs/plans/implementation-plan-erli-offers-int-specs.md`
**Branch**: `991-erli-offers-int-specs` (off merge of #1065 + #1066, base `7fde1ec1`)
**Gate type**: read-only readiness (no code, no plan edits)

## Verdict: ✅ READY

Test-only change — no production code, ports, DTOs, schema, or barrel exports touched, so the backward-compat surface is inert. All proposed artifacts are confirmed NEW, and every seam the plan binds against exists with the asserted shape.

## Reuse findings

| Plan artifact | Classification | Evidence |
|---|---|---|
| `apps/api/test/integration/helpers/erli-fake-http-client.ts` | **NEW** (absent) | `ls` — does not exist |
| `apps/api/test/integration/helpers/erli-test-offer-manager.helper.ts` | **NEW** (absent) | `ls` — does not exist |
| `apps/api/test/integration/erli/erli-offers-vertical-slice.int-spec.ts` | **NEW** (absent) | `ls` — does not exist |
| `erli.test.v1` adapterKey | **NEW** (no collision) | grep across `*.ts` — no existing registration |

## Seam-accuracy findings (all confirmed against live code)

| Seam | Asserted shape | Confirmed at |
|---|---|---|
| `IErliHttpClient` | `get`/`post`/`patch` | `libs/integrations/erli/src/infrastructure/http/erli-http-client.interface.ts` |
| `ErliOfferManagerAdapter` ctor | `(connectionId, adapterKey, httpClient, defaultDispatchTime?, cache?)` | `erli-offer-manager.adapter.ts:156-172` (`identifierMapping` NOT a ctor arg; `cache` is the 5th arg) |
| `CACHE_PORT_TOKEN` | exported Symbol | `libs/shared/src/cache/cache.types.ts:9` |
| `ADAPTER_REGISTRY_TOKEN` | exported Symbol | `libs/core/src/integrations/integrations.tokens.ts:12` |
| `ADAPTER_FACTORY_RESOLVER_TOKEN` | exported Symbol | `integrations.tokens.ts:15` |
| `OfferStatusSyncService.sync(connectionId, options)` | service entry point | confirmed (offer-status-sync.service) |
| `OfferMappingRepositoryPort.findMany` | queries `identifier_mappings` (`entityType='Offer'`) | `offer-mapping-repository.port.ts` |
| `IdentifierMappingService.createMapping` | `(entityType, externalId, connectionId, internalId)` | `identifier-mapping.port.ts:73`; usage `createMapping('Product','ext-1','conn-1','ol_product_x')` |
| `ErliApiException` ctor | `(message, statusCode?, responseBody?, url?)` | `erli-api.exception.ts` |
| `ErliConfigException` (fail-closed path) | thrown by `productPath` before any HTTP | `erli-offer-manager.adapter.ts:~402` |
| jest-integration mapper | maps `@openlinker/integrations-erli` | `apps/api/test/jest-integration.cjs:64-71` |

## Backward-compatibility findings

None. No barrel export, port signature, DTO, Symbol token, or ORM schema is modified. The single production-test-infra edit (adding `OL_ERLI_OFFER_STATUS_SYNC_SCHEDULER_ENABLED: 'false'` to `apps/api/test/integration/setup.ts`) is additive and disables a background scheduler — no contract impact.

## Open questions

None blocking. Q1 (variant-grouping assertion scope) and Q2 (mapping-seed mechanism) from the plan are resolved in-plan. The only standing caveat is **#992-provisional Erli field names** — explicitly flagged in the plan and accepted as test-only revisit risk.

## Note (reuse opportunity, non-blocking)

`@openlinker/core/identifier-mapping/testing` ships an in-memory `createMapping` fake — not used here (the int-spec uses the real service via the harness DB), but worth knowing for the future orders int-spec (#998).
