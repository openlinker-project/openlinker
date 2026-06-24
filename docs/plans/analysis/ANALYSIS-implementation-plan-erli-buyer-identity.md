# Pre-Implement Readiness Gate — #995 Erli Buyer Identity Resolution

**Date**: 2026-06-16
**Plan**: `docs/plans/implementation-plan-erli-buyer-identity.md`
**Branch**: `995-erli-buyer-identity` (stacked on `993-erli-order-source`)
**Gate type**: read-only readiness

## Verdict: ✅ READY

Plugin-only: one new `EmailNormalizerPort` adapter + one `register(host)` line + a test-stub field + unit tests. The per-platform email-normalizer seam and the email-absent→`external_only` degradation already exist in core. Zero CORE change; no migration; no contract break.

## Reuse findings

| Plan artifact | Classification | Evidence |
|---|---|---|
| `erli-email-normalizer.adapter.ts` | **NEW** | `ls` — absent; no Erli normalizer registered today |
| `register(host)` normalizer registration | **NEW** (one line in `erli-plugin.ts`) | mirrors `allegro-plugin.ts:111-113` |

## Seam-accuracy findings (confirmed)

| Seam | Status | Evidence |
|---|---|---|
| `EmailNormalizerPort` | exported from barrel | `libs/core/src/integrations/index.ts:32` |
| `normalizeEmail` baseline (trim+lowercase) | exported | `libs/shared/src/config/pii-hashing.ts:42` |
| `HostServices.emailNormalizerRegistry` | present on host bag | `libs/plugin-sdk/src/host-services.ts:97` |
| Registry `register/resolve` + `DEFAULT_EMAIL_NORMALIZER` fallback | present | `email-normalizer-registry.service.ts` (review-confirmed) |
| Resolver invokes `normalize` before `hashEmail`; buyer.id resolved first | present | `customer-identity-resolver.service.ts:173-174, :201` (review-confirmed) |
| email-absent → external_only | present | `order-ingestion.service.ts:337-359` (review-confirmed) |
| `ERLI_ADAPTER_KEY` (registry key) | `'erli.shopapi.v1'` | `erli.constants.ts:10` |
| `createNestAdapterModule` threads `emailNormalizerRegistry` into Erli's host bag | present | `create-nest-adapter-module.ts:151` (review-confirmed) |

## Backward-compatibility findings

None. New adapter + one registration line + one field added to the `erli-plugin.spec.ts` `makeRegisterHost()` stub (`emailNormalizerRegistry: { register: jest.fn() }` — currently absent). Behaviorally the baseline-only normalizer equals `DEFAULT_EMAIL_NORMALIZER`, so it changes nothing at runtime until #992 tightens it.

## Open questions (non-blocking, #992-provisional)

- Erli's real buyer-email shape (masked relay / real / absent) — unconfirmed. The adapter ships **baseline-only** (fail-safe: no `+suffix` strip, which would risk silent cross-buyer merges via the resolver's single-match reuse). #992 tightening = add a domain-gated strip mirroring Allegro's `@allegromail.` gate, in this one file.
