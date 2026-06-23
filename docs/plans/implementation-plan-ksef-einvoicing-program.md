# Implementation Plan: KSeF e-invoicing integration program (Epic #1142)

**Date**: 2026-06-23
**Status**: Draft / Ready for Review
**Estimated Effort**: ~6–8 engineering-weeks of work (10 children, C-effort tags below). With the parallelism described in §6 the program critical path is ~4–5 weeks of wall-clock.

> **Plan shape.** This is a **program-level orchestration plan**, not a single-issue plan. It sequences the ten children of epic **#1142** along their dependency graph, names what runs in parallel, and embeds — once, in §6.1 — the **per-issue subagent orchestration loop** that every child is executed through. §7 then walks each child (C1–C10) with its issue-specific notes, branch/stack target, and per-gate subagent assignments. Individual children may still warrant their own deep `/plan` doc when their PLAN agent runs (noted per-issue); this document is the spine that schedules them.

---

## 1. Task Summary

**Objective**: Ship `@openlinker/integrations-ksef` — a plugin that issues structured **FA(3)** invoices directly to Poland's **KSeF 2.0** (Krajowy System e-Faktur) and reconciles their regulatory clearance — behind the existing neutral **`Invoicing`** capability, governed by **ADR-026**. Deliver it as ten coordinated PRs (epic #1142 children C1–C10), each produced through a fixed multi-agent quality loop, each landing as its own signed, draft PR with `Closes #N`.

**Context**: PL VAT sellers face a KSeF clearance mandate (1 Feb 2026 for >200M PLN turnover; 1 Apr 2026 all VAT payers; ≤10k PLN/mo relief through 31 Dec 2026). OpenLinker already shipped the neutral invoicing domain + `InvoiceRecord` + repo + migration (#751, closed) and ADR-026 settled the country-agnostic seam. KSeF is the **first `RegulatoryTransmitter` provider** that ADR anticipated. This program builds the adapter half; it rides on (does not duplicate) the in-flight generic invoicing plumbing #1118/#1119/#1120/#1121.

**Classification**: Primarily **Integration** (new plugin package), with one small **CORE** child (C1 — `RegulatoryTransmitter` sub-capability port + guard), one **Frontend** child (C8), one **Testing** child (C9), and one **Documentation** child (C10).

---

## 2. Scope & Non-Goals

### In Scope (the ten children)

| ID | Issue | Title | Layer | Effort |
|----|-------|-------|-------|--------|
| **C1** | #1143 | `RegulatoryTransmitter` sub-capability port + guard | CORE | S |
| **C2** | #1144 | `@openlinker/integrations-ksef` plugin skeleton + manifest + validators | Integration | M |
| **C3** | #1147 | KSeF 2.0 authentication & session crypto layer | Integration | L |
| **C4** | #1148 | FA(3) invoice XML builder + XSD validation | Integration | L |
| **C5** | #1149 | `KsefInvoicingAdapter` — issueInvoice (online send) + upsertCustomer | Integration | M |
| **C6** | #1150 | KSeF clearance status reader + UPO retrieval | Integration | M |
| **C7** | #1151 | FA(3) correction invoices (KOR) on returns/refunds | Integration | M |
| **C8** | #1152 | FE: KSeF connection settings + KSeF-number/UPO surfacing | Frontend | M |
| **C9** | #1153 | `FakeKsefClient` + adapter contract/integration tests | Testing | M |
| **C10** | #1154 | KSeF integration & operator setup guide | Docs | S |

### Out of Scope (epic-level, per #1142)

- **Inbound** invoice retrieval (purchase invoices). Separate epic.
- **B2C/consumer receipts** (`paragony`). Outside the mandate.
- The **Event→Condition→Action auto-issue rules layer** (when/whether/which-type). ADR-026 keeps policy above the port; **#1120** owns the trigger.
- **KSeF-number-in-payment-transfers** (Art. 108g, 1 Aug 2026). Future finance/payments slice.
- Production **qualified-seal / Trusted-Profile onboarding UX** — start on KSeF token + test env.
- **Batch-session** high-volume pipeline (note as future in C5).

### Coordination boundaries (in-flight work — depend on, never re-implement)

- **#1118** `InvoiceService` (core orchestration: idempotency gate + Order→command mapping). KSeF issuance is invoked **through** this — the adapter never writes `InvoiceRecord` directly. **Soft dependency** for C5/C7 integration-level wiring; unit tests mock `InvoicingPort`.
- **#1119** Invoicing HTTP API (issue/re-issue/list). C8's FE consumes it.
- **#1120** Auto-issue trigger. Out of scope; the adapter must not assume payment state.
- **#1121** **KSeF status reconciliation job** + proposed `RegulatoryStatusReader`. **Overlaps C1 and C6.** #1121 owns the *scheduler/worker* side; C6 owns the *adapter* side it calls. The seam (single poller) is decided in **C1** with #1121's author.

### Constraints

- **ADR-026 litmus test (hard rule):** zero `nip`/`ksef`/`vat`/`jpk`/`faktura`/`upo` strings in `libs/core`. All PL/FA(3)/NIP/KSeF specifics live in `libs/integrations/ksef`. This litmus is **enforced by reviewers + a `grep` over `libs/core` today — it is NOT yet automated** (`pnpm check:invariants` carries no neutral-vocabulary check). Automating it as a `scripts/check-neutral-vocabulary.mjs` gate wired into `check:invariants` is a tracked follow-up — a natural future child of this epic.
- **No core migration:** `InvoiceRecord.regulatoryStatus` + `clearanceReference` columns already shipped (#751). KSeF needs **no** DDL change. If a plugin-private table emerges (e.g. MF public-key cache, buyer cache), it ships as a **plugin-owned migration** (`libs/integrations/ksef/src/migrations/` + the two host edits per `docs/migrations.md §Plugin-Owned Migrations`).
- **No official Node/TS SDK** for KSeF — hand-roll the HTTP client + crypto (OL adapter standard: Allegro/Erli/InPost hand-roll their clients over `fetch`).
- **Resource-constrained runner:** scope test runs to the touched package (`pnpm --filter @openlinker/integrations-ksef test`), never full-repo `pnpm -r test` (OOM risk — testing-guide #976).

---

## 3. Architecture Mapping

**Target layers**:
- **CORE** (`libs/core/src/invoicing/`): C1 only — adds `RegulatoryTransmitter` capability interface + `isRegulatoryTransmitter` guard under `domain/ports/capabilities/`, exported from the `@openlinker/core/invoicing` barrel. No token (capability-resolved per-connection, like `OfferManager` sub-capabilities).
- **Integration** (`libs/integrations/ksef/`, new package `@openlinker/integrations-ksef`): C2–C7, C9. Structured like `libs/integrations/erli` (lightweight plugin via `createNestAdapterModule`) with the `/testing` sub-barrel pattern from `libs/integrations/subiekt` (which already ships `FakeSubiektBridgeAdapter` + `runSubiektBridgeContractTests`).
- **Frontend** (`apps/web/src/plugins/ksef/` + invoice panel surfacing): C8, registry-driven `OpenLinkerPlugin` per `docs/frontend-architecture.md` — never `platformType === 'ksef'` string-matching in shared components.
- **Docs** (`docs/integrations/ksef.md`): C10.

**Capabilities involved**:
- `Invoicing` — already a registered `CoreCapability` (`libs/core/src/integrations/domain/types/adapter.types.ts`), resolves `InvoicingPort` (`issueInvoice`, `getInvoice`, `upsertCustomer`, `getSupportedDocumentTypes`).
- `RegulatoryTransmitter` (new, C1) — ADR-002 sub-capability with `submitForClearance` + `getClearanceStatus`, narrowed via `isRegulatoryTransmitter(adapter)`. KSeF folds `submitForClearance` into the send (issuance = clearance in one act).

**Existing services / patterns reused**:
- `AdapterPlugin` + `createNestAdapterModule` + `dispatchCapability` from `@openlinker/plugin-sdk` (Erli precedent).
- `HostServices` registries for side-registrations: `connectionConfigShapeValidatorRegistry`, `connectionCredentialsShapeValidatorRegistry`, `connectionTesterRegistry`, `retryClassifierRegistry`, `authFailureClassifierRegistry`, `schedulerTaskRegistry`, `credentialsResolver`, `identifierMapping`, `logger`, `cache`.
- `InvoiceRecordRepositoryPort` (`create`/`findById`/`findByOrderId`/`findByIdempotencyKey`/`updateOutcome`) — but **only via #1118's `InvoiceService`**, never from the adapter.
- Hand-rolled HTTP client pattern (`ErliHttpClient`/`AllegroHttpClient`): retries, rate-limit backoff, structured logging.
- Reconciled-status precedent (ADR-009 / #816 offer-status snapshots) for C6's poll model.

**New components required**: `RegulatoryTransmitter` port + guard (C1); the entire `ksef` package — `createKsefPlugin`, `ksefAdapterManifest`, `KsefHttpClient` (interface + real impl), config/credentials shape validators, `KsefInvoicingAdapter`, FA(3) builder, session-crypto module, clearance/UPO reader, KOR builder extension, `FakeKsefClient` + contract suite (C2–C7, C9); FE plugin `plugins/ksef/index.ts` + invoice-panel UPO affordance (C8); `docs/integrations/ksef.md` (C10).

**Core vs Integration justification**:
- **C1 is the only CORE touch** and is justified: ADR-026 explicitly deferred the `RegulatoryTransmitter` *interface* (not implementation) to "the KSeF issue", and `InvoiceRecord` already carries its persistence columns. A neutral capability interface + guard is the contract every clearance regime (KSeF, IT SDI, ES SII) maps onto — it cannot live in the KSeF package because future non-PL adapters implement the same guard. It carries **zero** Polish vocabulary.
- **Everything else is Integration**: KSeF/FA(3)/NIP/UPO knowledge is confined to the plugin. Core remains unchanged beyond C1.

**ADR position**: The program's architecture is **already settled by [ADR-026](../architecture/adrs/026-country-agnostic-invoicing-domain.md)** — this plan surfaces no new cross-context decision, so it drafts **no** new ADR. Two per-issue ADR obligations are delegated to their owning child's PLAN agent:
- **C1 (#1143)**: a one-line **ADR-026 amendment note** iff the `RegulatoryTransmitter`-vs-`RegulatoryStatusReader` reconciliation with #1121 diverges from ADR-026's deferred sketch.
- **C3 (#1147)**: a **new ADR (Proposed)** for the CTC auth/crypto pattern **iff** it is designed to be reusable beyond KSeF (other clearance regimes) — the issue flags this as "ADR-worthy". The C3 PLAN agent decides and drafts under the next free ADR number.

---

## 4. External / Domain Research (KSeF 2.0)

**Base**: `https://api-{env}.ksef.mf.gov.pl/v2` — environments `test` (open sandbox, self-signed certs, self-serve subjects), `demo`, `prod`. OpenAPI: `https://api-test.ksef.mf.gov.pl/docs/v2/openapi.json`. Dev docs: `https://github.com/CIRFMF/ksef-api`.

**Authentication (C3)** — decoupled from session opening; **encryption mandatory** in both session modes:
- Handshake: `POST /auth/challenge` → build `AuthTokenRequest` → submit → poll `GET /auth/{referenceNumber}` → `POST /auth/token/redeem` → `accessToken` (JWT) + `refreshToken`; `POST /auth/token/refresh`. Read JWT `exp` for lifetimes — **never hardcode**.
- **KSeF token path** (unattended servers, v1 target): `{token}|{timestampMs}` → RSA-OAEP (MGF1 + SHA-256) with MF public key → `POST /auth/ksef-token`.
- **Qualified seal (XAdES) path**: sign `AuthTokenRequest` XML (enveloped/enveloping; detached not accepted) → `POST /auth/xades-signature`. Unit-cover with a self-signed test cert.
- Token taxonomy modelled distinctly: `authenticationToken` → `accessToken` → `refreshToken`.

**Session crypto (C3)**: generate AES-256 key + 128-bit IV; AES-256-CBC/PKCS#7 for documents; RSA-OAEP-wrap the AES key. Fetch + cache MF public key from `GET /security/public-key-certificates` — distinguish `KsefTokenEncryption` vs `SymmetricKeyEncryption` usages; **certs rotate, never hardcode**. RSA-OAEP + AES-256-CBC round-trip against known vectors.

**Async submit-then-poll (C5/C6)** — the KSeF number is **never returned at POST time**. Send → store `referenceNumber` + non-terminal status → poll → reconcile KSeF number + UPO. Maps onto OL's sync-job + status-snapshot pattern (ADR-009).
- Issue: `POST /sessions/online` (encryptedSymmetricKey + IV) → `POST /sessions/online/{ref}/invoices/` (invoiceHash, encryptedDocumentHash, encryptedDocumentContent) → `POST /sessions/online/{ref}/close`.
- Status codes (full mapping table is an AC): `100/150` in-progress, `200` success, `210` expired, `410` gone, `445` **closed with zero valid invoices → failure, not success**, `5xx` error.
- KSeF number = 35-char `{NIP}-{RRRRMMDD}-{6}-{6}-{CC}` → neutral `clearanceReference`.
- UPO at `.../invoices/{invoiceRef}/upo` or `.../invoices/ksef/{ksefNumber}/upo`; session UPO `.../upo/{upoRef}`.

**FA(3) (C4/C7)**: namespace `http://crd.gov.pl/wzor/2025/06/25/13775/` (binding from 1 Feb 2026); `KodFormularza kodSystemowy="FA (3)" wersjaSchemy="1-0E"`, `WariantFormularza=3`. Pin to `schemat_FA(3)_v1-0E.xsd`. Sections `Naglowek · Podmiot1 · Podmiot2 · Fa · FaWiersz`; per-line `P_12` rate + GTU/Procedura at line level. Correction (`KOR`): `RodzajFaktury=KOR`, `PrzyczynaKorekty`, `TypKorekty`, `DaneFaKorygowanej` (orig date + number + `NrKSeF`, or `NrKSeFN=1` for non-KSeF originals).

**Neutral → PL mapping (C4, adapter-only)**: `TaxIdentifier.scheme` (`pl-nip`/`eu-vat`) → buyer ID choice (`NIP` / `KodUE`+`NrVatUE` / `KodKraju`+`NrID` / `BrakID=1`); `BuyerProfile.type` → BrakID; `InvoiceLine.taxRate` → `P_12` enum (`23/8/5/0 KR/0 WDT/0 EX/zw/oo/np`); ISO-4217 `currency` → `KodWaluty`.

**Internal patterns**: Erli plugin = lightweight skeleton reference; Subiekt `/testing` sub-barrel = fake-client + contract-suite reference; ADR-009 = reconciled-status reader; `webhook_deliveries` = idempotency-gate precedent (mirrored by #751's `(connectionId, idempotencyKey)` index).

---

## 5. Questions & Assumptions

### Open Questions (carried into the owning child's PLAN gate, not blocking the program)

1. **C1 ↔ #1121 seam** (the one genuinely cross-team decision): does `RegulatoryTransmitter extends RegulatoryStatusReader` (read half split out), or is it a single interface carrying both `submitForClearance` + `getClearanceStatus`? **Owner**: C1 PLAN agent, with #1121's author. **Default if unreachable**: single `RegulatoryTransmitter` with both methods (ADR-026's sketch); #1121's reconciliation job calls `getClearanceStatus` through the guard.
2. **C5 `upsertCustomer` semantics**: KSeF has no customer registry. **Assumption**: implement as a no-op/echo (return the input identity) in v1; document explicitly. A local buyer cache is deferred unless C8/C6 need it.
3. **C3 auth mode for v1**: **Assumption**: KSeF-token (RSA-OAEP) is the primary headless path; XAdES path is unit-covered but not the default connection wizard option. Trusted-Profile interactive flow is explicitly out (UI-only).
4. **Plugin-owned table?**: does KSeF need any persistence beyond core `InvoiceRecord` (e.g. cached MF public key, session reference parking)? **Assumption**: cache MF public key in `host.cache` (TTL from cert validity), no new table in v1. If a durable table proves necessary, it ships as a plugin-owned migration (C3 or C6 PLAN agent decides).
5. **C8 FE branch base**: #757/#758 (shared invoice panel) are soft deps. **Assumption**: C8 builds on whatever shared invoice-panel surface exists at its start; if absent, C8 ships the KSeF-specific affordances against the neutral `regulatoryStatus`/`clearanceReference` fields and a follow-up wires the generic panel.

### Assumptions

- The in-flight #1118 `InvoiceService` lands before C5 needs end-to-end wiring; until then C5's unit tests mock `InvoicingPort` + `IInvoiceService`. C5 does **not** block on #1118 for its own merge (adapter is independently unit-testable against `FakeKsefClient`).
- KSeF **test environment** credentials will be available for the optional `*.int-spec.ts` (C9) and the C3/C5/C6 "against test env" acceptance criteria. Where creds are absent, those specs **skip** (gated on env presence) and the fast `FakeKsefClient`-backed suite is the merge gate.
- Synthetic sequential migration timestamps (per `docs/migrations.md` #1013) apply to any plugin-owned migration.

### Documentation Gaps

- No in-repo KSeF API reference beyond the issue bodies + ADR-026 references; C3's PLAN agent must read the live OpenAPI spec. C10 closes the operator-facing gap.

---

## 6. Proposed Implementation Plan

### 6.1 The per-issue orchestration loop (the execution recipe every child runs through)

Each child C1–C10 is executed by an **orchestrator** (the main session) that drives a fixed sequence of **subagents**, with an independent **fixer** agent after each gate that surfaces problems, and a hard **STOP** at the end of the issue (commit + draft PR, then await the next issue). This is the loop the user mandated; it is defined once here and referenced per-child in §7.

```
PER ISSUE Cn:
  0. SETUP        orchestrator: stack branch on dependency (see §6.2), anchor all
                  subagents to ABSOLUTE repo paths under the worktree root.
  1. PLAN         1 agent  → produces the child's micro-plan (may be a full /plan doc
                            for L-effort children C3/C4; inline for S/M).
  2. PLAN REVIEW  panel of 3 (parallel) → architecture / contract-surface / reuse lenses.
                  → FIXER agent folds accepted findings into the plan.
  3. PLAN SECURITY panel of 3 (parallel) → secrets handling, crypto correctness,
                  PII/neutral-vocabulary leakage, auth-token lifetime.
                  → FIXER agent folds accepted findings into the plan.
  4. SKELETON     1 agent  → types, interfaces, file scaffold, failing/stub tests.
  5. SKELETON TECH-REVIEW  panel → naming, layer boundaries, ADR-026 litmus, exports.
                  → FIXER agent.
  6. IMPLEMENTATION 1 agent → fills the skeleton; writes real tests.
  7. FINAL        tech panel + security panel (parallel) + INDEPENDENT VERIFY.
                  → FIXER agent resolves blocking findings (loops with verify until green).
  8. STOP         orchestrator: commit (signed, §6.3) → push → draft PR (Closes #Cn).
                  Report only on transient/limit/decision-block; otherwise stay quiet
                  until the whole KSeF queue is done.
```

**Hard rules baked into every step** (from the user's mandate + repo conventions):

- **Hardcode values in the orchestration scripts, never via `args`.** REPO root, BRANCH, LABEL, the issue number, and `testFilters` are written literally into each step's prompt — `args` has been observed to arrive `undefined`.
- **Anchor subagents to absolute repo paths.** Every Read/Edit/Grep/Glob/Bash a subagent runs uses absolute paths under the worktree root `<worktree-root>/.claude/worktrees/<...>` (or the active implementation worktree). Shell cwd may differ — subagents must ignore it.
- **Guard null subagent results.** Transient `529 Overloaded` / spend-limit can return a null/empty agent result. Never dereference `result.field` without a `if (!result) { … }` guard; one dead agent must not abort the loop. On transient failure: `git reset --hard <base> && git clean -fd`, then **resume** (plan cache) or wait for the API to recover.
- **Independent green on STOP.** Verify is a *separate* agent (or the orchestrator) running, scoped to the touched package:
  ```bash
  pnpm --pm-on-fail=ignore --dir <REPO> lint        # includes check:invariants
  pnpm --pm-on-fail=ignore --dir <REPO> type-check
  pnpm --pm-on-fail=ignore --filter @openlinker/integrations-ksef test   # or the touched pkg
  ```
  **Never `--no-verify`.** `--pm-on-fail=ignore` is required because pnpm is pinned.
- **Stack branches on dependencies** (§6.2); retarget the PR base to `main` after the dependency merges.

**Panel sizing scales with effort**: S-children (C1, C10) may collapse the two 3-panels into single reviewers; L-children (C3, C4) keep full 3-panels and a full `/plan` doc at step 1. M-children use the loop as written.

### 6.2 Sequencing, parallelism & branch stacking

Critical path (from #1142, validated against the contract surface in §3):

```
C1 (#1143) ─┐
C2 (#1144) ─┴─► C3 (#1147) ─► C4 (#1148) ─► C5 (#1149) ─► C6 (#1150) ─► C7 (#1151)
C9-fake (#1153, FakeKsefClient half) ─┘ (hardens through C5/C6)        │
                                              C8 (#1152, FE) ──────────┘ (parallel once C5 lands)
C10 (#1154, docs) — last
```

**Wave 1 (parallel from day 1 — no inter-dependencies):**
- **C1** (#1143, CORE port+guard) — independent.
- **C2** (#1144, plugin skeleton) — independent (soft dep on C1 only to *also* surface the `RegulatoryTransmitter` sub-capability once it exists; skeleton can land first and C5 wires the guard).
- **C9-fake** (#1153, `FakeKsefClient` + contract-suite scaffold) — the fake-client half can start as soon as the `KsefHttpClient` *interface* exists (C2 ships the interface stub). Contract suite hardens through C5/C6.

These three run as **three concurrent orchestration loops** (separate worktrees/branches), since they touch disjoint files (`libs/core/src/invoicing` vs `libs/integrations/ksef` skeleton vs the `/testing` sub-barrel).

**Wave 2 (the long technical poles, mostly serial — shared files in the ksef package):**
- **C3** (#1147, auth/crypto, **L**) — blocked by C2. Longest pole.
- **C4** (#1148, FA(3) builder, **L**) — blocked by C2. **Can run in parallel with C3** (auth/crypto and XML-builder touch disjoint modules: `infrastructure/http`+`infrastructure/crypto` vs `infrastructure/fa3`). Two concurrent loops; stack both on C2.

**Wave 3 (assembly):**
- **C5** (#1149, issueInvoice) — blocked by C1 + C3 + C4. Stacks on whichever of C3/C4 merges last (or on a temporary integration branch carrying both).
- **C8** (#1152, FE) — starts in parallel **once C5 lands** the neutral issue result; uses C6's UPO ref when ready.

**Wave 4:**
- **C6** (#1150, clearance reader + UPO) — blocked by C5. Coordinate the single-poller seam with #1121.
- **C7** (#1151, KOR) — blocked by C4 + C5. **Can run in parallel with C6** (KOR extends the FA(3) builder + reuses C5 send; C6 is the read path — disjoint).

**Wave 5:**
- **C10** (#1154, docs) — last, after C5/C6/C8 so the documented flow matches reality.

**Branch stacking rule**: each child branches from its dependency's branch (PR `base` = dependency branch). When a dependency PR merges to `main`, **retarget** the dependent PR's base to `main` (`gh pr edit <n> --base main`) and rebase. Independent Wave-1 children branch directly from `main`.

Branch names (per repo convention `{issue}-{kebab}`):
`1143-regulatory-transmitter-port`, `1144-ksef-plugin-skeleton`, `1147-ksef-auth-session-crypto`, `1148-fa3-xml-builder`, `1149-ksef-issue-invoice-adapter`, `1150-ksef-clearance-upo-reader`, `1151-ksef-kor-corrections`, `1152-web-ksef-connection-upo`, `1153-fake-ksef-client-contract-tests`, `1154-docs-ksef-guide`.

### 6.3 Commit + rotating GPG signing

Every commit is DCO-signed **and** GPG-signed. The GPG passphrase is **rotating and supplied out-of-band by the user during the session** — it is **never** persisted (not to memory, not to a file, not into commit text); it is consumed only through `$GPG_PASSPHRASE` at the moment of commit.

Headless signing wrapper (written once into the scratchpad, contains no secret):
```bash
# gpg-loopback.sh
#!/usr/bin/env bash
exec gpg --batch --pinentry-mode loopback --passphrase "$GPG_PASSPHRASE" "$@"
```
Commit (message via file to avoid shell-escaping; `-S` only if the repo rejects unsigned — in OL `-s` DCO usually suffices but KSeF PRs sign both):
```bash
GPG_PASSPHRASE='<supplied-in-session>' git -c gpg.program=<scratchpad>/gpg-loopback.sh \
  commit -s -S -F <scratchpad>/commit-msg.txt
```
The pre-commit hook runs the full gate (lint incl. `check:invariants` + type-check); it is the belt to the independent-verify suspenders. **Never bypass it.**

### 6.4 Per-child file footprints (what each loop creates/touches)

- **C1** — `libs/core/src/invoicing/domain/ports/capabilities/regulatory-transmitter.capability.ts` (+ `is*` guard, co-located), `libs/core/src/invoicing/domain/types/invoicing.types.ts` (extend if a transmitter result type is needed — neutral only), barrel `libs/core/src/invoicing/index.ts`. Spec for the guard (positive + negative narrowing). **No token.**
- **C2** — new package `libs/integrations/ksef/` mirroring `erli`: `package.json` (with `.` and `./testing` exports), `tsconfig`, `jest.config.mjs`, `src/ksef.constants.ts`, `src/ksef-plugin.ts` (`createKsefPlugin` + `ksefAdapterManifest` `{adapterKey:'ksef.publicapi.v2', platformType:'ksef', supportedCapabilities:['Invoicing'], isDefault:true}`), `src/ksef-integration.module.ts` (`createNestAdapterModule`), `src/index.ts`, `src/testing.ts` (placeholder), `infrastructure/http/ksef-http-client.interface.ts` (stub), `infrastructure/adapters/ksef-connection-config-shape-validator.adapter.ts` + `...credentials-shape-validator.adapter.ts` + specs, stub `KsefInvoicingAdapter`. Host edits: `apps/api/src/plugins.ts`, `apps/worker/src/plugins.ts`, **and both `test/jest-integration.cjs` mapper entries** (testing-guide #917 — the guard prints the two lines).
- **C3** — `infrastructure/http/ksef-http-client.ts` (real), `infrastructure/crypto/*` (RSA-OAEP, AES-256-CBC, key-wrap, MF public-key fetch+cache), `infrastructure/auth/*` (challenge→redeem→refresh, KSeF-token + XAdES paths), domain exceptions, types files, specs incl. known-vector crypto round-trip.
- **C4** — `infrastructure/fa3/fa3-builder.ts` (pure), `infrastructure/fa3/p12-tax-code.map.ts`, neutral→PL mapping, XSD assets + XSD validation, specs incl. full `P_12` table + MF example-pack checks.
- **C5** — `infrastructure/adapters/ksef-invoicing.adapter.ts` (`implements InvoicingPort`, declares `isRegulatoryTransmitter`), session open/send/close orchestration, neutral result mapping, `445`-as-failure, idempotency honoured. Specs against `FakeKsefClient`.
- **C6** — `getClearanceStatus` on the adapter, status-code→`RegulatoryStatus` table, KSeF-number capture → `clearanceReference`, UPO fetch + stable ref. Coordinate single-poller with #1121. Specs incl. `445`/`210`.
- **C7** — extend C4 builder for `KOR` (`RodzajFaktury`, `DaneFaKorygowanej`, `TypKorekty`, before/after lines), adapter path for `documentType:'corrected'` resolving the original `clearanceReference`. Specs incl. XSD-valid KOR referencing a prior KSeF number.
- **C8** — `apps/web/src/plugins/ksef/index.ts` (`definePlugin`: env selector, NIP/context, auth-type, write-only secret, optional test-connection), invoice-panel UPO download + KSeF-number/`regulatoryStatus` display (capability-gated), `plugins/index.ts` registration, route/breadcrumb if any. Vitest + Testing Library tests.
- **C9** — `src/testing/fake-ksef-client.ts` (in-memory state machine: submit→in-progress→accepted/rejected, deterministic KSeF numbers, canned UPO, seedable `445`/`210`/rejection), `src/testing/ksef-client-contract.suite.ts` (run against fake; against real when creds present), `src/testing.ts` barrel export, optional `test/*.int-spec.ts` env-gated.
- **C10** — `docs/integrations/ksef.md`, links from the docs index/capability matrix, a short `docs/architecture-overview.md` note (KSeF = first `RegulatoryTransmitter` provider), ADR-026 amendment note iff C1 diverged.

**Events**: none new — KSeF rides the existing sync-job/status-snapshot machinery; reconciliation scheduling is #1121's job, not this epic's.

**Error handling**: plugin-local domain exceptions (`KsefAuthException`, `KsefSessionException`, `KsefClearanceRejectedException`, …) mapped to the host's auth-failure / retry classifiers via `register(host)`; `445` → business failure, not success; terminal rejection → `regulatoryStatus:'rejected'` surfaced as a neutral outcome. No KSeF strings cross into core.

---

## 7. Per-Child Execution Notes

Each child runs the §6.1 loop. Below: only the issue-specific deltas (panel emphasis, the one decision to resolve, the verify scope).

### C1 — #1143 RegulatoryTransmitter port + guard (CORE, S) — Wave 1, branch from `main`
- **Decision to resolve at PLAN**: the #1121 seam (Q1 §5). This is the only child with a genuine cross-team contract choice — the PLAN agent must read #1121 and decide `extends` vs single-interface; record a one-line ADR-026 amendment iff divergent.
- **Security panel emphasis**: neutral-vocabulary litmus (no `ksef`/`upo`/`nip`); guard cannot leak provider types.
- **Verify**: `pnpm --filter @openlinker/core test` scoped to invoicing + `check:invariants` (cross-context); the neutral-vocabulary litmus is a separate reviewer/`grep` gate (not part of `check:invariants` today — see §2).
- May collapse panels to single reviewers (S-effort).

### C2 — #1144 plugin skeleton + manifest + validators (Integration, M) — Wave 1, branch from `main`
- **Tech panel emphasis**: package mirrors `erli` exactly; `ksefAdapterManifest` identical to the runtime descriptor's `manifest`; **no `@openlinker/core/*` deep imports** (`check:invariants` cross-context); the two host `plugins.ts` edits + the two `jest-integration.cjs` mapper lines per host (#917 guard prints them).
- **Security panel emphasis**: credentials-shape validator rejects malformed auth-type/secret-ref; config validator on env (`test`/`demo`/`prod`) + seller NIP + context id.
- **Verify**: `pnpm --filter @openlinker/integrations-ksef test` + API/worker boot smoke (type-check) + `check:invariants`.

### C3 — #1147 auth & session crypto (Integration, L) — Wave 2, stack on C2
- **Step 1 produces a full `/plan` sub-doc** (L-effort) — read the live OpenAPI spec; decide the reusable-CTC-pattern ADR (Q §3, may draft a Proposed ADR).
- **Security panel is the heaviest gate of the whole program**: RSA-OAEP (MGF1+SHA-256) correctness, AES-256-CBC/PKCS#7, key-wrap, **no secrets logged**, credentials only via `host.credentialsResolver`, JWT `exp`-driven refresh (no hardcoded lifetimes), MF cert rotation (no hardcoded cert), OCSP/CRL poll-don't-assume on auth status.
- **Verify**: crypto round-trip against known vectors must pass in the fast suite; test-env auth behind env-gate.
- Runs **parallel with C4** (disjoint modules).

### C4 — #1148 FA(3) builder + XSD (Integration, L) — Wave 2, stack on C2
- **Step 1 produces a full `/plan` sub-doc** (L-effort).
- **Tech panel emphasis**: builder is **pure** (no I/O); namespace + schema version pinned; full `P_12` map; per-line GTU/Procedura placement; PL-buyer NIP lands in `NIP`, B2C → `BrakID`; XSD + MF example-pack validation before return.
- **Security panel emphasis**: neutral inputs only; no injection via XML string interpolation (build via a DOM/serializer, escape values).
- **Verify**: XSD validation in-suite; `pnpm --filter @openlinker/integrations-ksef test`.
- Runs **parallel with C3**.

### C5 — #1149 issueInvoice adapter (Integration, M) — Wave 3, stack on C3+C4
- **Tech panel emphasis**: `implements InvoicingPort` + declares `isRegulatoryTransmitter`; persists **only via #1118 `InvoiceService`**, never the repo directly; `445` = failure; idempotency honoured (no double-send on retry); neutral result only (no `ksef`/`upo` leakage).
- **Security panel emphasis**: idempotency-key handling; no secret/PII in logs or results.
- **Verify**: against `FakeKsefClient`; test-env e2e behind env-gate.

### C6 — #1150 clearance reader + UPO (Integration, M) — Wave 4, stack on C5
- **Decision to resolve at PLAN**: single-poller boundary with #1121 (don't double-poll). Document it; if #1121 absorbs the adapter scope, fold and close as duplicate.
- **Tech panel emphasis**: full status-code→`RegulatoryStatus` table (incl. `445`/`210`); 35-char KSeF number → `clearanceReference`; UPO stable ref persisted for C8.
- **Verify**: poll a submitted test-env invoice to `accepted` behind env-gate; mapping table in fast suite.
- Runs **parallel with C7**.

### C7 — #1151 KOR corrections (Integration, M) — Wave 4, stack on C4+C5
- **Tech panel emphasis**: extends C4 builder (`RodzajFaktury=KOR`, `DaneFaKorygowanej` with original `NrKSeF`, `TypKorekty`, before/after lines); adapter resolves original from neutral command's reference to the prior `InvoiceRecord.clearanceReference`; no KSeF strings in core.
- **Verify**: XSD-valid KOR referencing a prior test invoice's KSeF number behind env-gate.
- Runs **parallel with C6**.

### C8 — #1152 FE connection + UPO surfacing (Frontend, M) — Wave 3+, parallel after C5
- **Tech panel emphasis**: registry-driven `OpenLinkerPlugin` (no `platformType==='ksef'` in shared UI — ESLint `no-restricted-syntax`); secret write-only; capability-gated panel affordances; mobile/tablet layouts.
- **Security panel emphasis**: secret never echoed back; no secret in browser bundle (only `VITE_*` public vars allowed).
- **Verify**: `pnpm --filter @openlinker/web lint && type-check && test` (Vitest). FE plugin dedupe check at `plugins/index.ts`.

### C9 — #1153 FakeKsefClient + contract suite (Testing, M) — Wave 1 (fake half), hardens through C5/C6
- **Tech panel emphasis**: fake on the `@openlinker/integrations-ksef/testing` sub-barrel (Subiekt `/testing` precedent); contract suite asserts fake **and** real client satisfy the same behavioural contract; failure-mode coverage (`445`, expiry/`210`, rejection, refresh-on-`exp`); optional `*.int-spec.ts` env-gated.
- **Verify**: `pnpm test` green **with no network**; the fast suite is the merge gate for C5/C6/C7.

### C10 — #1154 docs (Docs, S) — Wave 5, last
- Setup steps validated against test env; explicit limitations (B2C/batch/inbound out); async submit→poll→UPO model; `regulatoryStatus` meaning; mandate dates; Art. 108g note as future.
- **Verify**: `pnpm lint` (format) — docs-only, no test scope.
- May collapse panels (S-effort).

---

## 8. Alternatives Considered

### Alt 1: One mega-PR for the whole KSeF adapter
- **Rejected**: the epic deliberately decomposed into C1–C10 for reviewability and to parallelize the two L-poles (C3 auth/crypto, C4 FA(3)). A 6-week mega-PR is unreviewable and serializes work that is naturally concurrent. Trade-off: more PR ceremony, but each PR independently green and revertable.

### Alt 2: Skip the per-issue multi-agent loop; single implementer per issue
- **Rejected by the user's mandate** — but also justified: KSeF's crypto (C3) and XSD-correctness (C4) are exactly the high-consequence, easy-to-get-subtly-wrong surfaces where an adversarial security panel + independent verify earns its cost. Lighter children (C1, C10) collapse the panels, so the overhead is paid where it matters.

### Alt 3: Put `RegulatoryTransmitter` in the KSeF package (avoid the CORE touch)
- **Rejected**: it's the neutral seam every clearance regime (KSeF/SDI/SII) maps onto; ADR-026 explicitly anticipated it in core and pre-shipped its persistence columns. Burying it in the KSeF plugin would force the next regime to re-invent it and would re-introduce provider coupling.

### Alt 4: Make C6 own the reconciliation scheduling too
- **Rejected**: #1121 already owns the scheduler/worker job. C6 is the adapter the job calls; doubling the poller risks racing two readers against KSeF. The C1/C6 PLAN agents lock the single-poller seam with #1121's author.

---

## 9. Validation & Risks

### Architecture Compliance
- ✅ Hexagonal: C1 adds a domain-layer capability port + guard; adapters (C2–C7) implement ports; no domain→infra dependency.
- ✅ CORE↔Integration boundary: only C1 touches core, neutrally; KSeF specifics confined to the plugin (ADR-026 litmus).
- ✅ Plugin contract: `AdapterPlugin` + `createNestAdapterModule` + `dispatchCapability` (Erli precedent); host registration is the single-edit-point `plugins.ts` in both apps.

### Naming Conventions
- ✅ `*.capability.ts` for C1; `{System}{Capability}Adapter` = `KsefInvoicingAdapter`; `*.adapter.ts`/`*.port.ts`/`*.types.ts`/`*.spec.ts` throughout; adapterKey `ksef.publicapi.v2`.

### Risks
- **R1 — C3 crypto correctness (highest).** RSA-OAEP/AES params, cert rotation, token lifetimes. **Mitigation**: known-vector round-trip tests in the fast suite; heaviest security panel; XAdES unit-covered with self-signed cert.
- **R2 — #1121 double-polling / seam drift.** **Mitigation**: resolve the seam in C1 *and* C6 PLAN gates with #1121's author; document the single poller.
- **R3 — FA(3) XSD/namespace drift** (binding 1 Feb 2026). **Mitigation**: pin `schemat_FA(3)_v1-0E.xsd`; validate against MF example pack; full `P_12` table test.
- **R4 — Resource/transient failures on a constrained runner** (OOM on full-repo tests; 529/spend-limit on agents). **Mitigation**: package-scoped test runs only; null-guard every subagent result; `git reset --hard <base> && clean -fd` + resume on transient; small panel batches.
- **R5 — Branch-stack rebase pain** as dependencies merge. **Mitigation**: retarget base to `main` + rebase immediately on each dependency merge; keep children small.
- **R6 — Secret leakage** (GPG passphrase, KSeF credentials). **Mitigation**: passphrase only via `$GPG_PASSPHRASE` at commit time, never persisted; credentials via `host.credentialsResolver`; security panel checks logs/results/bundle.
- **R7 — `migration:generate` real-epoch timestamp** if any plugin table emerges. **Mitigation**: re-prefix to the next synthetic sequential timestamp per `docs/migrations.md` #1013 before commit; `check:invariants` enforces.

### Edge Cases
- `445` closed-zero-valid-invoices → failure (C5/C6). `210` expired / `410` gone (C6). Non-KSeF original on correction → `NrKSeFN=1` (C7). B2C no-NIP → `BrakID` (C4). Idempotent retry → no double-send (C5). Cert rotation mid-session (C3).

### Backward Compatibility
- ✅ No core schema change (columns pre-shipped #751). C1 adds an optional capability — adapters that don't implement the guard are unaffected. New plugin is additive; hosts opt in via `plugins.ts`.

---

## 10. Testing Strategy & Acceptance Criteria

### Unit Tests (the merge gate for every child — fast, no network)
- C1: guard positive/negative narrowing.
- C3: RSA-OAEP + AES-256-CBC round-trip vs known vectors; refresh-on-`exp`; XAdES sign with self-signed cert.
- C4: full `P_12` map; per-line GTU/Procedura; NIP-vs-BrakID; XSD validity.
- C5: issue happy path, `445`-as-failure, idempotent replay — all against `FakeKsefClient`.
- C6: full status-code→`RegulatoryStatus` table incl. `445`/`210`; KSeF-number parse; UPO ref.
- C7: XSD-valid KOR referencing a prior KSeF number.
- C8: Vitest + Testing Library — connection form, capability-gated panel, UPO download.
- C9: `FakeKsefClient` state machine + the contract suite itself.

### Integration Tests (env-gated — skip without test-env creds)
- C3/C5/C6/C7 "against test environment" ACs run as `*.int-spec.ts` gated on KSeF test-env credential presence; skip otherwise (documented why per testing-guide worker-int-spec note). C9 ships the optional thin int-spec.

### Mocking Strategy
- Unit: mock `InvoicingPort` / `IInvoiceService` / `KsefHttpClient` (via `FakeKsefClient`). Never hit the real network in the fast suite.
- Contract suite (C9): same assertions against fake and (when creds present) real client — guards drift.

### Program-level Acceptance Criteria
- [ ] All ten children merged, each as its own signed (DCO + GPG) draft→merged PR with `Closes #N`.
- [ ] Epic #1142 closes when all children merge.
- [ ] `pnpm lint` (incl. `check:invariants`: cross-context, service-interface, jest-integration mappers, migration timestamps) + `type-check` green on each PR.
- [ ] Zero `nip`/`ksef`/`vat`/`jpk`/`faktura`/`upo` strings in `libs/core` (ADR-026 litmus) — verified by reviewers + a `grep` over `libs/core` (a reviewer/grep gate, **not** a `check:invariants` sub-check today; automating it is a tracked follow-up per §2).
- [ ] `pnpm --filter @openlinker/integrations-ksef test` green with no network.
- [ ] API + worker boot with the KSeF plugin enabled.
- [ ] A `VAT` invoice issues + clears to `accepted` against the test env (env-gated); a `KOR` references a prior KSeF number; UPO downloads from the FE.

---

## 11. Alignment Checklist

- [x] Follows hexagonal architecture (C1 port+guard in domain; adapters implement ports).
- [x] Respects CORE vs Integration boundaries (only C1 in core, neutral; ADR-026 litmus enforced).
- [x] Uses existing patterns (Erli plugin skeleton, Subiekt `/testing` sub-barrel, ADR-009 reconciled status, `dispatchCapability`, `createNestAdapterModule`) — no new abstractions invented.
- [x] Idempotency considered (#751 `(connectionId, idempotencyKey)` gate via #1118; `445`-as-failure; no double-send).
- [x] Event-driven / reconciliation patterns used where applicable (status-snapshot poll model; scheduling delegated to #1121).
- [x] Rate limits & retries addressed (hand-rolled client with backoff; auth-failure/retry classifiers registered via `host`).
- [x] Error handling comprehensive (plugin-local domain exceptions; neutral outcomes; classifier registration).
- [x] Testing strategy complete (fast unit gate + env-gated int-specs + drift-guarding contract suite).
- [x] Naming conventions followed (§9).
- [x] File structure matches standards (§6.4 footprints mirror `erli`/`subiekt`/core invoicing).
- [x] Plan is execution-ready (per-child loop, sequencing, stacking, signing, verify all specified).
- [x] Plan saved as markdown file.

---

## Related Documentation

- [ADR-026 — Country-agnostic invoicing domain with capability decomposition](../architecture/adrs/026-country-agnostic-invoicing-domain.md) (the governing seam)
- [ADR-002 — Capability ports with sub-capabilities](../architecture/adrs/002-capability-ports-with-sub-capabilities.md) (the `is{Capability}` guard pattern C1 follows)
- [ADR-009 — Persisted offer-status snapshots](../architecture/adrs/009-persisted-offer-status-snapshots.md) (reconciled-status precedent for C6)
- [Architecture Overview](../architecture-overview.md) · [Engineering Standards](../engineering-standards.md) · [Testing Guide](../testing-guide.md) · [Migrations](../migrations.md) · [Frontend Architecture](../frontend-architecture.md)
- Epic #1142; children #1143/#1144/#1147/#1148/#1149/#1150/#1151/#1152/#1153/#1154; coordination #1118/#1119/#1120/#1121
- KSeF: OpenAPI `https://api-test.ksef.mf.gov.pl/docs/v2/openapi.json` · dev docs `https://github.com/CIRFMF/ksef-api` · FA(3) `http://crd.gov.pl/wzor/2025/06/25/13775/`
