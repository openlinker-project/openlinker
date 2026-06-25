---
plan: docs/plans/implementation-plan-1164-ps-publisher-deferrals.md
issue: "#1164"
date: 2026-06-24
verdict: NEEDS-REVISION
---

# Pre-Implementation Analysis — #1164 PS Publisher Deferrals (Images + Parameters)

**Verdict: NEEDS-REVISION** — No Critical contract breaks. One Warning (W1) will cause `pnpm type-check` to fail if not addressed before implementation begins; W2–W3 are low-priority advisories.

---

## Phase B — Reuse Audit

All plan artifacts are genuinely new. No existing port, service, DI token, ORM entity, or capability is reinvented.

| Plan Artifact | Status | Evidence |
|---|---|---|
| `IPrestashopWebserviceClient.uploadImage` | **NEW — confirmed absent** | Interface has exactly 5 methods; no binary/multipart upload exists anywhere in the PS integration package |
| `PrestashopWebserviceClient.uploadImage` | **NEW — confirmed absent** | No `FormData`, `multipart`, or `uploadImage` in the client implementation |
| `PrestashopFeatureListItem` | **NEW — confirmed absent** | `grep -r "PrestashopFeature"` returns zero hits outside the deferral warning comment |
| `PrestashopFeatureResponse` | **NEW — confirmed absent** | Same |
| `PrestashopFeatureValueListItem` | **NEW — confirmed absent** | Same |
| `PrestashopFeatureValueResponse` | **NEW — confirmed absent** | Same |
| `PrestashopFeatureAssociation` | **NEW — confirmed absent** | Same |
| `PrestashopProductWriteBody.associations.product_features` | **NEW — confirmed absent** | `associations` currently has only `categories` (confirmed from file read) |
| `provisionFeatures` private method | **NEW — confirmed absent** | Only `provisionCategory` exists as the reference pattern |
| `uploadImages` private method | **NEW — confirmed absent** | Only `updateStock` exists as the reference pattern |

**Existing patterns cited in the plan (correct reuse identified):**

| Pattern | Source | Plan usage |
|---|---|---|
| `updateStock` best-effort | adapter ~line 243 | Image upload best-effort posture ✓ |
| `provisionCategory` resolve-or-create | adapter ~line 140 | Feature provisioning posture ✓ |
| `langField` helper | adapter ~line 45 | Multilingual field construction ✓ |
| `extractLangText` helper | adapter ~line 297 | Feature name matching ✓ |

---

## Phase C — Backward-Compatibility Findings

### W1 — `uploadImage` breaks all `IPrestashopWebserviceClient` mock sites (type-check failure guaranteed)

**Severity: Warning** (integration-internal; not a `@openlinker/core/*` barrel surface)

Adding `uploadImage` to the interface is a TypeScript breaking change for every object that satisfies `jest.Mocked<IPrestashopWebserviceClient>`. The plan documents Step 5a as "Add `uploadImage: jest.fn()` to the mocked client object" in the **product-publisher spec's own `makeClient()`** — but this covers only one of several mock sites.

**Blast radius (files that need `uploadImage: jest.fn()`):**

| File | Mock mechanism | Fixed by plan? |
|---|---|---|
| `src/__tests__/mocks/mock-http-client.factory.ts` | Shared `createMockHttpClient()` factory | **No — missed** |
| `src/__tests__/mocks/prestashop-order-processor-manager.factory.ts` | Inline mock in order-processor factory | **No — missed** |
| `src/infrastructure/adapters/__tests__/prestashop-inventory-master.adapter.spec.ts` | Uses `createMockHttpClient()` | Covered if factory is fixed |
| `src/infrastructure/adapters/__tests__/prestashop-order-source.adapter.spec.ts` | Uses `createMockHttpClient()` | Covered if factory is fixed |
| `src/infrastructure/adapters/__tests__/prestashop-product-master.adapter.spec.ts` | Uses `createMockHttpClient()` | Covered if factory is fixed |
| `src/infrastructure/adapters/product-publisher/__tests__/prestashop-product-publisher.adapter.spec.ts` | Custom `makeClient()` in-file | Yes — plan Step 5a |
| `src/infrastructure/provisioners/__tests__/prestashop-address-provisioner.spec.ts` | Uses `createMockHttpClient()` | Covered if factory is fixed |
| `src/infrastructure/provisioners/__tests__/prestashop-attribute.resolver.spec.ts` | Uses `createMockHttpClient()` | Covered if factory is fixed |
| `src/infrastructure/provisioners/__tests__/prestashop-customer-provisioner.spec.ts` | Uses `createMockHttpClient()` | Covered if factory is fixed |

**Recommended revision:** After Step 1 (interface change), add an explicit sub-step to the plan:

> **Step 1b — Update shared mock factories**
> - `src/__tests__/mocks/mock-http-client.factory.ts`: add `uploadImage: jest.fn()` to the returned object.
> - `src/__tests__/mocks/prestashop-order-processor-manager.factory.ts`: add `uploadImage: jest.fn()` to any inline `IPrestashopWebserviceClient` mock it constructs.
>
> This single fix covers six downstream spec files that use `createMockHttpClient()`.

---

### W2 — `uploadImage` implementation has no timeout guard (documented risk, no mitigation)

**Severity: Warning (advisory)**

The plan's Step 2 calls `fetch(url, { method: 'POST', ... })` without an `AbortController` timeout. The plan acknowledges this in the Risks table ("Large images / timeout — Out of scope for v1 — the per-image warning path handles any throw") but that mitigation is incomplete: a hung `fetch` never throws — it stalls the job indefinitely.

The existing `request()` private method on `PrestashopWebserviceClient` uses `requestWithRetry`, which itself wraps each attempt in an abort signal via a timeout. The `uploadImage` implementation intentionally bypasses `requestWithRetry` (correct: retrying multipart creates duplicates), but it should still add its own `AbortController` + `setTimeout` using `this.config.timeoutMs`:

```typescript
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
try {
  const response = await fetch(url, { method: 'POST', headers, body: form, signal: controller.signal });
  // ...
} finally {
  clearTimeout(timeout);
}
```

**Recommended revision:** Add this timeout guard to the Step 2 snippet. The implementation correctly handles the thrown `AbortError` at the adapter level (`uploadImages` wraps each upload in try/catch → warning).

---

### W3 — `uploadImage` re-implements auth inline (minor duplication)

**Severity: Warning (low priority / informational)**

The plan's `uploadImage` constructs its own `Headers` and calls `this.getBasicAuth()` directly. The existing `request()` private method already centralises auth, abort, and logging. Since `request()` accepts `RequestInit` options (including `body`), it may be possible to route `uploadImage` through `request()` by passing `FormData` as `options.body` and setting the `Content-Type` header to `undefined` (so `fetch` sets the multipart boundary). This would inherit the timeout and structured-logging from the existing path at no cost.

However, if `request()` sets `Content-Type: application/xml` unconditionally (which would break the multipart boundary), the inline approach is the right call. The implementer should check `request()` before deciding. Either way, the behavior is correct — this is a maintenance-surface note, not a correctness issue.

---

## Phase D — Open Questions

1. **`prestashop-order-processor-manager.factory.ts` mock shape** — The Explore agent confirmed this factory creates an `IPrestashopWebserviceClient` mock, but the exact inline vs. delegate shape was not read. Before Step 1, the implementer should open this file and confirm whether it delegates to `createMockHttpClient()` (then the factory fix covers it) or constructs its own inline object (then it needs its own `uploadImage: jest.fn()` addition).

2. **PS image response schema** — The plan's Step 2 parses the image upload response as `{ prestashop: { image: { id } } }` or `{ image: { id } }` with a fallback chain. If the actual PS response uses `@_id` (XML attribute) vs `id` (element), the current fallback covers both. This should be validated against a real PS install before closing the issue.

3. **`PrestashopResponseParser` access in `uploadImage`** — The plan references `PrestashopResponseParser.parse` as a static helper in `PrestashopWebserviceClient`. This is a private implementation detail — confirm the parser class is accessible from within the client (not a separate module that would require an import). If it's inlined or private, the plan's snippet may need adjustment.

---

## Summary for the Implementer

The plan is structurally sound. All artifacts are genuinely new, patterns are correctly identified, and the boundary (integration-internal, no CORE change, no migration) is respected.

**One action required before starting:**

> **W1 is a guaranteed `pnpm type-check` failure.** Add an explicit "Step 1b — Update shared mock factories" to the plan covering `mock-http-client.factory.ts` and `prestashop-order-processor-manager.factory.ts`. Without this, CI fails on nine unrelated spec files the moment `uploadImage` lands on the interface.

W2 (timeout guard) is strongly recommended and a 4-line change. W3 is informational — act on it only if `request()` can naturally accept `FormData` body without overriding `Content-Type`.
