# Pre-Implement Analysis — `implementation-plan-1103-1105-shipping-followups.md` (#1103, #1104, #1105)

**Date**: 2026-06-18
**Gate**: read-only readiness check (no code written, plan unedited beyond the tech-review pass)

## Verdict: ✅ READY

No reuse collisions, no contract breaks, no migration. The plan reuses the existing
`AuthFailureClassifierPort` seam and the `host.authFailureClassifierRegistry` registration
pattern (two live precedents), and the #1104 change is purely additive on an open-shape field.

## Reuse findings

| Plan artifact | Status | Evidence |
|---|---|---|
| `AuthFailureClassifierPort` (the port the classifiers implement) | **EXISTS → reuse** | `libs/core/src/sync/domain/ports/auth-failure-classifier.port.ts`, exported from the `@openlinker/core/sync` barrel (`index.ts:16`) |
| `host.authFailureClassifierRegistry` (registration seam) | **EXISTS → reuse** | `libs/plugin-sdk/src/host-services.ts:109`; wired in `create-nest-adapter-module.ts:126,153` |
| `DpdAuthFailureClassifierAdapter` | **NEW (confirmed absent)** | only `allegro-…` and `woocommerce-…` classifiers exist under `libs/integrations/**`; no DPD one |
| `InpostAuthFailureClassifierAdapter` | **NEW (confirmed absent)** | same — no InPost classifier today |
| Registration precedent to mirror | **EXISTS** | `allegro-plugin.ts:119` **and** `woocommerce` plugin (`host.authFailureClassifierRegistry.register(...)`) — two precedents |
| `ShippingProviderRejectionException.providerDetails` (#1104 target) | **EXISTS → extend** | `libs/core/src/shipping/domain/exceptions/shipping-provider-rejection.exception.ts:53` — `Record<string, unknown>`, open shape |
| DPD `reject()` + `validationInfo` types | **EXISTS → extend** | `dpd-shipment.mapper.ts:370`; `DpdValidationInfo` in `dpd-rest.types.ts:126` |
| `shipment-dispatch-retry.int-spec.ts` | **NEW** | harness precedent: `apps/api/test/integration/shipment-dispatch.int-spec.ts` |

## Backward-compatibility findings

| Surface | Assessment | Severity |
|---|---|---|
| Top-level barrels | No exported symbol removed/renamed. The two new classifiers are plugin-internal (registered, not exported on a core barrel). | none |
| Port signatures | `AuthFailureClassifierPort.isCredentialRejected` is **implemented**, not modified. | none |
| `providerDetails` shape (#1104) | **Additive** — adds a `validationInfo` key. Other consumers read disjoint plugin-specific keys: InPost `providerDetails.fieldErrors` (`inpost-shipping.adapter.ts:141`), Allegro `providerDetails.errors`. No consumer asserts the DPD `{errorCode, info}` exact shape outside the DPD plugin. | none (additive) |
| Symbol tokens | None added/removed. | none |
| ORM schema | No entity/column change → **no migration**. | none |
| `check:invariants` | Plugin adapters import `AuthFailureClassifierPort` from the top-level `@openlinker/core/sync` barrel (allowed capability-port cross-context import); int-spec is test-only. No cross-context / deep-barrel / service-interface rule expected to trip. | none |

## Open questions

- **None blocking.** The one risk the plan originally flagged (does the background sync-job path
  throw an exception the classifier recognises?) was resolved during the tech-review pass and is
  now documented as confirmed in the plan: both DPD clients (REST + SOAP `dpd-info-soap-client.ts:149,158`)
  throw `DpdUnauthorizedException`, and InPost's single client throws `InpostUnauthorizedException` —
  both extend `ShippingProviderAuthException`, so the classifier fires on the
  `marketplace-shipment-status-sync` / `fulfillment-status-sync` job path.
- **Scoped-out (acknowledged, not a blocker):** the synchronous `POST /shipments/generate-label`
  path is intentionally NOT wired to flag `needs_reauth` (#1103 Part B), per the AC's "or explicitly
  scoped out with a reason" clause and the user's approval.
