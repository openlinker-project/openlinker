# Implementation Plan: Subiekt Bank-Account/Payment-Method + Oddział/Stanowisko Kasowe Per Invoice (Part A + Part B)

**Date**: 2026-07-02 (revised same day after `/grill-me`)
**Status**: Ready for implementation
**Estimated Effort**: 3–4 days (implementation, Part A + Part B) + 0.5 day (live verification)
**Issue**: [#1324](https://github.com/openlinker-project/openlinker/issues/1324)

**Revision note**: this plan originally covered Part A only (payment method + bank account). Following a `/grill-me` session on 2026-07-02, eight decisions were made that fold Part B (Oddział/Stanowisko Kasowe, backed by the now-merged and live-verified `openlinker-subiekt-bridge#5`/PR#6) into this same plan and PR, and correct an internal contradiction discovered during the interview (Part A's original Step 12 planned to reuse the generic `useBankAccountsQuery` hook, but the approved mockup requires owner-aware data that hook doesn't carry). See §0.1 for the full decision log.

---

## 0. Prerequisite State (read this first)

This plan does **not** start from `origin/main`. Three prerequisite PRs are merged **locally only** (no GitHub merge, no push) into two integration worktrees created for this work:

| Repo | Worktree | Branch | Contents |
|---|---|---|---|
| `openlinker` (this monorepo) | `.claude/worktrees/1324-prereqs-integration` | `1324-prereqs-integration` | PR #1300 (inFakt FE plugin) + PR #1309 (`defaultPaymentMethod` per-connection) + PR #1310 (`BankAccountsReader`/`BankAccountDefaultSetter` core capabilities + `infakt-structured-section.tsx` pattern). Verified: `pnpm --filter @openlinker/integrations-infakt test` 135/135, `pnpm --filter @openlinker/web test` 1952/1952, both type-check clean. |
| `openlinker-subiekt-bridge` | `~/projekty/blocky/openlinker-subiekt-bridge` (main clone, branch `3-bank-account-multi-podmiot`) | `3-bank-account-multi-podmiot` | **Updated 2026-07-02**: bridge PR #2 (bank accounts/payment) + PR #4 (multi-Podmiot fix, `openlinker-subiekt-bridge#3`) + PR #6 (Oddział/Stanowisko Kasowe selector, `openlinker-subiekt-bridge#5`) — all three **still open on GitHub** (like the OL prereqs), but the work is present + live-verified on this branch, which is the current tip. `GET /api/branches`, `GET /api/cash-registers`, and `oddzialId`/`stanowiskoKasoweId` on `POST /api/invoices` are verified end-to-end against `Nexo_Demo_1` (real Sfera, via PowerShell-from-WSL, this same machine). Tests green. |

**This plan's implementation branch starts from the openlinker `1324-prereqs-integration` branch**, not `origin/main` — that is the only place `BankAccountsReader`, `BankAccountDefaultSetter`, and the inFakt reference pattern actually exist right now. When #1300/#1309/#1310 eventually merge to `main` for real, this branch should be rebased onto `main` before opening its own PR (the diff will shrink to just the Subiekt-specific commits).

The plan-authoring worktree itself lives at `.claude/worktrees/1324-subiekt-bank-account-plan` (branched from local `1324-prereqs-integration`), carrying only this plan document — implementation happens in a **separate** worktree/branch per the Setup section of `/plan`, also based on `1324-prereqs-integration`.

### 0.1 `/grill-me` Decision Log (2026-07-02)

Eight decisions, made in order, that supersede parts of the original (Part-A-only) plan below. Where a later section still shows the pre-grill reasoning, this log is authoritative.

1. **Part B is folded into this plan and this PR**, not a separate follow-up. Rationale: the approved combined mockup (`subiekt-full-config-section.html`) already presents Part A+B as one section; splitting into two PRs touching the same files would only create merge risk, not reduce it. Bridge PR #6 is merged and live-verified, so there's no dependency reason to wait either.
2. **No new core capability for Part B.** `listBranches()`/`listCashRegisters()` stay Subiekt-local (on `SubiektBridgeClient` + a Subiekt-specific controller/hook) — inFakt/KSeF have no branch concept, so a `BranchAwareIssuer`-style core port would be a speculative abstraction with one consumer, same reasoning `docs/engineering-standards.md` already argues against.
3. **New backend file: `apps/api/src/integrations/http/subiekt.controller.ts`**, modeled on the existing plugin-specific-endpoint precedent at `apps/api/src/integrations/http/allegro.controller.ts` (e.g. its `GET integrations/allegro/connections/:id/responsible-producers` route, which is Allegro-only with no core capability behind it — same shape as this issue's need). Routes: `GET integrations/subiekt/connections/:id/branches`, `GET integrations/subiekt/connections/:id/cash-registers`, and (per decision 6) `GET integrations/subiekt/connections/:id/bank-accounts` (owner-aware variant).
4. **Cash-register filtering by branch is client-side.** The adapter/controller still expose `listCashRegisters()` unfiltered (matching the bridge's full capability); the FE fetches once and filters locally when the operator changes the Oddział select, rather than round-tripping per selection change. Data volume is small (single digits to low tens of registers) and static within one form-edit session.
5. **Payer-routing limitation gets an explicit, dated sign-off, not a silent doc footnote.** Recorded here: **the user has reviewed and accepted, on 2026-07-02, that OpenLinker cannot guarantee a picked bank account's owning Podmiot matches the invoice's actual issuing payer on a genuinely multi-Podmiot install** (distinct from the Oddział axis, which Part B does close). This is a real fiscal-data-adjacent risk (wrong bank details potentially associated with the wrong legal entity's invoice), accepted as an MVP limitation with the explicit UI mitigation in decision 6 rather than silently shipped.
6. **Corrects a contradiction found during the interview**: Part A's original Step 12 planned to reuse the generic, cross-plugin `useBankAccountsQuery` hook (core-shaped `InvoicingBankAccount`, no owner field) — but the already-approved mockup groups accounts by owner (`<optgroup label="Moja Firma Sp. z o.o.">`), which that hook cannot supply without widening the neutral core type (rejected, would leak Subiekt vocabulary into `libs/core`, also used by inFakt). **Resolution**: Subiekt's structured section uses its own Subiekt-specific hook (`use-subiekt-bank-accounts-query.ts`) against the new controller's owner-aware endpoint (decision 3), not the generic core-capability hook. The generic `BankAccountsReader`/`BankAccountDefaultSetter` core-capability implementation on the adapter is **still built** (issue's Acceptance Criteria require it, and it's a legitimate seam for any future generic consumer) — it's just not what Subiekt's own FE happens to render from. The FE computes `distinct(ownerPodmiotId).length > 1` from the owner-aware endpoint's response and renders the payer-routing warning **only when true**, not unconditionally on every install.
7. **Orchestration units re-sequenced** (see §10) to avoid parallel edits to the same files now that Part B touches the same files as Part A, and to reflect the new controller's dependency on the adapter: **A, B parallel → C → E (new controller) → D (FE) → quality gate → E2E**. D is no longer independent of the backend units, since it needs E's endpoints for the new Subiekt-specific hooks.
8b. **(Added 2026-07-03, mid-implementation) Part B narrows to Stanowisko Kasowe only — the Oddział axis is cut.** A live bridge investigation found that `IKontekstBiznesowy` (the Sfera session's business context) binds **Oddział / Magazyn / StanowiskoKasowe / RachunekBankowy / Podmiot as read-only to the logged-in session** ("Szef" → Oddział=Centrala 100000, Stanowisko=100065, Rachunek=100004, Podmiot=100007). A per-request `oddzialId` cannot override the session's branch — Sfera compares the document's `JednostkaOrganizacyjna`/`StanowiskoKasowe` **entity nav-references** against the session context and rejects a mismatch (both the post-create patch and `ParametryTworzeniaDokumentu`-at-create paths fail identically). To issue under a different Oddział, the bridge would have to log in as a different Subiekt user with a different default workstation — impossible under the current single-fixed-session bridge model. **Consequences, per user direction:**
   - **Oddział selector is cut entirely** — from the FE (don't even show it read-only, it would only mislead), from `SubiektConnectionConfig` (`defaultOddzialId` removed), from the adapter's `issueInvoice` field-stamping, and from discovery (no `listBranches()`, no `GET .../branches` controller route). OL never sends `oddzialId`.
   - **Stanowisko Kasowe IS kept as a real, working per-document field.** Unlike Oddział, `stanowiskoKasoweId` alone is accepted by the bridge and genuinely routes the document through that register (this is why bridge PR #6 was narrowed to `stanowiskoKasoweId` as the real field). The FE keeps a functional Stanowisko Kasowe `<Select>`, with one help line: "faktura zawsze wystawiana z oddziału Centrala — most nie obsługuje przełączania oddziału."
   - **Part A (bank account) is NOT affected** — `RachunekBankowyMojejFirmy` is written as a descriptive `{Nazwa, Numer}` **snapshot** on the document (plain strings, explicitly "not an FK"), not an entity reference matched against the session context. It's a copy, so a different account than the session default writes fine. This is the mechanism issue #1 originally live-verified (transfer with account 100007). Optional: a quick live re-test (transfer with an account ≠ 100004) in the §11 verification would confirm 100%, but the architectural difference (descriptive copy vs. session-matched entity ref) is a strong enough signal to treat Part A as safe.
   - **Client-side "filter registers by branch" (old decision 4) is moot** — with no Oddział selector there's nothing to filter by; the register picker just lists all registers. Each register's own `oddzialId` tag may still be shown as an informational label.

8. **Live verification is two-track, not one heavyweight PrestaShop flow**: (a) OpenLinker-side screenshots are visual-only (connection edit form renders correctly, live data populates the selects) — no requirement to drive a full order-to-invoice flow through the OL UI; (b) functional proof (payment method / bank account / Oddział / Stanowisko Kasowe actually reach Subiekt and produce the expected document) is done by **calling the bridge API directly** (as already demonstrated this session via PowerShell-from-WSL against `Nexo_Demo_1`), issuing **several real invoices with different configurations** (cash/no-branch; transfer+account; branch+register matching; branch-without-register rejected; mismatched branch/register rejected) and confirming each resulting document's actual payment/branch/register data matches what was configured — not just that the HTTP call returned 200.

---

## 1. Task Summary

**Objective**: Give the Subiekt invoicing adapter the same bank-account/payment-method-per-invoice capability inFakt already has — an operator picks a default payment method (`cash`/`transfer`) and, for transfer, a specific seller bank account, per Subiekt connection. The choice is threaded into every issued invoice.

**Context**: The Subiekt bridge (`openlinker-subiekt-bridge` PR #2) now exposes `GET /api/bank-accounts`, accepts optional `paymentMethod`/`bankAccountId` on `POST /api/invoices`, and exposes `PUT /api/bank-accounts/{id}/default`. OpenLinker's `SubiektInvoicingAdapter` doesn't consume any of it yet. The identical shape was already solved for inFakt (#1303/#1308): two core capabilities (`BankAccountsReader`, `BankAccountDefaultSetter`), capability-generic API endpoints, and an FE structured-config pattern. This work reuses all three verbatim for Subiekt — no new core ports.

**Classification**: Integration (bridge client + adapter) + Frontend (structured-config section). No CORE changes — `BankAccountsReader`/`BankAccountDefaultSetter` already exist in `libs/core/src/invoicing/domain/ports/capabilities/` from #1310.

---

## 2. Scope & Non-Goals

### In Scope

**Part A — payment method / bank account:**
- `BridgeIssueInvoiceRequest` gains optional `paymentMethod`/`bankAccountId`.
- `SubiektBridgeClient` (+ HTTP impl + fake) gains `listBankAccounts()` / `setDefaultBankAccount(id)`.
- `SubiektConnectionConfig` gains `defaultPaymentMethod?: 'cash' | 'transfer'` and `bankAccountId?: number`.
- `SubiektInvoicingAdapter implements BankAccountsReader, BankAccountDefaultSetter` (generic core capabilities, built for the API's own capability-generic surface — decision 6) in addition to its existing `InvoicingPort, RegulatoryStatusReader, CorrectionIssuer`.
- `SubiektInvoicingAdapter.issueInvoice` sends the configured payment fields when set.

**Part B — Oddział (branch) / Stanowisko Kasowe (cash-register station), added after `/grill-me` (decision 1):**
- `BridgeIssueInvoiceRequest` gains optional `oddzialId`/`stanowiskoKasoweId`.
- `SubiektBridgeClient` (+ HTTP impl + fake) gains `listBranches()` / `listCashRegisters()` proxying `GET /api/branches` / `GET /api/cash-registers`.
- `SubiektConnectionConfig` gains `defaultOddzialId?: number` / `defaultStanowiskoKasoweId?: number`.
- No new core capability (decision 2) — these stay Subiekt-local methods on the adapter, not implementing any `libs/core` port.

**Shared backend + frontend (Part A and B together):**
- New file `apps/api/src/integrations/http/subiekt.controller.ts` (decision 3) exposing `GET .../branches`, `GET .../cash-registers`, and an owner-aware `GET .../bank-accounts` (decision 6) — none of these are capability-generic, all are Subiekt-only routes resolving the concrete adapter.
- FE: extend the **existing** `apps/web/src/plugins/subiekt/components/subiekt-structured-section.tsx` with one combined `InlineDisclosure` covering payment method, bank account (grouped by owning Podmiot, with a conditional payer-routing warning per decision 5/6), Oddział, and Stanowisko Kasowe (client-side filtered by Oddział, decision 4) — following the approved `subiekt-full-config-section.html` mockup's five states.
- New Subiekt-specific FE hooks (`use-subiekt-bank-accounts-query.ts`, `use-subiekt-branches-query.ts`, `use-subiekt-cash-registers-query.ts`) calling the new controller — **not** the generic `useBankAccountsQuery`/`useSetDefaultBankAccountMutation` (decision 6 correction).
- Tests: adapter unit tests (Part A + B), bridge HTTP client unit tests, fake-adapter parity, new controller unit tests, FE component tests, `subiekt-adapter.factory.spec.ts` config-parsing coverage for all four new config fields.
- Live verification, two-track per decision 8: OL-side screenshots (visual only) + direct bridge-API functional verification issuing several real invoices with different configurations.

### Out of Scope
- `SubiektInvoicingAdapter.issueCorrection` does **not** get payment fields — see [§4 Wire-contract correction](#wire-contract-correction-vs-the-issue-text) below: the bridge's korekta endpoint (`POST /api/invoices/{id}/corrections`) does not accept `paymentMethod`/`bankAccountId`/`oddzialId`/`stanowiskoKasoweId` at all (confirmed for Part A's fields against the bridge source; Part B's fields follow the same contract, only added to `CreateInvoiceRequestDto`). Sending them would be silently ignored at best; the plan simply never builds them into the korekta request.
- No changes to `InvoicingController` (the generic, capability-driven controller) — Part A's `GET/POST .../bank-accounts...` routes there are already capability-generic (added by #1310) and light up automatically. Part B and the owner-aware bank-accounts variant deliberately do NOT go there (decisions 2, 3, 6) — they live on the new Subiekt-only controller instead.
- No change to `documentType: 'PA'` (paragon) handling — the bridge rejects payment selection for PA, and the current adapter's `issueInvoice` path doesn't special-case PA either; not exercised by this change.
- Fixing the pre-existing `subiektBridgeUrl` FE/BE config-key mismatch (see Assumptions) — noted, not touched, unrelated to this issue.
- Merging any of the three openlinker prerequisite PRs (#1300/#1309/#1310) to GitHub — stays purely local per explicit instruction. (Bridge-side PRs #2/#4/#6 are a different repo and are already genuinely merged — see §0.)
- A full PrestaShop-order-to-invoice E2E flow — decision 8 replaces this with direct bridge-API functional verification; PrestaShop dev-stack is not required for this issue's verification.

### Constraints
- No new core capability for Part B (decision 2) — `libs/core/**` gains nothing; Part A's use of the two existing capabilities is unchanged.
- Must follow the inFakt pattern exactly where it applies, and deviate explicitly (with a documented reason) where Subiekt's needs diverge — both the original scalar-vs-snapshot simplification (§7 Alternative 1) and the new generic-hook-vs-Subiekt-specific-hook correction (decision 6) are documented deviations, not oversights.

---

## 3. Architecture Mapping

**Target Layer**: Integration (`libs/integrations/subiekt/`) + Frontend (`apps/web/src/plugins/subiekt/`, `apps/web/src/features/connections/`). No CORE, no Infrastructure/persistence, no new Interface-layer code (API controller is unchanged).

**Capabilities Involved**:
- `InvoicingPort` (existing, unchanged) — `libs/core/src/invoicing/domain/ports/invoicing.port.ts`
- `BankAccountsReader` (existing, from #1310) — `libs/core/src/invoicing/domain/ports/capabilities/bank-accounts-reader.capability.ts`
- `BankAccountDefaultSetter` (existing, from #1310) — `libs/core/src/invoicing/domain/ports/capabilities/bank-account-default-setter.capability.ts`

**Existing Services Reused**:
- `InvoicingController.getBankAccounts` / `.setDefaultBankAccount` (`apps/api/src/invoicing/http/invoicing.controller.ts`) — capability-generic, zero changes needed.
- `useBankAccountsQuery` / `useSetDefaultBankAccountMutation` (`apps/web/src/features/connections/hooks/`) — connection-generic, zero changes needed.
- `InlineDisclosure` (`apps/web/src/shared/ui/inline-disclosure.tsx`) — reused as-is.
- `syncStructuredToJson` (existing prop on `StructuredConfigSectionProps`) — reused for both new scalar fields; **no new whole-object serializer prop needed** (see §7).

**New Components Required**:
- Four new methods on `SubiektBridgeClient` interface + `SubiektBridgeHttpClient` implementation + `FakeSubiektBridgeAdapter`: `listBankAccounts()`, `setDefaultBankAccount(id)` (Part A), `listBranches()`, `listCashRegisters()` (Part B).
- Four new optional fields on `BridgeIssueInvoiceRequest` (`subiekt-bridge.types.ts`): `paymentMethod`, `bankAccountId`, `oddzialId`, `stanowiskoKasoweId`.
- Four new optional fields on `SubiektConnectionConfig` + matching `SubiektConnectionConfigDto` validation: `defaultPaymentMethod`, `bankAccountId`, `defaultOddzialId`, `defaultStanowiskoKasoweId`.
- `implements BankAccountsReader, BankAccountDefaultSetter` on `SubiektInvoicingAdapter` (Part A, generic core capabilities), plus two new **Subiekt-local, non-core** methods `listBranches()`/`listCashRegisters()` (Part B) and one owner-aware `listBankAccountsWithOwner()` (decision 6) — all behind a 4th constructor parameter (`config: SubiektConnectionConfig`) mirroring `InfaktInvoicingAdapter`.
- **New file** `apps/api/src/integrations/http/subiekt.controller.ts` (decision 3) — resolves the connection's adapter, narrows to the concrete `SubiektInvoicingAdapter` (no capability guard needed since these aren't core capabilities), exposes `GET connections/:id/branches`, `GET connections/:id/cash-registers`, `GET connections/:id/bank-accounts` (owner-aware variant, distinct route or query param from the generic `InvoicingController` one — see Phase 4 below for the exact path).
- Three new Subiekt-specific FE hooks (`apps/web/src/plugins/subiekt/hooks/` or co-located with the structured section) replacing the plan's original intent to reuse `useBankAccountsQuery` (decision 6).
- Form fields threaded through `EditConnectionForm.tsx` + `edit-connection.schema.ts`: `subiektPaymentMethod`, `subiektBankAccountId` (Part A), `subiektOddzialId`, `subiektStanowiskoKasoweId` (Part B) — same shared FE files inFakt's #1303/#1308 touched for its own fields.

**Core vs Integration Justification**: Part A is Integration + Frontend, no new port — `BankAccountsReader`/`BankAccountDefaultSetter` were designed generically in #1310 specifically so a second provider (Subiekt) could adopt them without touching `libs/core`. Part B is Integration + Interface (new controller) + Frontend, **deliberately with no core port** (decision 2) — Oddział/Stanowisko Kasowe has no cross-plugin abstraction to join (inFakt/KSeF have no branch concept), so introducing one now would be a speculative, single-consumer abstraction.

---

## 4. External / Domain Research

### Bridge wire contract (verified against the merged bridge source, not just docs)

Read directly from `~/projekty/blocky/openlinker-subiekt-bridge-1324-integration`:

**`GET /api/bank-accounts`** (`BankAccountsEndpoints.cs`, shape as of bridge PR #4 — see "Multi-payer caveat" below):
```json
{
  "success": true,
  "data": {
    "count": 2,
    "accounts": [
      { "id": 100004, "name": "Rachunek podstawowy", "number": "00 10101010 1111 1111 1111 1111",
        "bankNumber": "", "description": "", "currency": "PLN", "isVatAccount": false, "isDefault": true,
        "ownerPodmiotId": 1, "ownerName": "Moja Firma Sp. z o.o." }
    ]
  }
}
```
`ownerPodmiotId`/`ownerName` were added by bridge PR #4 (fixing `openlinker-subiekt-bridge#3`) — the original PR #2 query silently returned only one seller Podmiot's accounts on a multi-payer install (`... = (SELECT TOP 1 Id FROM Podmioty WHERE Typ=2 AND Podtyp=11)`); PR #4 widens it to `IN (...)` and tags each account with its owning Podmiot.

**`PUT /api/bank-accounts/{id}/default`**:
```json
{ "success": true, "data": { "bankAccountId": 100007, "isDefault": true } }
```
Idempotent — selecting the current default is a no-op success.

**`POST /api/invoices`** — two ADDITIVE optional fields, both absent = unchanged legacy behavior:
```json
{ "paymentMethod": "transfer", "bankAccountId": 100007 }
```
Strict server-side rules (`PaymentSelection.TryCreate` in `Subiekt.Bridge.Domain/Invoices/PaymentSelection.cs`): `transfer` requires a positive `bankAccountId`; `cash` must not carry one; a bare `bankAccountId` without `paymentMethod` is rejected; not supported for `documentType: "PA"`. Vocabulary errors are 400; combination/account errors are 422.

#### Wire-contract correction vs. the issue text

The GitHub issue's Acceptance Criteria say to thread payment fields into "`issueInvoice`/`issueCorrection`". **Verified against the bridge source, this is only half-true**: `bridge/Subiekt.Bridge.Api/Contracts/InvoiceContracts.cs` shows `PaymentSelection.TryCreate(req.PaymentMethod, req.BankAccountId)` is called **only** inside `InvoiceContractMapper.Build`, which backs `CreateInvoiceRequestDto` (the `POST /api/invoices` issue path). A repo-wide grep for `PaymentMethod`/`BankAccountId` across `bridge/Subiekt.Bridge.Api/`, `bridge/Subiekt.Bridge.Application/`, `bridge/Subiekt.Bridge.Domain/` turns up **no** korekta contract file — the correction endpoint (`POST /api/invoices/{origId}/corrections`, `BridgeKorektaRequest`) has no payment-selection fields at all. **Decision: `BridgeKorektaRequest` is left unchanged; `SubiektInvoicingAdapter.issueCorrection` does not build or send payment fields.** This is a plan-level correction of the issue's proposed solution, made explicit here rather than silently diverging.

#### Multi-payer caveat (bridge issue #3 / PR #4 — read this before implementing Step 1)

The operator's real Subiekt install has **more than one seller Podmiot** (multiple płatnicy/oddziały) — confirmed live, not hypothetical. Bridge PR #2's original bank-account queries used `TOP 1`, silently dropping every payer's accounts except one; bridge PR #4 (`openlinker-subiekt-bridge#3`) fixes the silent-data-loss part by widening to `IN (...)` and tagging each returned account with `ownerPodmiotId`/`ownerName`.

**What PR #4 does NOT fix**: `POST /api/invoices`'s `CreateInvoiceRequestDto` still has no Oddział/Płatnik selector at all — the bridge has no way to route a specific invoice to a specific payer. So even with the corrected account list, OL cannot guarantee that a `bankAccountId` picked in the FE (owned by Payer B) matches whichever payer Subiekt actually issues the resulting document under (Subiekt's own internal default, opaque to the bridge/OL). This is tracked as open, unresolved work on `openlinker-subiekt-bridge#3` and is explicitly **not** blocking for this plan.

**Decisions this plan makes as a result**:
- `BridgeBankAccount` (Step 1 below) gains `ownerPodmiotId: number` and `ownerName: string | null` fields, matching PR #4's wire shape — captured so the data isn't lost, but **not** propagated into the shared core `InvoicingBankAccount` type (that type is also inFakt's, which has no multi-payer concept — widening it would leak Subiekt-specific vocabulary into `libs/core`, violating the "core stays neutral" invariant this whole capability pattern depends on).
- `listBankAccounts()` (Step 9) maps the bridge shape to the neutral `InvoicingBankAccount` and **drops** `ownerPodmiotId`/`ownerName` in that mapping — the FE structured section (Step 12) sees a flat list with no owner distinction, same as every other `BankAccountsReader` consumer.
- **Known MVP limitation, not fixed by this plan**: the FE cannot yet label accounts by payer, and OL cannot verify a picked account's owner matches the invoice's actual issuing payer. Acceptance criteria (§9) call this out explicitly rather than silently shipping a picker that implies a stronger guarantee than the bridge can deliver.
- **Pre-implementation gate**: bridge PR #2 *and* PR #4 should both be merged before this plan's live E2E verification (§11) runs against the operator's real multi-payer install — verifying against PR #2 alone would reproduce the truncated-account-list bug PR #4 fixes, giving a false-negative E2E result.

### Part B bridge wire contract (`openlinker-subiekt-bridge#5` / PR #6, merged and live-verified)

**`GET /api/branches`**:
```json
{ "count": 2, "branches": [{ "id": 100001, "name": "Pachnidło" }, { "id": 100002, "name": "Centrum Handlowe" }] }
```

**`GET /api/cash-registers`** (optional `?oddzialId=` filter, unused by this plan per decision 4 — always fetched unfiltered, filtered client-side):
```json
{ "count": 4, "cashRegisters": [
  { "id": 100065, "name": "Kasa Centralna", "symbol": "CENTR", "oddzialId": null },
  { "id": 100066, "name": "Kasa Outlet", "symbol": "OUTLET", "oddzialId": null }
] }
```
`oddzialId: null` means unlinked — per the live probe (`docs/spikes/podmioty-oddzial-stanowisko-probe-findings.md` in the bridge repo), most cash registers on a real install have no branch link at all; only explicitly-linked ones are branch-restricted.

**`POST /api/invoices`** gains `oddzialId?: number` / `stanowiskoKasoweId?: number`, live-verified validation: `oddzialId` alone is rejected (422 — Sfera's implicit register resolution doesn't reach across branches); `stanowiskoKasoweId` alone is accepted (keeps the document's default branch); both together are checked by the bridge itself (register must be linked to the given Oddział, or unlinked) **before** the request ever reaches Sfera.

### Internal pattern (inFakt #1303/#1308, read from the merged worktree)

`InfaktInvoicingAdapter` (`libs/integrations/infakt/src/infrastructure/adapters/infakt-invoicing.adapter.ts`):
- Takes a 4th constructor param `config: InfaktConnectionConfig = {}`, derives `this.paymentMethod = config.defaultPaymentMethod ?? 'cash'` and `this.bankAccount = config.bankAccount`.
- `implements ... BankAccountsReader, BankAccountDefaultSetter`.
- `listBankAccounts()` — one HTTP GET, maps provider shape → `InvoicingBankAccount[]`.
- `setDefaultBankAccount(accountId)` — one HTTP PUT/POST.
- A private `bankAccountFields()` helper returns `{}` unless `paymentMethod === 'transfer'` **and** a bank account is configured; spread into both `issueInvoice` and `issueCorrection` payloads with `...this.bankAccountFields()`.

`infakt-structured-section.tsx` (`apps/web/src/plugins/infakt/components/`): payment-method `<Select>` + conditional bank-account `<Select>`, both inside one `InlineDisclosure`, using `useBankAccountsQuery(connection.id, { enabled: isTransfer })` and `useSetDefaultBankAccountMutation()`. On account pick: `form.setValue('infaktBankAccount', {...}, { shouldDirty: true })` then `syncInfaktBankAccountToJson?.()`, plus a live call to `setDefaultBankAccount.mutateAsync(...)` when the picked account isn't already the provider's default.

**Key structural difference driving this plan's simplification**: `InfaktBankAccountConfig` is a 3-field snapshot object (`{ id, accountNumber, bankName }`) because inFakt's `issueInvoice` payload needs `bank_account`/`bank_name` **strings** at issuance time — the adapter never re-fetches by id. Subiekt's bridge, by contrast, only ever needs the **numeric `bankAccountId`** on the wire (`POST /api/invoices` takes `bankAccountId: number`, not account details) — so `SubiektConnectionConfig.bankAccountId` can be a bare `number`, no snapshot object, no dedicated whole-object FE serializer. See §7 for why this is deliberate, not an oversight.

### Current Subiekt adapter (verified against the merged worktree)

- `SubiektInvoicingAdapter.issueInvoice` (`libs/integrations/subiekt/src/infrastructure/adapters/subiekt-invoicing.adapter.ts:127-139`) builds the bridge request inline: `documentType`, `currency`, `orderId`, `idempotencyKey`, `buyer`, `lines`. This is where `paymentMethod`/`bankAccountId` get spread in.
- Constructor today: `(bridge, connectionId, logger)` — 3 params, no config. Needs a 4th `config: SubiektConnectionConfig = {}` param, mirroring inFakt exactly.
- `SubiektAdapterFactory.createAdapters` (`libs/integrations/subiekt/src/application/subiekt-adapter.factory.ts`) already parses `connection.config` into `SubiektConnectionConfig` via `validateAndParseConfig` before constructing the client — the new fields get parsed there and passed into the adapter constructor.
- `SubiektConnectionConfig` today (`libs/integrations/subiekt/src/domain/types/subiekt-connection-config.types.ts`) has only `bridgeBaseUrl` + `timeoutMs`.
- `SubiektConnectionConfigDto` (`libs/integrations/subiekt/src/application/dto/subiekt-connection-config.dto.ts`) is the class-validator shape backing the config-shape validator adapter — needs the two new optional fields added with matching decorators.
- `FakeSubiektBridgeAdapter` (`libs/integrations/subiekt/src/testing/fake-subiekt-bridge.adapter.ts`) is the in-memory `SubiektBridgeClient` double consumed only from `*.spec.ts` (Subiekt nexo is Windows-only, uncontainerizable) — needs the two new methods added with deterministic mock data, mirroring its existing `issueInvoice`/`upsertCustomer` style.

---

## 5. Questions & Assumptions

### Open Questions
- None blocking. The bridge wire contract, core capabilities, and FE pattern are all already-shipped, inspectable code — no external API to reverse-engineer.

### Assumptions
1. **`bankAccountId` is bridge-native, stored verbatim** — a plain `int` from `GET /api/bank-accounts`, not an OL internal id, with no `IdentifierMappingService` involvement. Matches how `InfaktBankAccountConfig.id` stores inFakt's own account id and matches the issue's explicit assumption.
2. **Connection-level default, not per-invoice** — one payment method + one bank account for every invoice issued through a connection (mirrors inFakt and the KSeF #1311 precedent — OL's order model carries no per-order payment-method signal today).
3. **`documentType: "PA"` is not exercised** — the current Subiekt adapter's `issueInvoice` path doesn't special-case PA (see `SUPPORTED_DOCUMENT_TYPES` includes `'receipt'`, and the bridge maps neutral → `PA` via `toBridgeDocumentType`). If an operator configures `defaultPaymentMethod: 'transfer'` on a connection that also issues receipts, and a receipt is issued, the bridge will 422 the request (payment selection unsupported for PA). This is accepted as-is (not new to this change — the bridge enforces it, and Subiekt's neutral-doctype derivation already means a given connection mostly issues one doctype family in practice). Flagged for a future adapter-side guard if it proves to bite in real use.

### Documentation Gap Found During Research (not fixed here)
`apps/web/src/features/connections/components/edit-connection.schema.ts` and `EditConnectionForm.tsx` read/write the Subiekt bridge URL under the **flat JSON key `subiektBridgeUrl`** (`next.subiektBridgeUrl = structured.subiektBridgeUrl`), but `SubiektConnectionConfigDto`/`SubiektConnectionConfig` on the backend expect the key `bridgeBaseUrl`. This looks like a pre-existing FE/BE key-name mismatch from #759, unrelated to bank accounts/payment method. **Not fixed in this plan** (out of scope, would need its own investigation + issue) — flagged so the new `subiektPaymentMethod`/`subiektBankAccountId` fields are deliberately given FE form-field names that map to the **correct, verified** `SubiektConnectionConfig` key names (`defaultPaymentMethod`, `bankAccountId`) rather than copying the existing mismatch pattern.

---

## 6. Proposed Implementation Plan

Phases map onto the orchestration units in §10 (Unit A = Phase 1, Unit B = Phase 2, Unit C = Phase 3, Unit E = Phase 4, Unit D = Phase 5). Part A and Part B fields are implemented **together** in each phase (decision 1) — the phase boundaries are by layer, not by Part.

### Phase 1 (Unit A): Bridge wire types + client (TypeScript)

**Goal**: The TS-side bridge contract can express payment selection, bank-account discovery, AND branch/cash-register discovery.

1. **Extend `BridgeIssueInvoiceRequest` + add discovery response types**
   - **File**: `libs/integrations/subiekt/src/bridge/subiekt-bridge.types.ts`
   - **Action**:
     - Add to `BridgeIssueInvoiceRequest` (after `lines`): `paymentMethod?: 'cash' | 'transfer'; bankAccountId?: number; oddzialId?: number; stanowiskoKasoweId?: number;`.
     - Part A: `BridgeBankAccount { id: number; name: string | null; number: string | null; bankNumber: string | null; description: string | null; currency: string | null; isVatAccount: boolean; isDefault: boolean; ownerPodmiotId: number; ownerName: string | null }`, `BridgeListBankAccountsResponse { count: number; accounts: BridgeBankAccount[] }`, `BridgeSetDefaultBankAccountResponse { bankAccountId: number; isDefault: boolean }`.
     - Part B: `BridgeBranch { id: number; name: string | null }`, `BridgeListBranchesResponse { count: number; branches: BridgeBranch[] }`, `BridgeCashRegister { id: number; name: string | null; symbol: string | null; oddzialId: number | null }`, `BridgeListCashRegistersResponse { count: number; cashRegisters: BridgeCashRegister[] }` — matching the PR #6 wire shapes in §4.
   - **Acceptance**: New types compile; existing `BridgeIssueInvoiceRequest` consumers still compile (all new fields optional).

2. **Extend `SubiektBridgeClient` interface**
   - **File**: `libs/integrations/subiekt/src/bridge/subiekt-bridge.client.ts`
   - **Action**: Add four methods with doc comments naming the real routes: `listBankAccounts(): Promise<BridgeListBankAccountsResponse>` (`GET /api/bank-accounts`), `setDefaultBankAccount(bankAccountId: number): Promise<BridgeSetDefaultBankAccountResponse>` (`PUT /api/bank-accounts/{id}/default`), `listBranches(): Promise<BridgeListBranchesResponse>` (`GET /api/branches`), `listCashRegisters(): Promise<BridgeListCashRegistersResponse>` (`GET /api/cash-registers` — always unfiltered per decision 4).
   - **Acceptance**: Interface compiles; both implementers fail to compile until Steps 3–4 land (TypeScript enforces completeness).

3. **Implement in `SubiektBridgeHttpClient`**
   - **File**: `libs/integrations/subiekt/src/infrastructure/http/subiekt-bridge-http.client.ts`
   - **Action**: Add endpoint entries (`listBankAccounts: '/api/bank-accounts'`, `setDefaultBankAccount: (id) => \`/api/bank-accounts/${id}/default\``, `listBranches: '/api/branches'`, `listCashRegisters: '/api/cash-registers'`). Implement the three GETs via the existing private `getJson<T>()`; implement `setDefaultBankAccount` via a new private `putJson<T>()` mirroring `postJson<T>()` (add `'PUT'` to the `request()` method union).
   - **Acceptance**: All four methods round-trip through the same envelope-unwrap / error-translation path (`SubiektBridgeUnreachableWithPhaseError`, `SubiektRejectedError`, `SubiektBridgeAuthError`) as every other method — no bespoke error handling.

4. **Implement in `FakeSubiektBridgeAdapter`**
   - **File**: `libs/integrations/subiekt/src/testing/fake-subiekt-bridge.adapter.ts`
   - **Action**: Add `listBankAccounts()` (2 deterministic accounts, one default, at least one with a distinct `ownerPodmiotId` so multi-payer tests are exercisable), `setDefaultBankAccount(id)` (validates against seeded ids, rejects via `SubiektRejectedError` otherwise, flips in-memory `isDefault`), `listBranches()` (2 branches), `listCashRegisters()` (mix of linked + `oddzialId: null` unlinked registers, matching the real probe data). Add `seed*` helpers + clear new state in `clear()`.
   - **Acceptance**: `pnpm --filter @openlinker/integrations-subiekt test` green; new cases in `fake-subiekt-bridge.adapter.spec.ts` for all four methods.

### Phase 2 (Unit B): Connection config

**Goal**: `SubiektConnectionConfig` can carry the four defaults; validated at the shape-validator boundary.

5. **Extend `SubiektConnectionConfig`**
   - **File**: `libs/integrations/subiekt/src/domain/types/subiekt-connection-config.types.ts`
   - **Action**: Add `export const SubiektPaymentMethodValues = ['cash', 'transfer'] as const; export type SubiektPaymentMethod = (typeof SubiektPaymentMethodValues)[number];` and four new optional fields: `defaultPaymentMethod?: SubiektPaymentMethod; bankAccountId?: number; defaultOddzialId?: number; defaultStanowiskoKasoweId?: number;` — doc comment explaining the bridge-native, no-snapshot rationale (§4) and that Oddział/Stanowisko are stored as bare bridge-native ints too.
   - **Acceptance**: Type compiles; matches the `as const` + union pattern.

6. **Extend `SubiektConnectionConfigDto`**
   - **File**: `libs/integrations/subiekt/src/application/dto/subiekt-connection-config.dto.ts`
   - **Action**: Add `@IsOptional() @IsIn(SubiektPaymentMethodValues) defaultPaymentMethod?`, `@IsOptional() @IsInt() @Min(1) bankAccountId?`, `@IsOptional() @IsInt() @Min(1) defaultOddzialId?`, `@IsOptional() @IsInt() @Min(1) defaultStanowiskoKasoweId?`. No cross-field validation here — bridge is the enforcement authority for Part A (transfer↔account) AND Part B (oddział↔register linkage, oddział-alone-rejected); OL just passes through and surfaces the bridge's rejection.
   - **Acceptance**: `SubiektConnectionConfigShapeValidatorAdapter`'s existing spec passes; new case asserts `{ bridgeBaseUrl, defaultPaymentMethod: 'transfer', bankAccountId: 5, defaultOddzialId: 100002, defaultStanowiskoKasoweId: 100067 }` passes shape validation.

7. **Thread config into the factory + adapter constructor**
   - **File**: `libs/integrations/subiekt/src/application/subiekt-adapter.factory.ts`
   - **Action**: Extend `validateAndParseConfig` to read+validate the four new optional fields (same style as the existing `timeoutMs` block — type/range check, throw `SubiektConfigException` on malformed input) and include them in the returned config. Pass `config` as the adapter's 4th constructor argument.
   - **Acceptance**: `subiekt-adapter.factory.spec.ts` new cases: valid config parses all four fields; malformed `bankAccountId`/`defaultOddzialId`/`defaultStanowiskoKasoweId` (non-integer, ≤0) throws `SubiektConfigException`.

### Phase 3 (Unit C): Adapter methods

**Goal**: `SubiektInvoicingAdapter` discovers accounts/branches/registers, sets the provider default, and stamps payment + branch/register fields on issuance. Depends on Units A + B.

8. **Add the 4th constructor param + capability interfaces**
   - **File**: `libs/integrations/subiekt/src/infrastructure/adapters/subiekt-invoicing.adapter.ts`
   - **Action**: Class signature → `implements InvoicingPort, RegulatoryStatusReader, CorrectionIssuer, BankAccountsReader, BankAccountDefaultSetter` (the two Part-A core capabilities; Part B methods are plain public methods, no core interface — decision 2). Import `BankAccountsReader, BankAccountDefaultSetter, InvoicingBankAccount` from `@openlinker/core/invoicing`. Add constructor param `config: SubiektConnectionConfig = {}` and derive four private readonly fields: `paymentMethod`, `bankAccountId`, `oddzialId`, `stanowiskoKasoweId` from `config`. **Do NOT default `paymentMethod` to `'cash'`** — "unset" means "send nothing" (the true additive/no-regression path), not "force cash".
   - **Acceptance**: Compiles once Steps 9–11 add method bodies.

9. **Implement the generic core-capability methods (Part A) + the owner-aware + Part B discovery methods**
   - **File**: same as Step 8.
   - **Action**:
     - `listBankAccounts(): Promise<InvoicingBankAccount[]>` — maps the bridge shape to the neutral core type, **dropping** `ownerPodmiotId`/`ownerName` (this is the generic `BankAccountsReader` seam; the API's capability-generic controller uses it — decision 6 keeps it neutral). Comment why the owner fields are dropped here.
     - `setDefaultBankAccount(accountId: string): Promise<void>` — `await this.bridge.setDefaultBankAccount(Number(accountId))`.
     - **Owner-aware variant** `listBankAccountsWithOwner(): Promise<SubiektBankAccountView[]>` (Subiekt-local return type, NOT the neutral core type) — returns the full bridge shape incl. `ownerPodmiotId`/`ownerName`, for the new Subiekt controller (Phase 4). Define `SubiektBankAccountView` in the subiekt package's types.
     - `listBranches(): Promise<SubiektBranchView[]>` and `listCashRegisters(): Promise<SubiektCashRegisterView[]>` — Part B, Subiekt-local return types, map the bridge responses 1:1.
     - Wrap every bridge call in the existing `try { … } catch (error) { throw this.translateBridgeError(error); }` pattern.
   - **Acceptance**: New adapter spec cases for all five methods, including `null` name/number/symbol degrading gracefully, and translated errors on bridge failure.

10. **Stamp payment + branch/register fields on `issueInvoice`**
    - **File**: same as Step 8, inside `issueInvoice`'s request-building block.
    - **Action**: Extend the request-building with a helper that spreads the configured fields when set:
      ```ts
      private paymentFields(): Partial<Pick<BridgeIssueInvoiceRequest, 'paymentMethod' | 'bankAccountId'>> {
        if (!this.paymentMethod) return {};
        if (this.paymentMethod === 'transfer' && this.bankAccountId === undefined) return {};
        return this.paymentMethod === 'transfer'
          ? { paymentMethod: 'transfer', bankAccountId: this.bankAccountId! }
          : { paymentMethod: 'cash' };
      }
      private branchFields(): Partial<Pick<BridgeIssueInvoiceRequest, 'oddzialId' | 'stanowiskoKasoweId'>> {
        // Bridge rejects oddzialId-alone (422); mirror that fiscal-safe omission here —
        // only send oddzialId when a stanowiskoKasoweId is also configured. A
        // stanowiskoKasoweId alone IS valid (keeps the document's default branch), so
        // send it whenever set.
        const out: Partial<Pick<BridgeIssueInvoiceRequest, 'oddzialId' | 'stanowiskoKasoweId'>> = {};
        if (this.stanowiskoKasoweId !== undefined) out.stanowiskoKasoweId = this.stanowiskoKasoweId;
        if (this.oddzialId !== undefined && this.stanowiskoKasoweId !== undefined) out.oddzialId = this.oddzialId;
        return out;
      }
      ```
      Spread `...this.paymentFields(), ...this.branchFields()` into the `bridge.issueInvoice(...)` request. **Do not** touch `issueCorrection` (§4).
    - **Acceptance**: New adapter spec cases: (a) no config → request byte-identical to today (no new keys); (b) cash → `{ paymentMethod: 'cash' }`; (c) transfer+account → both payment keys; (d) transfer no account → neither payment key; (e) register alone → `{ stanowiskoKasoweId }` only; (f) branch+register → both branch keys; (g) branch alone (no register) → neither branch key (mirrors bridge's oddział-alone-422, omit fiscal-safe).

### Phase 4 (Unit E): Subiekt-specific API controller

**Goal**: Expose the owner-aware bank-accounts, branches, and cash-registers to the FE. New file; depends on Unit C. Follows the plugin-specific-controller precedent (`allegro.controller.ts`), NOT the capability-generic `InvoicingController`.

11. **Create `subiekt.controller.ts` + register it**
    - **Files**: new `apps/api/src/integrations/http/subiekt.controller.ts`; register in whichever module already declares `AllegroController` (find via `grep -rl "AllegroController" apps/api/src`).
    - **Action**: `@Controller('integrations/subiekt')`, `@Roles('admin')` (match `allegro.controller.ts`). Three GET routes, each resolving the connection's adapter via `IIntegrationsService.getCapabilityAdapter<InvoicingPort>(connectionId, 'Invoicing')`, then narrowing to the concrete `SubiektInvoicingAdapter` (instanceof, or a small `isSubiektInvoicingAdapter` structural guard — these aren't core capabilities so there's no `is*Reader` guard to reuse; throw `BadRequestException` if the connection isn't Subiekt):
      - `GET connections/:id/bank-accounts` → `adapter.listBankAccountsWithOwner()` (owner-aware — this is the one the Subiekt FE consumes, distinct from `InvoicingController`'s neutral capability-generic route).
      - `GET connections/:id/branches` → `adapter.listBranches()`.
      - `GET connections/:id/cash-registers` → `adapter.listCashRegisters()` (unfiltered; FE filters client-side per decision 4).
    - Add response DTOs (`SubiektBankAccountResponseDto`, `SubiektBranchResponseDto`, `SubiektCashRegisterResponseDto`) in the controller's `dto/` neighbourhood.
    - **Acceptance**: `subiekt.controller.spec.ts` — each route returns mapped data for a Subiekt connection; a non-Subiekt connection is rejected; adapter errors propagate as the expected HTTP status. Verify no route collides with `InvoicingController` (different prefix `integrations/subiekt` vs `connections`).

### Phase 5 (Unit D): Frontend

**Goal**: One combined `InlineDisclosure` in the Subiekt structured section covers payment method, bank account (owner-grouped, conditional payer warning), Oddział, and Stanowisko Kasowe — matching the approved `subiekt-full-config-section.html` mockup. Depends on Units C + E (needs the new endpoints).

12. **Add Subiekt-specific FE hooks + API namespace**
    - **Files**: `apps/web/src/plugins/subiekt/hooks/use-subiekt-bank-accounts-query.ts`, `use-subiekt-branches-query.ts`, `use-subiekt-cash-registers-query.ts` (+ a `setDefaultBankAccount` mutation hook if the FE offers the two-way sync — see note); wire the Subiekt API namespace into the plugin's `apiNamespaces` build contribution (mirror how Allegro's plugin exposes its `responsible-producers` call).
    - **Action**: Each hook calls the new `integrations/subiekt/connections/:id/{bank-accounts,branches,cash-registers}` endpoints via the plugin API namespace. The bank-accounts hook returns the **owner-aware** shape (with `ownerPodmiotId`/`ownerName`) — this is the decision-6 correction: Subiekt does NOT use the generic `useBankAccountsQuery`.
    - **Note on two-way default sync**: Part A's inFakt precedent calls `setDefaultBankAccount` when the operator picks a non-default account. Decision 6 routes discovery through the Subiekt controller, but the generic `POST connections/:id/bank-accounts/:accountId/default` route on `InvoicingController` still works for Subiekt (the adapter implements `BankAccountDefaultSetter`). **Keep the two-way sync using the existing generic mutation** (`useSetDefaultBankAccountMutation`) — only the read side needs the owner-aware Subiekt-specific hook; the write side has no owner concern, so reuse the generic mutation rather than adding a redundant Subiekt-specific one.
    - **Acceptance**: Hook unit tests mock the plugin API namespace; assert correct URL + response typing (owner fields present on the bank-accounts hook).

13. **Extend the shared form contract**
    - **Files**: `apps/web/src/features/connections/components/edit-connection.schema.ts`, `EditConnectionForm.tsx`
    - **Action**: Add four flat scalar form fields: `subiektPaymentMethod?`, `subiektBankAccountId?`, `subiektOddzialId?`, `subiektStanowiskoKasoweId?` (all `string` in the form, mirroring `subiektBridgeUrl`/`subiektTriggerModel` — NOT the `infaktBankAccount` whole-object pattern, §7 Alternative 1). Read them in the default-values block from `connection.config` (`defaultPaymentMethod`, `bankAccountId`, `defaultOddzialId`, `defaultStanowiskoKasoweId`, stringified). In the serialize-to-JSON reducer, add four blocks mirroring the existing `subiektBridgeUrl` block: set/delete `next.defaultPaymentMethod` / `next.bankAccountId` / `next.defaultOddzialId` / `next.defaultStanowiskoKasoweId` (numbers parsed back, deleted when empty).
    - **Acceptance**: `edit-connection.schema.test.ts` round-trip cases for all four fields (set → correct config keys/types; clear → keys deleted).

14. **Extend `SubiektStructuredSection` (the combined section)**
    - **File**: `apps/web/src/plugins/subiekt/components/subiekt-structured-section.tsx`
    - **Action**: Add one `InlineDisclosure` after the Trigger-model field, implementing the approved `subiekt-full-config-section.html` mockup's five states:
      - Payment-method `<Select>` (cash/transfer) via `syncStructuredToJson('subiektPaymentMethod', …)`.
      - When transfer: bank-account `<Select>` fed by `use-subiekt-bank-accounts-query` (owner-aware). Group options by `ownerName` with `<optgroup>` when >1 distinct `ownerPodmiotId`. Compute `distinct(ownerPodmiotId).length > 1` and render the payer-routing warning callout **only when true** (decision 5/6). On non-default pick, fire the generic `useSetDefaultBankAccountMutation`.
      - Oddział `<Select>` fed by `use-subiekt-branches-query`, via `syncStructuredToJson('subiektOddzialId', …)`.
      - Stanowisko Kasowe `<Select>` fed by `use-subiekt-cash-registers-query`, **filtered client-side** to registers with `oddzialId === selectedOddzialId || oddzialId === null` (decision 4). Mismatch prevention: registers linked to a different branch appear disabled (mockup state 04). Branch-set-but-register-empty shows the warning callout (mockup state 05, mirrors the bridge's oddział-alone-422).
    - **Acceptance**: `subiekt-structured-section.test.tsx` new cases: payment select renders; transfer reveals owner-grouped account select; payer warning shows only with >1 owner; branch select filters the register list client-side; branch-without-register shows the warning; picking a non-default account fires the mutation.

### Phase 6 (Unit F): Cross-cutting verification

15. **Full quality gate**
    - **Action**: `pnpm lint && pnpm type-check && pnpm test` from the implementation worktree root. No ORM entity changed → no migration (`SubiektConnectionConfig` is a JSONB blob; `pnpm --filter @openlinker/api migration:show` shows nothing new).
    - **Acceptance**: All green, zero new lint/type errors.

**FE mockups** (design reference for Phase 5): `docs/plans/mockups/subiekt-full-config-section.html` (Part A + Part B combined, 5 states — the approved, authoritative one) and the older `subiekt-bank-account-payment-method.html` (Part A only, kept for reference). Both built against real tokens from `apps/web/src/index.css`.

---

## 7. Alternatives Considered

### Alternative 1: Mirror inFakt's whole-object `bankAccount` snapshot exactly
- **Description**: Give `SubiektConnectionConfig` an `InfaktBankAccountConfig`-shaped `bankAccount?: { id: number; number: string; name: string }` object (snapshotting the account's display fields at selection time, like inFakt does), and add a dedicated `syncSubiektBankAccountToJson` whole-object serializer prop to `StructuredConfigSectionProps`, exactly paralleling `syncInfaktBankAccountToJson`.
- **Why Rejected**: The Subiekt bridge's `POST /api/invoices` only ever consumes the numeric `bankAccountId` — it has no wire need for the account's display strings at issuance time (unlike inFakt, whose `invoices.json` payload embeds `bank_account`/`bank_name` as strings). Snapshotting a full object OL never sends anywhere is needless state to keep in sync and a wider `StructuredConfigSectionProps` surface (one more optional prop every other plugin ignores) for no behavioral benefit.
- **Trade-offs**: A pure `bankAccountId: number` is a smaller diff, reuses the existing generic `syncStructuredToJson` scalar-field path already proven for `subiektBridgeUrl`, and is easier to keep correct (nothing can drift between a cached snapshot and the live account). The one thing given up is the FE being able to show the picked account's number/name **without** an extra `useBankAccountsQuery` round-trip on every page load — acceptable, since the structured section already fetches that list live whenever Transfer is selected.

### Alternative 2: Thread payment fields into `issueCorrection` too, matching the issue's literal AC wording
- **Description**: Follow the GitHub issue text verbatim and add `paymentMethod`/`bankAccountId` to `BridgeKorektaRequest` and `SubiektInvoicingAdapter.issueCorrection`.
- **Why Rejected**: Verified against the actual merged bridge source (`InvoiceContractMapper.Build`, plus a repo-wide grep for `PaymentMethod`/`BankAccountId`) that the korekta endpoint's contract has no payment-selection fields at all. Adding them client-side would either be silently dropped by the bridge (dead code) or, worse, misleadingly imply a capability the bridge doesn't have.
- **Trade-offs**: None — this is a correctness fix to the issue's proposed solution, not a real trade-off. If the bridge later grows korekta-side payment selection, it's a small, additive follow-up (extend `BridgeKorektaRequest`, mirror Step 10's helper).

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ No CORE changes; reuses existing `BankAccountsReader`/`BankAccountDefaultSetter` verbatim.
- ✅ `SubiektInvoicingAdapter` remains DI-friendly (constructor injection, no `new` inside methods).
- ✅ Ports vs. concrete: adapter still depends only on `SubiektBridgeClient` (interface), never a concrete HTTP class.

### Naming Conventions
- ✅ `SubiektPaymentMethodValues`/`SubiektPaymentMethod` follow the `as const` + union pattern (engineering-standards.md), matching `InfaktPaymentMethodValues`.
- ✅ Adapter class name/file unchanged (`SubiektInvoicingAdapter`, `*.adapter.ts`).

### Existing Patterns
- ✅ Adapter constructor 4th-param config pattern matches `InfaktInvoicingAdapter` exactly.
- ✅ FE structured-section `InlineDisclosure` + live bank-account query matches `infakt-structured-section.tsx` exactly, modulo the deliberate scalar-vs-object simplification (§7).

### Risks
- **Bridge/adapter drift if the bridge's korekta endpoint later grows payment fields**: mitigated by the `runSubiektBridgeContractTests` shared suite mentioned in the fake adapter's header comment (out of scope to extend here, but the seam already exists for a future PR to catch this).
- **`defaultPaymentMethod: 'transfer'` configured without ever confirming a matching bank account exists in Subiekt**: mitigated the same way inFakt handles it — `paymentFields()` omits both fields until a `bankAccountId` is actually configured, so a half-configured connection silently falls back to bridge-default behavior rather than 422ing every invoice.
- **PA (paragon) + transfer combination**: accepted risk per Assumption 3 — the bridge will 422; not newly introduced by this change, and Subiekt connections issuing receipts are an edge case in current usage.

### Edge Cases
- Bridge returns zero bank accounts: `listBankAccounts()` returns `[]`; FE section shows the existing "no accounts configured" messaging pattern from `infakt-structured-section.tsx`, adapted for Subiekt wording.
- `setDefaultBankAccount` called with an id the bridge doesn't recognize: bridge returns 422 → `SubiektRejectedError` → surfaces through the existing mutation's error UI, no special handling needed.
- Operator switches from Transfer back to Cash: `subiektBankAccountId` stays in `configText` (stale) but `paymentFields()` only reads it when `paymentMethod === 'transfer'`, so a stale id is harmless dead config — matches inFakt's behavior (the config isn't scrubbed on method switch there either).

### Backward Compatibility
- ✅ Fully additive on every layer (wire, config, DTO, adapter). A connection with none of the new fields set produces byte-identical bridge requests to today (verified by the acceptance criterion in Step 10a).

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- `libs/integrations/subiekt/src/infrastructure/adapters/__tests__/subiekt-invoicing.adapter.spec.ts` — new `describe` blocks for `listBankAccounts`, `setDefaultBankAccount`, `listBankAccountsWithOwner`, `listBranches`, `listCashRegisters`, and the seven `paymentFields()`+`branchFields()` scenarios from Phase 3 Step 10.
- `libs/integrations/subiekt/src/infrastructure/http/__tests__/subiekt-bridge-http.client.spec.ts` — new cases for the four new endpoints, reusing the existing envelope-unwrap / error-translation test harness (including the new `putJson`/`'PUT'` path).
- `libs/integrations/subiekt/src/testing/__tests__/fake-subiekt-bridge.adapter.spec.ts` — parity cases for the four new fake methods (incl. multi-owner accounts + linked/unlinked registers).
- `libs/integrations/subiekt/src/application/__tests__/subiekt-adapter.factory.spec.ts` — config parsing + `SubiektConfigException` cases for the four malformed new fields.
- `libs/integrations/subiekt/src/application/dto/**` shape-validator spec — validation cases for the four new optional fields.
- `apps/api/src/integrations/http/subiekt.controller.spec.ts` (new) — each of the three routes returns mapped data for a Subiekt connection; non-Subiekt connection rejected; adapter errors propagate.
- `apps/web/src/plugins/subiekt/hooks/*.test.ts` (new) — the three Subiekt-specific query hooks call the right endpoints with the right response typing.
- `apps/web/src/plugins/subiekt/components/subiekt-structured-section.test.tsx` — new cases per Phase 5 Step 14's acceptance criteria (payment select, owner-grouped account select, conditional payer warning, client-side register filtering, branch-without-register warning).
- `apps/web/src/features/connections/components/edit-connection.schema.test.ts` — serializer round-trip cases for all four new form fields.

### Integration Tests
- None required for the OpenLinker API side beyond the controller unit spec — the new `subiekt.controller.ts` routes are thin adapter-delegation, covered by the controller spec + the adapter specs. No new DB schema. The functional cross-boundary proof (fields actually reaching Subiekt) is the live bridge-API verification in §11, not a Testcontainers integration test (the bridge can't be containerized).

### Mocking Strategy
- Adapter/bridge-client unit tests mock `SubiektBridgeClient` (the port), never `fetch` directly.
- Controller spec mocks `IIntegrationsService.getCapabilityAdapter` to return a fake `SubiektInvoicingAdapter`.
- FE component/hook tests mock the Subiekt plugin API namespace (the new hooks) + the generic `useSetDefaultBankAccountMutation` (reused for the write side, decision 6 note).

### Acceptance Criteria (mirrors the GitHub issue's Part A + Part B checklists, corrected per §4 and the §0.1 decision log)

**Part A:**
- [ ] `SubiektBridgeClient` (interface + HTTP + fake) exposes `listBankAccounts()` and `setDefaultBankAccount(id)`.
- [ ] `BridgeIssueInvoiceRequest` carries optional `paymentMethod`/`bankAccountId`; `issueInvoice` populates them from config when set, omits when not; `issueCorrection` untouched (bridge has no korekta-side payment selection).
- [ ] `SubiektConnectionConfig` gains `defaultPaymentMethod`/`bankAccountId`.
- [ ] `SubiektInvoicingAdapter implements BankAccountsReader, BankAccountDefaultSetter` (generic core capabilities kept for the capability-generic API surface).
- [ ] Subiekt structured section renders the payment-method select + owner-grouped bank-account picker.

**Part B:**
- [ ] `SubiektBridgeClient` exposes `listBranches()` and `listCashRegisters()`.
- [ ] `BridgeIssueInvoiceRequest` carries optional `oddzialId`/`stanowiskoKasoweId`; `issueInvoice` sends them per the fiscal-safe rules (register-alone OK, branch-alone omitted to mirror the bridge's 422).
- [ ] `SubiektConnectionConfig` gains `defaultOddzialId`/`defaultStanowiskoKasoweId`.
- [ ] New `apps/api/src/integrations/http/subiekt.controller.ts` exposes owner-aware `bank-accounts`, `branches`, `cash-registers` routes; no new core capability introduced (decision 2).
- [ ] Structured section renders the Oddział select + client-side-filtered Stanowisko Kasowe select, with mismatch prevention + branch-without-register warning per the approved mockup.

**Cross-cutting:**
- [ ] Tests added/updated for every item above; full quality gate green (`pnpm lint && type-check && test`).
- [ ] No architecture-boundary violations — confirmed by `pnpm lint`'s `check:invariants`.
- [ ] **Payer-routing limitation (decision 5, user-signed-off 2026-07-02)**: the FE shows the payer-routing warning **only when >1 distinct `ownerPodmiotId`** is detected in the live account list; no copy anywhere implies a guarantee OL can't deliver on a multi-Podmiot install.
- [ ] Live verification (§11, two-track per decision 8): OL-side screenshots of the rendered section + direct bridge-API functional proof issuing **several** invoices with different configurations, each confirmed to carry the exact payment/branch/register selected. Published as a Claude Artifact.

---

## 10. Orchestration Strategy (how this plan gets executed)

This section is a first-class part of the plan per explicit instruction: implementation work should be broken into small, independently-verifiable units and **delegated to subagents running the Opus model** (not the default model) for the actual code-writing steps, while the orchestrating session stays responsible for sequencing, integration, and final verification.

### Why Opus for subagents here
The Subiekt package has unusually dense, carefully-reasoned inline documentation (fiscal-safety error translation, retryability phases, idempotency contracts) that a lower-effort model is more likely to silently violate while pattern-matching against the simpler inFakt reference. Opus is worth the cost for the two riskiest units (the adapter capability methods, and the bridge-client + fake-adapter pair) where subtly breaking an existing fiscal-safety invariant is the failure mode to avoid.

### Suggested task decomposition (re-sequenced after `/grill-me`, decision 7)

The pre-grill table had FE (D) running parallel to the backend. That no longer holds: Part B's FE needs the new controller's endpoints (Unit E), and Part B touches the **same files** as Part A (adapter, bridge client, structured section) — so those can't be split across parallel subagents without guaranteed merge conflicts. New dependency chain: **A ∥ B → C → E → D → F(gate) → G(verify)**.

| # | Unit of work | Files touched | Depends on | Delegation |
|---|---|---|---|---|
| A | Bridge wire types + client + HTTP impl + fake — Part A **and** Part B methods together (Phase 1) | `subiekt-bridge.types.ts`, `subiekt-bridge.client.ts`, `subiekt-bridge-http.client.ts`, `fake-subiekt-bridge.adapter.ts`, `__tests__` | none | **Opus subagent** — highest risk of breaking the error-translation/retryability contract. |
| B | Connection config + DTO + factory — all four new fields (Phase 2) | `subiekt-connection-config.types.ts`, `subiekt-connection-config.dto.ts`, `subiekt-adapter.factory.ts`, `__tests__` | none (parallel with A) | **Opus subagent** — touches the fiscal-safe `SubiektConfigException` path. |
| C | Adapter methods — Part A capabilities + owner-aware + Part B discovery + `issueInvoice` field-stamping (Phase 3) | `subiekt-invoicing.adapter.ts`, its `__tests__` | **A, B** | **Opus subagent** — highest-risk: must not regress `issueInvoice`'s request shape for unconfigured connections (Step 10 case a). |
| E | New Subiekt API controller + DTOs + module registration (Phase 4) | `apps/api/src/integrations/http/subiekt.controller.ts` (new), its DTOs + spec, the module that declares `AllegroController` | **C** (calls the adapter's new methods) | **Opus subagent** — backend-only, isolated file set, no overlap with D. |
| D | FE: Subiekt hooks + shared form plumbing + combined structured section (Phase 5) | `apps/web/src/plugins/subiekt/hooks/*` (new), `edit-connection.schema.ts`, `EditConnectionForm.tsx`, `subiekt-structured-section.tsx`, tests | **C, E** (needs the endpoints) | **Opus subagent** — no longer parallel with backend; runs after E. |
| F | Quality gate + integration | whole worktree | A, B, C, E, D merged | Orchestrating session (not delegated) — reconcile cross-unit seams, run `pnpm lint && type-check && test`. |
| G | Live verification (two-track) + Artifact | none new (scripts/screenshots) | F green | Orchestrating session — PowerShell-from-WSL bridge calls + OL screenshots + human review. |

**Concurrency**: only A ∥ B run in parallel. C waits on both. E waits on C. D waits on C+E. This is a longer critical path than the pre-grill plan, deliberately — it trades parallelism for zero same-file merge risk (decision 7), which matters more now that Part A and Part B edit the same adapter/client/section files.

**Note on `edit-connection.schema.ts` / `EditConnectionForm.tsx`**: these shared FE files were also touched by the merged inFakt work (#1308) already in the base branch. D is the only unit touching them in this plan, so no intra-plan conflict — but the subagent must be told to *append* the four Subiekt fields next to the existing `subiektBridgeUrl`/`subiektTriggerModel` blocks, not rewrite the file.

---

## 11. Live Verification & Artifact — two-track (decision 8)

The acceptance gate. Not one heavyweight PrestaShop-order flow (decision 8 dropped that — PrestaShop tests nothing new for this issue, the order→invoice trigger is unchanged). Instead two tracks: **(Track 1) OL-side screenshots proving the UI renders + populates from live data**, and **(Track 2) direct bridge-API functional proof that the four selectors actually reach Subiekt and produce documents with exactly the chosen payment/branch/register** — issuing **several** invoices with different configs, as already demonstrated this session against `Nexo_Demo_1`.

### Environment

| Component | Where it runs | How it's started |
|---|---|---|
| Subiekt Bridge | Windows-native, reached via `powershell.exe` from WSL | Against `~/projekty/blocky/openlinker-subiekt-bridge` on branch `3-bank-account-multi-podmiot` (tip = PR #6). `dotnet run` the API project, or call `BankAccountProbe`-style scripts directly. Points at `Nexo_Demo_1` (real Sfera). Proven reachable this session. |
| OpenLinker API + web | WSL/Linux, the implementation worktree | `pnpm start:dev:api` + `pnpm start:dev:web`, connection's `bridgeBaseUrl` pointed at the running bridge. |
| PrestaShop | **Not required** (decision 8) | — |

### Track 1 — OL-side visual screenshots (UI renders + live data)

1. Subiekt connection edit form, the combined payment/branch section **collapsed** — shows the summary line (payment · branch · register) with real configured values.
2. Section **expanded, Transfer** — bank-account `<Select>` populated from the live owner-aware endpoint; if the demo DB shows >1 owner, the payer-routing warning is visible (decision 5/6); if single-owner, it is correctly absent.
3. Section **expanded, branch chosen** — Stanowisko Kasowe select client-side-filtered to that branch's linked + unlinked registers (mockup state 03).
4. **Branch-without-register** warning state (mockup state 05) and, if reproducible, the mismatch-disabled-option state (mockup state 04).

Screenshots only — no requirement to drive a full order→invoice flow through the OL UI.

### Track 2 — direct bridge-API functional proof (several invoices, different configs)

Issue real documents through the bridge (PowerShell-from-WSL, `Nexo_Demo_1`) and, for each, read the resulting Subiekt document back to confirm the actual payment form / bank account / branch / cash-register match what was sent — not merely that the call returned 200. At minimum these configurations:

| # | Config sent | Expected result on the issued document |
|---|---|---|
| 1 | no payment/branch fields (baseline) | Subiekt's own defaults; byte-identical to pre-change behavior |
| 2 | `paymentMethod: 'cash'` | cash payment form on the document |
| 3 | `paymentMethod: 'transfer', bankAccountId: <id>` | transfer form + that exact bank account stamped |
| 4 | `paymentMethod: 'transfer'` with no account | bridge omits / document uses no explicit account (fiscal-safe) |
| 5 | `stanowiskoKasoweId: <unlinked id>` alone | document issued under that register, default branch |
| 6 | `oddzialId: <b>, stanowiskoKasoweId: <register linked to b>` | document under branch b + that register |
| 7 | `oddzialId: <b>` alone (no register) | **422 rejected by the bridge before Sfera** (proves the fiscal-safe guard) |
| 8 | `oddzialId: <b>, stanowiskoKasoweId: <register linked to a different branch>` | **422 rejected** (proves cross-branch mismatch guard) |

Each row: capture the request + the read-back document's actual payment/branch/register (or the 422 body for rows 7–8) as evidence.

### Artifact

One Claude Artifact (HTML): what was tested, the branch/commit SHAs of both repos at verification time, Track-1 screenshots with captions, and a Track-2 table showing each config → the actual resulting document data (proving the selection genuinely took effect, per the user's explicit requirement). Style mirrors prior inFakt/KSeF E2E artifacts (`infakt-feasibility-poc`, `pr1284-woocommerce-screenshots-fixed`).

---

## 12. Alignment Checklist

- [x] Follows hexagonal architecture — Integration adapter + one new Interface-layer controller (Part B), no CORE touched.
- [x] Respects CORE vs Integration boundaries — Part A reuses existing `BankAccountsReader`/`BankAccountDefaultSetter`; Part B deliberately adds **no** core port (decision 2), staying Subiekt-local behind a plugin-specific controller (decision 3, precedent: `allegro.controller.ts`).
- [x] Uses existing patterns (no unnecessary abstractions) — scalar-vs-snapshot simplification (§7 Alt 1); Subiekt-specific-hook-vs-generic-hook correction (decision 6); no speculative single-consumer core capability.
- [x] Idempotency considered — `setDefaultBankAccount` idempotent per the bridge contract; `issueInvoice`'s `idempotencyKey` untouched; discovery GETs are read-only.
- [ ] Event-driven patterns — N/A.
- [x] Rate limits & retries — reuses the existing `SubiektBridgeHttpClient` machinery for all four new endpoints.
- [x] Error handling comprehensive — new methods route through the same `translateBridgeError` path; controller propagates adapter errors as HTTP.
- [x] Testing strategy complete — see §9 (Part A + Part B, controller spec, hook specs).
- [x] Naming conventions followed — see §8.
- [x] File structure — **new files this plan adds**: `apps/api/src/integrations/http/subiekt.controller.ts` (+ DTOs + spec), three FE hooks under `apps/web/src/plugins/subiekt/hooks/`; everything else edits established locations.
- [x] Plan is execution-ready — every step names exact files/actions/acceptance, grounded in code read from the merged worktrees + the live-verified bridge PR #6.
- [x] Plan is saved as a markdown file.
- [x] No ADR required — Part A reuses an existing pattern; Part B's "plugin-specific controller, no core port" is itself a pre-existing established pattern (`allegro.controller.ts`), not a new architectural decision needing an ADR. The core-capability-vs-Subiekt-local fork was decided in the §0.1 grill log with rationale.

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md) — §14 Invoicing, capability abstractions
- [Engineering Standards](../engineering-standards.md) — naming, `as const` pattern, Symbol tokens
- [Testing Guide](../testing-guide.md)
- [Code Review Guide](../code-review-guide.md)
- [GitHub issue #1324](https://github.com/openlinker-project/openlinker/issues/1324)
- Reference implementation: PR #1309 (`1303-infakt-payment-method`), PR #1310 (`1308-infakt-bank-account-picker`) — merged locally into `1324-prereqs-integration`, see §0.
- Bridge reference: `openlinker-subiekt-bridge` PR #2 (`1-bank-account-payment-method`) — merged locally into the bridge's `1324-prereqs-integration` branch, see §0.
