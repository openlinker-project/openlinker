# Implementation Plan — #754 `FakeSubiektBridgeAdapter` for Mac/Linux dev

**Issue:** [#754](https://github.com/openlinker-project/openlinker/issues/754) · **Parent design:** #728 (`docs/specs/product-spec-728-invoicing-integration.md` §4.4 SC-1, AC-10)
**Branch:** `754-fake-subiekt-bridge-adapter`
**Layer:** Integration (new plugin package skeleton) + DX. **No runtime adapter, no NestJS wiring, no FE, no .NET.**

---

## 1. Understand the task

Bootstrap the `@openlinker/integrations-subiekt` package and ship an **in-memory double of the Subiekt bridge's REST surface** so the real Subiekt adapter (#753) can be developed and unit-tested on Mac/Linux with **no Windows VM and no live bridge**. The bridge is a Windows .NET service (#752) that wraps InsERT's Sfera SDK; OL's adapter (#753) calls it over HTTP. This issue replaces that HTTP client with a deterministic fake in tests.

**Role clarification (from the spec, decisive):** the fake doubles the **bridge client** (the HTTP surface the adapter *calls*), not `InvoicingPort`. SC-1: "implements bridge REST contract, returns mock data." AC-10: "consumed by OL adapter `*.spec.ts` tests." So `FakeSubiektBridgeAdapter implements SubiektBridgeClient`, and #753's `SubiektInvoicingAdapter` is constructed with it in tests.

**Scope precision (review):** #754 enables developing and unit-testing the Subiekt **adapter** off-Windows. It does **not** by itself let OL's core/integration tests exercise the `'Invoicing'` capability end-to-end — that needs the real `SubiektInvoicingAdapter` wired with the fake client (#753). The PR description must state this so the boundary isn't over-claimed.

**Why this is the right design (research-backed):** Subiekt nexo has no cloud API; its only surface is the Windows-only Sfera .NET/COM SDK, which can't be containerized — so the real dependency is *categorically un-runnable* on a contributor laptop. Per *Software Engineering at Google* (Ch. 13) and Fowler's taxonomy, that is exactly the case where an in-memory **fake** (not a mock/stub, and not record/replay — the bridge conversation is stateful + write-bearing, and re-recording would need the very Windows box we're avoiding) is the correct double, swapped at the seam. The Windows-bridge pattern itself is industry-standard (SellIntegro/SubSync/Orbis local Windows services over Sfera; QuickBooks Web Connector / Sage 50 internationally). **The load-bearing risk is fidelity drift** — see the dedicated section below.

**Explicit non-goals (issue + spec):**
- The real HTTP bridge client + the `SubiektInvoicingAdapter` (`InvoicingPort` impl) — **#753**.
- The .NET bridge + its authoritative REST contract — **#752/#755/#756**.
- Plugin manifest / descriptor / host registration (`apps/{api,worker}/plugins.ts`) — comes with the adapter (#753).
- Any FE, connection-test, or production deployment.

**Classification:** Integration (plugin scaffold) + DX.

## 2. Research findings (conventions to mirror)

- **Package skeleton template:** `libs/integrations/erli/` (newest, #1019) — `package.json`, `tsconfig.json`, `tsconfig.spec.json`, `jest.config.mjs`, flat `src/`.
- **`/testing` sub-barrel precedent:** `libs/integrations/inpost/` — `src/testing.ts` barrel, `src/testing/fake-inpost-shipping.adapter.ts`, and the `package.json` `exports["./testing"]` declaration. Fake pattern: implements the contract, private state fields, `seed*` + `clear()` helpers, returns `Promise.resolve/reject` (not `async`) so failures surface as rejections.
- **Workspace:** `pnpm-workspace.yaml` globs `libs/integrations/*` — **no edit needed**. `tsconfig.base.json` **does** need explicit `@openlinker/integrations-subiekt` + `/*` paths entries (every integration package has them).
- **ESLint:** root `.eslintrc.js` applies; note the `consistent-type-imports` rule (`import type` for type-only) and `no-explicit-any: error`.
- **Bridge surface (provisional):** the `sfera-api-main` reference exposes endpoints like `POST /api/przyjecie`; invoice issuance is "the next endpoint." #752 owns the **authoritative** REST contract — so #754 defines a **minimal provisional `SubiektBridgeClient`** (issue / customer-upsert / status-read per the AC) and flags it for reconciliation with #752.

## 3. Design

### Package layout (`libs/integrations/subiekt/`)
```
libs/integrations/subiekt/
├── package.json            # name @openlinker/integrations-subiekt; exports "." + "./testing"
├── tsconfig.json           # mirror erli (references core/shared/plugin-sdk)
├── tsconfig.spec.json      # mirror erli
├── jest.config.mjs         # mirror erli; moduleNameMapper → integrations-subiekt
└── src/
    ├── index.ts            # main barrel — exports the bridge contract types
    ├── bridge/
    │   ├── subiekt-bridge.client.ts   # interface SubiektBridgeClient (contract, no impl)
    │   └── subiekt-bridge.types.ts    # bridge-native request/response DTOs + status union
    ├── testing.ts          # /testing sub-barrel — exports the fake + the contract suite
    └── testing/
        ├── fake-subiekt-bridge.adapter.ts        # FakeSubiektBridgeAdapter implements SubiektBridgeClient
        ├── subiekt-bridge-contract.suite.ts      # runSubiektBridgeContractTests(makeClient) — reusable (fidelity seam)
        └── __tests__/fake-subiekt-bridge.adapter.spec.ts   # runs the contract suite against the fake
```
`bridge/subiekt-bridge.errors.ts` holds the two error classes (`SubiektBridgeUnreachableError`, `SubiektRejectedError`); exported from the main barrel so #753 can both throw (real client) and catch them.

### Bridge contract — `SubiektBridgeClient` (Subiekt-native; provisional, #752 authoritative)
The plugin package is **not** bound by the core agnosticism litmus — bridge DTOs may use Subiekt/PL terms (`nip`, KSeF states). The neutral↔bridge mapping is #753's adapter, not here. Methods cover exactly the AC's three endpoints:
```ts
export interface SubiektBridgeClient {
  issueInvoice(req: BridgeIssueInvoiceRequest): Promise<BridgeIssueInvoiceResponse>;
  upsertCustomer(req: BridgeUpsertCustomerRequest): Promise<BridgeUpsertCustomerResponse>;
  getInvoiceStatus(req: BridgeInvoiceStatusRequest): Promise<BridgeInvoiceStatusResponse>;
}
```
Types (`subiekt-bridge.types.ts`), provisional shapes:
- `BridgeIssueInvoiceRequest` — `{ orderId, idempotencyKey?, documentType, currency, buyer: BridgeBuyer, lines: BridgeLine[] }`; `BridgeBuyer = { name, nip: string | null, address {...}, type: 'company'|'private' }`; `BridgeLine = { name, quantity, unitPriceGross, taxRate }`.
- `BridgeIssueInvoiceResponse` — `{ providerInvoiceId, providerInvoiceNumber, regulatoryStatus: BridgeRegulatoryStatus, pdfUrl: string | null }`.
- `BridgeUpsertCustomerRequest` — `{ buyer: BridgeBuyer }`; `BridgeUpsertCustomerResponse` — `{ providerCustomerId }`.
- `BridgeInvoiceStatusRequest` — `{ providerInvoiceId }`; `BridgeInvoiceStatusResponse` — `{ status: BridgeInvoiceStatus, regulatoryStatus: BridgeRegulatoryStatus }`.
- `BridgeRegulatoryStatus = 'none' | 'pending' | 'sent' | 'accepted' | 'rejected'` (KSeF-native; #753 maps → neutral `RegulatoryStatus`).
- `BridgeInvoiceStatus = 'issued' | 'failed'` (bridge-native).
All declared with `as const` unions where enumerated, per standards.

### `FakeSubiektBridgeAdapter implements SubiektBridgeClient`
- Deterministic defaults: `issueInvoice` → `{ providerInvoiceId: 'SUB-MOCK-1', providerInvoiceNumber: 'FV-MOCK-001', regulatoryStatus: 'sent', pdfUrl: null }` (counter-incremented per call so multiple issues differ); `upsertCustomer` → `{ providerCustomerId: 'KH-MOCK-1' }`; `getInvoiceStatus` → last-issued status (or seeded).
- **Failure modes** (AC): `seedFailure('bridge-unreachable')` → rejects with a `BridgeUnreachableError`; `seedFailure('subiekt-rejected', { reason })` → rejects with a `SubiektRejectedError` carrying the reason. Errors are plain `Error` subclasses exported from the package (the real client throws the same shapes so adapter `.rejects` assertions are portable).
- **Helpers:** `seed(partial)` to override the next response; `clear()` resets counters + seeded failure/overrides. Returns `Promise.resolve/reject` (no `async`) — matches the InPost precedent and keeps rejections as rejections.
- JSDoc on every helper (AC).

### Barrels & exports
- `src/index.ts` — exports `SubiektBridgeClient` + all bridge types + the two error classes (so #753 imports the contract).
- `src/testing.ts` — exports `FakeSubiektBridgeAdapter` **and** `runSubiektBridgeContractTests` (the reusable contract suite).
- `package.json` `exports`: `"."` and `"./testing"` (mirror inpost). `tsc -b` emits `dist/testing.js` from `src/testing.ts`.
- **Convention note:** unlike the existing `/testing` fakes (InPost's `FakeInpostShippingAdapter implements ShippingProviderManagerPort` — a *core port*), this fake doubles a **plugin-internal** contract (`SubiektBridgeClient`). A legitimate but novel use of `/testing`; the fake's file header states this so a future reader doesn't expect a core-port fake.

### Fidelity & contract verification (research-driven — the load-bearing risk)
A fake of an un-runnable dependency can **pass while the real bridge fails** (fidelity drift). Because no Mac/Linux contributor ever runs the real Sfera bridge, nothing organically corrects that drift. Mitigation per *SWE@Google* Ch. 13 — one **contract suite run against both** the fake and the real implementation:
- #754 ships `runSubiektBridgeContractTests(makeClient: () => SubiektBridgeClient)` — a parameterized suite asserting the contract behaviour (issue returns a number+status; upsert returns a customer id; status read echoes the last issue; the two failure modes reject with the typed errors). The fake's spec runs it against `new FakeSubiektBridgeAdapter()`.
- **Deferred verification (assigned to #752/#753):** when the real HTTP `SubiektBridgeClient` (#753) and the .NET bridge (#752) exist, the *same* suite runs against the real bridge in a **Windows-only CI job** (ideally owned by the bridge maintainer). That job is where any divergence surfaces. #754 builds the seam; it cannot run the real half (no bridge yet).
- **Right-sized:** a single consumer + single bridge does **not** warrant Pact/broker machinery — the lightweight "one suite, two backends" form is proportionate (and is the documented recommendation).
- `#752` owns the **authoritative** REST contract; `SubiektBridgeClient` is the TS expression of it. The contract suite is the reconciliation anchor — the bridge's file header flags `#752` as authoritative so divergence is caught by the shared suite, not silently.

## 4. Step-by-step (each with acceptance)

1. **Scaffold package** — `package.json` (name, `exports` `.`+`./testing`, deps `@openlinker/{core,shared,plugin-sdk}` workspace:*), `tsconfig.json`, `tsconfig.spec.json`, `jest.config.mjs` (all mirrored from erli; jest mapper → `integrations-subiekt`). ✅ `pnpm install` clean; `tsc -b` builds.
2. **tsconfig.base.json** — add `@openlinker/integrations-subiekt` + `/*` paths. ✅ resolves.
3. **Bridge contract** — `bridge/subiekt-bridge.client.ts` (interface) + `bridge/subiekt-bridge.types.ts` (DTOs + `as const` status unions) + error classes (`bridge/subiekt-bridge.errors.ts`). ✅ interface-only; no impl.
4. **Fake** — `testing/fake-subiekt-bridge.adapter.ts` implementing the client with deterministic returns + `seed`/`seedFailure`/`clear`. ✅ no `any`, file header (notes it doubles a plugin-internal contract), JSDoc helpers.
5. **Contract suite** — `testing/subiekt-bridge-contract.suite.ts` exporting `runSubiektBridgeContractTests(makeClient)` (the fidelity seam, reusable by #753 against the real client). ✅
6. **Barrels** — `src/index.ts` (contract + types + errors), `src/testing.ts` (fake + contract suite). ✅ `./testing` export resolves.
7. **Tests** — `testing/__tests__/fake-subiekt-bridge.adapter.spec.ts` runs `runSubiektBridgeContractTests(() => new FakeSubiektBridgeAdapter())` + fake-specific `seed`/`clear` assertions. ✅ `pnpm test` green.
8. **Quality gate** — lint + type-check + test green; `check:invariants` unaffected (no plugins.ts edit → no jest-integration-mapper entry needed). **Verify** the new contract-only package doesn't trip `check-create-adapter` / `check-libs-build-scripts` (a gate concern — confirmed at `/pre-implement`).

## 5. Validation

- **Architecture:** plugin-internal contract + fake; no core dependency leak (bridge DTOs are Subiekt-native; neutral mapping deferred to #753). Fake implements the contract interface, mirrors the InPost fake pattern. ✅
- **Naming:** `*.client.ts` (contract), `*.types.ts`, `*.adapter.ts` (fake), `*.spec.ts`. ✅
- **Contract surface:** purely additive (new package, new `tsconfig.base.json` paths). No existing barrel/port/DTO/migration touched. ✅
- **Testing:** fake's own unit specs satisfy the testable ACs now; AC-1/AC-10 ("adapter specs consume it") satisfied when #753's adapter lands and imports the contract + fake. ✅
- **Security:** no secrets; no network; no DB. ✅

## Resolved (post tech-review + research)
1. **#753 coupling** — ✅ ship #754 standalone (fake + contract + fake's own tests, run via the contract suite). AC-1/AC-10 ("adapter specs consume it") close when #753 lands; the contract suite makes #753's adoption drop-in.
2. **Provisional contract** — ✅ acceptable for a dev-only fake; the bridge file header flags `#752` as authoritative, and the shared contract suite is the reconciliation anchor.
3. **Contract ownership** — ✅ #754 owns `SubiektBridgeClient` (only way it stays independent of #753).
4. **Fidelity / contract testing** — ✅ added `runSubiektBridgeContractTests` seam + a "Fidelity & contract verification" section assigning real-bridge verification to #752/#753 (Windows CI job).
5. **Scope claim** — ✅ PR will state #754 enables adapter dev off-Windows, not full-flow.

_No open flags. Ready for the `/pre-implement` gate._
