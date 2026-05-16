# Product Spec — #728 Invoicing integration (Subiekt as first adapter)

**Status:** phase A-E complete; Gate D = YES (build); refinement closed 2026-05-16; ready for implementation (impl tracked via #751-#760)
**Parent issue:** [#728](https://github.com/SilkSoftwareHouse/openlinker/issues/728)
**Started:** 2026-05-16
**Last updated:** 2026-05-16
**Workflow:** [`docs/contributors/refinement-workflow.md`](../contributors/refinement-workflow.md)

---

## 1. Problem

> **Phase A complete — confirmed by maintainer at Gate A on 2026-05-16**

### Problem statement

PL e-commerce shops are legally required to issue invoices (faktura VAT) for B2B sales. The PL fiscal stack is non-trivial:
- NIP validation against VIES / Ministerstwo Finansów
- Sequential numbering rules per shop / per year (enforced by tax authority)
- VAT regimes: 23%, 8%, 5%, 0%, zw (zwolniony), np (nie podlega) — must be correct per line
- JPK_FA monthly reporting (XML)
- KSeF (Krajowy System e-Faktur) — mandatory for B2B in 2026/2027 transition

OpenLinker today handles **zero** of this. A PL shop ingesting orders from Allegro/PrestaShop into OL must **manually re-enter every B2B order into their accounting software** (Subiekt is the dominant PL stack — InsERT) to issue an invoice. For a typical shop with 10–50 invoice-requiring orders/day, that's **30–60 minutes of daily manual data entry** — error-prone (transposed NIPs, wrong VAT rates), latency to invoice delivery, and a hard ceiling on the operator's day.

### Why now

- **Q1 wedge promise**: OL pitches "complete e-commerce workflow in one tool for PL Allegro+PS shops". Without invoicing integration, the daily workflow still requires Subiekt as a separate context — the promise is unfulfilled.
- **KSeF mandate**: B2B e-invoicing through KSeF becomes mandatory in PL during 2026/2027. Shops without an integrated fiscal stack will scramble. Subiekt already handles KSeF; OL integrating with Subiekt inherits compliance for free.
- **The cheapest fiscal layer is no fiscal layer**: building OL-native invoice generation would force OL to own PL fiscal compliance (sequential numbering, VAT correctness, KSeF, JPK_FA, audits). Delegating to Subiekt avoids the entire surface area.

### Gate A resolutions (2026-05-16)

The five ambiguity points from Phase A were resolved as follows:

#### A1. Framing — **port-first (Option A)**

**Decision:** this Product Design is **"Invoicing integration"** at the port-first level. It defines an `InvoicingPort` capability whose first concrete adapter is Subiekt. Future adapters (Fakturownia, iFirma, wFirma, inFakt, nexo PRO REST as separate adapter, KSeF-direct) are plain `[IMPL]` issues against the established port — they do NOT need their own Product Design.

**Why:** Fakturownia/iFirma have real PL SMB share; KSeF-direct is structurally inevitable post-mandate; port shape can be designed defensively since the domain (issue/retrieve/sync customer) is well-understood across all PL invoicing systems.

#### A2. Subiekt approach — **Sfera bridge first (Option B), nexo PRO REST as future sibling adapter**

**Decision:** Phase B will research the Sfera bridge approach as the primary integration path. The friend-provided `sfera-api-main` codebase is concrete evidence that a local Windows REST wrapper around Sfera is feasible. Targeting this approach widens the addressable market beyond nexo PRO license holders.

**Future:** nexo PRO REST integration is a separate sibling adapter (NOT a separate port) — added later as a plain `[IMPL]` issue against the same `InvoicingPort`. Same applies to Subiekt GT bridge (older Sfera version) if demand emerges.

#### A3. Primary persona — **shop owner**

**Decision:** the primary persona is the shop owner. The accountant is a **constraint** (numbering rules, fiscal correctness, KSeF), not a separate primary persona. Workflow optimizes for shop-owner UX; accountant gets correct fiscal data as a byproduct.

#### A4. Trigger model — **configurable per-connection**

**Decision:** the most flexible model. Shop owner picks per-connection: auto-on-paid, auto-on-shipped, manual-per-order, or batched. UX adds settings panel but covers every realistic shop convention.

#### A5. Receipt vs invoice — **detect NIP and choose**

**Decision:** OL inspects the buyer's NIP at issuance time. Buyer with NIP → faktura VAT. Buyer without NIP → paragon (or invoice on operator request). Subiekt handles both document types via its existing document API.

---

## 2. Affected persona

> **Phase A complete — confirmed by maintainer at Gate A on 2026-05-16**

### Primary persona: shop owner

- **Role:** in-house operator at a PL e-commerce shop (same primary persona as [#726](https://github.com/SilkSoftwareHouse/openlinker/issues/726), [#727](https://github.com/SilkSoftwareHouse/openlinker/issues/727))
- **Company size:** 1–30 people
- **Volume:** 100–1,000 SKUs; 10–200 orders/day, of which ~10–50 are invoice-requiring (B2B + customer-requested B2C)
- **Sophistication:** operator-level — comfortable with admin UIs, NOT technical. Does not write or read Subiekt's COM API.
- **Geography:** PL only (entire fiscal context is PL-specific)
- **Trigger event:** ingesting daily order flow from Allegro / PrestaShop into OL → needs invoices to flow into Subiekt without re-entry

### Accountant — constraint, not persona

The accountant is **not a primary or secondary persona** — they're a constraint that the workflow must respect:

- Numbering rules they configure in Subiekt must be honored (OL doesn't override)
- VAT correctness depends on Subiekt's tax-code mapping (OL provides correct tax data, Subiekt applies rules)
- Monthly closure timing must not break (OL respects "invoiced in current month" semantics)
- KSeF submission is Subiekt's concern (OL doesn't touch KSeF directly)

Decision: build the UX for the shop owner; the accountant gets correct fiscal output as a byproduct, no special UX. If accountant-specific friction emerges in field use, that triggers a separate Phase A.

---

## 3. Evidence & user research

> **Phase B in progress — 2026-05-16**

### 3.1 Existing internal evidence — Sfera bridge reference

A friend-provided reference codebase at `/Users/piotrswierzy/Downloads/sfera-api-main` demonstrates a concrete, working pattern for accessing Subiekt nexo from outside the Windows machine: a local .NET 8 HTTP REST wrapper around InsERT's Sfera (Moria) framework.

**Key facts:**

- **Architecture:** .NET 8 Windows-only ASP.NET Core service (`net8.0-windows`, `UseWPF=true`) running on the seller's Windows machine alongside Subiekt nexo, listening on `:5005`
- **References:** `InsERT.Moria.Sfera` and `InsERT.Moria.API` DLLs loaded directly from the Subiekt nexo deployment binaries directory
- **Authentication to Subiekt:** Windows Auth or SQL credentials (configurable) + Subiekt user credentials (e.g., `Szef`)
- **Hybrid data access:**
  - **Reads** go through direct SQL Server queries (`Microsoft.Data.SqlClient`) against the `ModelDanychContainer.*` schema for performance
  - **Writes** must go through Sfera's business operations (document API) for correctness — the codebase comments explicitly: *"Listing goes through SQL — the pure Sfera *Dane interfaces need a UnitOfWork scope that Sfera doesn't set up outside of business operations."*
- **Currently exposed endpoints:**
  - `GET /api/towary` — list products (Asortymenty)
  - `GET /api/towary/{symbol}` — product by symbol
  - `GET /api/kontrahenci`, `GET /api/kontrahenci/{id}` — trading partners (customers/suppliers)
  - `GET /api/magazyny` — warehouses
  - `GET /api/stany`, `GET /api/stany/{symbol}` — stock levels per warehouse / per product
  - `GET /api/partie/{symbol}` — batches (delivery codes)
  - `POST /api/przyjecie` — warehouse receipt (PW document) — **first write endpoint, currently cheating via direct SQL `MERGE` on `StanyMagazynowe`; comment notes: "In production, this should go through Sfera's document API"**
- **Currently NOT exposed:** invoice issuance, customer creation, document corrections, KSeF status read

**What this validates for #728:**

1. **The bridge pattern is real and tractable.** A seller's Windows box can host this alongside Subiekt nexo; OL (Linux container) calls it over HTTP. No need for OL to embed COM/Windows-specific code.
2. **Bridge runs against regular Subiekt nexo** — no nexo PRO license required. This is the key insight: the addressable market is materially wider than the original "nexo PRO REST API only" hypothesis.
3. **Invoice issuance is the next endpoint to add to the bridge.** Comments in the codebase indicate the author is aware that writes need Sfera's document API; the warehouse-receipt POST is a placeholder pattern. We can extend / contribute back to this same pattern for invoice POST.
4. **Operational complexity is real**: seller now runs 2 things (Subiekt + bridge service). Bridge must be reachable from OL — typically LAN, or via reverse tunnel for self-hosted OL deployments. This is friction but the friction is well-understood and shared with the broader "self-hosted OL + accounting software on-prem" deployment model anyway.

### 3.2 External research findings

Conducted by `product-researcher` subagent, 2026-05-16. Full report archived in decision log. Key findings:

**KSeF mandate is ALREADY ACTIVE for SMB:**

| Date | Who is required |
|---|---|
| **1 February 2026** | Large taxpayers (>200M PLN VAT turnover in 2024) |
| **1 April 2026** | All other VAT taxpayers, including SMBs and most JDG ← **NOW** |
| **1 January 2027** | Smallest businesses (single invoice ≤450 PLN, monthly ≤10k PLN) |

Transition window for SMB ≤10k PLN/month invoiced sales runs through Dec 2026. Sources: [amavat](https://amavat.pl/terminy-i-obowiazki-zwiazane-z-ksef-aktualny-harmonogram-zmian/), [Comarch](https://www.comarch.pl/krajowy-system-e-faktur-ksef/ksef-2026/), [infakt](https://www.infakt.pl/blog/wdrozenie-ksef-harmonogram-2026-r/).

**Implication**: today is 2026-05-16 — SMB mandate is in effect right now. Delegating to Subiekt (which handles KSeF transmission natively in nexo PRO) is now strongly preferred over OL generating raw invoices. **Sharpens the `InvoicingPort` contract: OL triggers, Subiekt issues + transmits.**

**Subiekt tier targeting — research reverses initial Phase A assumption:**

- nexo PRO **bundles Sfera license for free** (no extra cost for our adapter users)
- nexo PRO is **where active e-commerce sellers are** — SubSync2, SellIntegro, BaseLinker integration all require nexo PRO
- Subiekt GT is on InsERT's deprecation trajectory (still in active use, but no longer recommended)
- For GT, Sfera is a **separate paid add-on** (~250-500 PLN per workstation per [antywirus.net.pl](https://antywirus.net.pl/insert/subiekt/gt/rozszerzenie-sfera), [3rp.com.pl](https://3rp.com.pl/sklep/moduly/faktury/insert-sfera-dla-subiekta-gt-pierwsze-stanowisko-licencja-elektroniczna-dostepna-online/))

This **reframes A2**: targeting **nexo PRO via Sfera bridge** is the correct primary path. The original concern ("nexo PRO is expensive license, smaller install base") was incorrect for the e-commerce-active segment of PL SMBs. GT support remains valuable as a fast-follow if demand surfaces, but it's not the primary target.

**Commercial bridge pattern validated:** at least 5 known competitors operate the exact pattern OL would build (Windows bridge + REST wrapper for Subiekt nexo PRO):

| Competitor | Pricing | Approach |
|---|---|---|
| SubSync2 (icpc.pl) | 1–2 year licenses | Subiekt nexo PRO + GT integrator for BaseLinker/Sellasist/IdoSell |
| SellIntegro | ~50 zł/month per plugin | Modular per-channel subscriptions |
| Orbis Software | Custom | .NET/C# SDK middleware; certified BaseLinker partner |
| Easy Nexo Integrator | Per-deployment | nexo PRO ERP integrator |
| Giraffe Studio "Subiekt REST API" | Subscription | Direct REST-wrapper precedent for sfera-api-main pattern |
| BaseLinker (official) | Built-in | Uses Subiekt NEXO SDK via local agent/middleware, NOT nexo PRO REST API directly |

Sources: [SellIntegro pricing](https://wiki.sellintegro.com/cennik/), [integratory.pl](https://integratory.pl/produkt/subsync-baselinker-integrator-baselinker-subiekt-nexo-pro-i-subiekt-gt/), [BaseLinker integration](https://base.com/en-US/integrations/subiekt_nexo_pro/), [Orbis Software](https://orbis-software.pl/blog/integracja-subiekt-nexo-z-baselinker-w-2025-kompletny-przewodnik-polskiego-eksperta).

**OL's differentiator vs competitors**: OSS + self-hosted + transparent (no per-month plugin fees, no vendor lock-in, code auditable). Comparable functionality at zero recurring cost.

**InsERT API terms — key findings:**

- **Sfera is the only InsERT-sanctioned write path** ([InsERT GT Sfera info](https://www.insert.com.pl/dla_uzytkownikow/e-pomoc_techniczna/7667,sfera-dla-insert-gt-%E2%80%93-informacje-zaawansowane.html))
- **No public REST API for Subiekt nexo PRO** directly from InsERT — Giraffe Studio's "Subiekt REST API" is third-party
- InsERT API developer portal at `konto.insert.com.pl` covers Gestor nexo, InsERT nexo, **Subiekt 123** (a separate SaaS product) — NOT Subiekt nexo PRO
- **No published "partner program" terms** for third-party integrators; existing commercial competitors operate without explicit InsERT certification (likely)
- **Open question for follow-up:** is shipping our adapter as Apache-licensed OSS compatible with the Sfera EULA? Needs PL legal review or direct InsERT contact.

**Pain-points from accountant/seller forums** (consistent across multiple sources, become Phase D acceptance criteria):

- Long invoice latency (target ≤30 minutes from order paid to invoice issued)
- NIP detection misses (Allegro masked emails compound this)
- VAT-margin scheme auto-selection triggers tax audits — must be off by default
- Order number truncation (Allegro IDs too long for Subiekt GT document numbers)
- Contractor deduplication (new online customers create duplicate `Podmioty` rows)
- Advance payment booking (Allegro Pay / PayU misrouted to wrong accounts)
- VAT rate conflicts across channels (same product priced 23% on one, 8% on another)

Sources: [Allegro forum 744460](https://spolecznosc.allegro.pl/t5/zaawansowani-sprzedawcy/automatyzacja-wystawiania-faktur-z-allegro/td-p/744460), [Fakturownia sugester](https://sugester.fakturownia.pl/173496572), [Orbis Software 15 pain points](https://orbis-software.pl/blog/integracja-subiekt-nexo-z-baselinker-w-2025-kompletny-przewodnik-polskiego-eksperta), [pbs-soft-serwis](https://pbs-soft-serwis.pl/najczestsze-problemy-z-automatycznym-wystawianiem-faktur-w-subiekt-jak-je-rozwiazac/), [bezprawnik.pl](https://bezprawnik.pl/faktura-vat-marza-na-allegro/).

### 3.3 Phase B impact on Phase A decisions

| Phase A decision | Phase B impact |
|---|---|
| A1 — port-first framing | ✅ Strengthened. Multiple invoicing systems exist in PL market (Subiekt + Fakturownia + iFirma + wFirma + inFakt) → port pays off. |
| A2 — Sfera bridge primary | ⚠️ **Refined**, not contradicted. Sfera bridge IS the right path, but the target is **Subiekt nexo PRO** (which bundles Sfera free), NOT Subiekt GT (which requires separate Sfera purchase). Earlier worry about "nexo PRO smaller install base" was incorrect for the e-commerce segment. |
| A3 — shop owner primary | ✅ Confirmed. Forum signals confirm shop owner is the user with daily pain. |
| A4 — configurable trigger | ✅ Confirmed. Different shop conventions documented in forums. |
| A5 — NIP-aware paragon/faktura | ✅ Confirmed. NIP detection misses are a documented pain point — built-in NIP detection is a real differentiator. |

### 3.4 Sfera support clarification (Gate B follow-up)

A key clarification: "Sfera" is one concept but **two distinct SDK implementations** with different licensing:

| Subiekt product | Sfera flavor | SDK | Licensing | In v1 scope? |
|---|---|---|---|---|
| Subiekt nexo PRO | Sfera nexo | .NET (`InsERT.Moria.Sfera.dll`) | **Bundled free** | ✅ **Primary target** |
| Subiekt nexo (vanilla) | Sfera nexo | .NET (same DLLs) | Uncertain availability | ⚠️ Best-effort, requires verification |
| Subiekt GT | Sfera GT | **COM/OLE Automation** | Separate paid add-on (~250-500 zł/workstation) | ❌ v2 — separate bridge needed |

**Implication:** "we support Sfera" does NOT mean "we support all Subiekt versions". One Sfera adapter ≠ one bridge service for all products. v1 ships nexo-family support via .NET-SDK-based bridge; GT would require an independent bridge using COM Automation as a separate v2 effort (its own adapter under the same `InvoicingPort`).

**Documentation commitment**: the integration page MUST clearly state supported Subiekt versions (nexo PRO confirmed, vanilla nexo TBD, GT not yet supported) so users don't deploy blind.

### 3.5 Capability-declaring adapters — design principle confirmed

OpenLinker is international-by-design. Polish-specific concepts (KSeF, JPK) cannot leak into UI surfaces seen by non-PL users.

**Pattern:** `InvoicingPort.getCapabilities()` returns adapter-declared capabilities (e.g., `regulatory-transmission-tracking`, `invoice-corrections`, `receipt-issuance`). OL UI **conditionally renders** based on the active adapter's declared capabilities. A DACH user on a hypothetical DATEV adapter never sees "KSeF" terminology — they see whatever their adapter declares (e.g., ZUGFeRD).

**Operator-level toggle**: even within supported capabilities, the operator can disable surfacing per-connection (suppress KSeF noise if irrelevant to them).

### 3.6 Bridge ownership (Gate B follow-up)

**Decision: build OL's own bridge** rather than fork friend's `sfera-api-main` or document third-party install. Rationale: DX/UX is a v1 priority; "go install some guy's repo from internet" is not credible. OL's bridge will:

- Be a Windows MSI / portable EXE under OL's release pipeline
- Implement REST endpoints OL's adapter expects (we control the contract)
- Support nexo family via .NET SDK
- Be MIT/Apache-licensed under OL's `libs/integrations/subiekt-bridge/` or sibling repo (TBD)
- Inspiration: `sfera-api-main` validates feasibility and showcases endpoint patterns

Phase C will decide exact deployment story (MSI vs portable, configuration UX, OL↔bridge discovery).

### 3.7 Resolved Phase B open questions

| ID | Question | Resolution |
|---|---|---|
| OQ-B1 | Sfera EULA + OSS distribution | **Workaround**: OL's bridge ships as OSS code only (no bundled InsERT binaries); user installs Subiekt + Sfera independently. No InsERT DLL redistribution. Long-term legal review still recommended before public marketing. |
| OQ-B2 | Exact Subiekt market % | **Non-blocking**. Strong qualitative signal that nexo PRO is the e-commerce-active tier. Sufficient for v1 targeting. |
| OQ-B3 | Bridge ownership | **Resolved**: OL builds its own bridge (Phase B follow-up decision). |
| OQ-B4 | KSeF UI surfacing | **Resolved via capability-declaring pattern** (§3.5): regulatory transmission tracking is a declared capability, surfaced conditionally + operator-toggleable. International users without PL adapter see nothing PL-specific. |

---

## 4. Solution exploration

> **Phase C in progress — 2026-05-16**. Phases A+B locked many constraints (port-first, nexo PRO via own bridge, shop owner persona, configurable trigger, NIP-aware, capability-declaring). Phase C explores the operator-facing UX shape within those constraints.

### 4.1 Constraints from Phases A+B

- `InvoicingPort` is port-first with capability-declaring adapters
- v1 target: Subiekt nexo PRO via OL-built Windows bridge (Sfera .NET SDK)
- Vanilla nexo support: best-effort (depends on Sfera availability)
- GT support: deferred to v2 (separate bridge)
- Per-connection configurable trigger (auto-on-paid / auto-on-shipped / manual / batched)
- NIP-aware paragon vs faktura detection
- Bridge is OL-owned, OSS-distributed, Windows MSI/portable
- Pain-points become acceptance criteria: ≤30 min latency, NIP detection correctness, VAT-margin OFF by default, contractor dedup, advance-payment routing

### 4.2 Three candidate UX shapes

What's still open: **the operator-facing UX shape** — how invoices surface in OL, what controls operator has, what's v1 vs v2.

#### Shape E1 — "Just an output stream"

- Operator configures connection → invoicing happens silently per trigger config
- Invoice status surfaces in **order detail only** (no /invoices page)
- No bulk operations
- Manual "Issue invoice" button per order as fallback when auto-config fails
- No correction workflow
- **MVP cost:** ~3-4 weeks

**Persona fit:** matches "shop owner wants this to just work, doesn't want another tool to learn"
**Risk:** when things fail mid-batch (Subiekt down, NIP rejected), operator has to hunt through orders one-by-one to find what didn't invoice

#### Shape E2 — "Operator-controlled invoice surface" (recommended hypothesis)

- Everything in E1, plus:
- **`/invoices` page** — list view across all orders/connections with filters (status, date, connection, Smart-or-not, NIP/no-NIP)
- **Per-order detail panel** with invoice status badge + "Issue invoice" / "Re-issue" buttons
- **Regulatory status badge** (KSeF / equivalent) per invoice, conditional on adapter capability declaration
- **Connection settings** for trigger model + bridge URL config
- No bulk operations (v2 polish)
- No correction workflow (v2)
- **MVP cost:** ~4-5 weeks

**Persona fit:** shop owner gets visibility + control; "issue invoice" as routine operation rather than buried-in-order action
**Risk:** modest UI surface area to maintain

#### Shape E3 — "Workflow-rich with bulk and corrections"

- Everything in E2, plus:
- **Bulk action** on orders list ("issue invoices for N selected")
- **Faktura korygująca** (correction) workflow for returns / adjustments
- **Failed-invoice retry** UX with reason surfacing (Subiekt error → operator action)
- **Customer dedup detection** (warn when adding "Jan Kowalski" who looks like existing Subiekt contractor)
- **MVP cost:** ~6-7 weeks

**Persona fit:** addresses every documented pain point in Phase B research
**Risk:** scope creep; v1 ship date slips into Q2

### 4.3 Comparison

| | E1 minimal | **E2 recommended** | E3 full |
|---|:---:|:---:|:---:|
| Effort | 3-4 wk | 4-5 wk | 6-7 wk |
| Persona fit | Medium | High | Highest |
| Failure recovery UX | Bad | OK | Good |
| Pain-point coverage (from Phase B) | 2 of 7 | 4 of 7 | 7 of 7 |
| Scope creep risk | Low | Low | High |
| Path to E3 later | Major refactor | Incremental | n/a |

### 4.4 Sub-decisions to lock in Phase D (regardless of E1/E2/E3 choice)

**SC-1 — Bridge installer format** ✅ **resolved at Gate C**
- v1 production: **Portable Windows ZIP** — download, unzip, edit `appsettings.json`, run `OpenLinker.SubiektBridge.exe`. Low setup friction for someone already administering Subiekt.
- v1 dev: **`FakeSubiektBridgeAdapter`** at `libs/integrations/subiekt/testing/` for Mac/Linux OL development — implements bridge REST contract, returns mock data. Enables OL adapter dev without Windows VM.
- v2 polish: MSI installer with config UX; optional Linux Docker mock image for dev playgrounds.
- **Why not docker-compose for production bridge:** Subiekt itself is Windows-only (InsERT does not ship for Linux/Mac). Sfera DLL requires .NET on Windows + WPF + hard Windows paths + native COM. Linux containers cannot host the bridge. Anyone using Subiekt already has a Windows machine — bridge co-locates with Subiekt at zero additional hardware burden. End users without a Windows machine don't use Subiekt, so the capability-declaring pattern (§3.5) hides Subiekt UI from them entirely. **The "Mac/Linux deployment story" for production bridge is n/a, not a problem to solve.**

**SC-2 — Bridge ↔ OL discovery** ✅ **resolved at Gate C: (a) Manual config**
- Operator enters bridge URL in connection settings (e.g., `http://192.168.1.5:5005`)
- mDNS auto-discovery and reverse-tunnel are v2 polish

**SC-3 — Customer sync timing** ✅ **resolved at Gate C: (a) Lazy**
- Upsert customer only when issuing invoice
- Eager / background sync are v2 polish if needed

**SC-4 — Capability vocabulary (initial set)** ✅ **resolved at Gate C**
- v1 ships `getCapabilities()` returning: `regulatory-transmission-tracking` (KSeF for the Subiekt adapter; ZUGFeRD/XRechnung for future DE adapters), `receipt-issuance` (paragon vs faktura)
- Additional capabilities declared as adapters add them: `invoice-corrections` (v2 of Subiekt adapter), `multi-currency` (when needed), `customer-deduplication-warning` (when added)

### 4.5 "Do nothing" honest evaluation

If we don't build #728:
- Q1 wedge promise of "complete workflow in OL" remains unfulfilled
- Shop owners still spend 30-60 min/day on manual Subiekt entry
- KSeF mandate (already in effect) forces shops to ensure SOMETHING handles fiscal flow — if not via OL, they stay on BL or other tools that already have Subiekt integration
- **Adoption ceiling**: OL is unusable end-to-end for any PL shop with B2B sales

Verdict: "do nothing" cuts OL out of the PL SMB e-commerce market entirely. Not viable.

### 4.6 Recommendation

**Shape E2** + sub-decisions SC-1=(b), SC-2=(a), SC-3=(a), SC-4=(2 capabilities ship in v1).

Reasoning:
- E2 covers 4/7 Phase B pain points with linear (not exponential) UX cost vs E1
- Failure-recovery UX matters more than bulk operations for shop-owner persona (occasional, manual oversight expected)
- Path to E3 features is incremental — bulk, corrections, dedup can land as v2 polish without refactor
- Bridge installer + discovery: conservative (portable ZIP + manual URL) for v1 keeps support surface small while we learn what users actually struggle with

**Effort estimate**: ~4-5 weeks wall-clock for adapter + bridge + FE, with backend + FE in parallel.

---

## 5. Product specification

> **Phase D in progress — 2026-05-16**. Stage-1 calibration applies (user stories + AC required; success metrics replaced with qualitative DoD; risks capped at 3-5 product-direction).

### 5.1 User stories

**US-1 — Connect Subiekt instance**

> As a shop owner, I want to connect my Subiekt nexo PRO installation to OpenLinker by entering the local bridge URL and credentials, so that OL can issue invoices into my existing fiscal stack without me manually re-entering data.

**US-2 — Configure when invoices are issued**

> As a shop owner, I want to choose per-connection whether invoices are issued automatically (on paid / on shipped), manually (button per order), or in batches, so that the workflow matches my shop's conventions.

**US-3 — Receipt vs invoice based on buyer**

> As a shop owner, I want OL to automatically issue a faktura when the buyer has a NIP and a paragon when they don't (unless the buyer explicitly requested an invoice), so that I don't have to think about document type per order.

**US-4 — See invoice status per order**

> As a shop owner, I want to see on each order in OL whether its invoice has been issued, the invoice number, and a link to the invoice in Subiekt, so that I don't have to switch between tools to check status.

**US-5 — Issue / re-issue invoice manually**

> As a shop owner, I want to click "Issue invoice" or "Re-issue" on any order, so that I can override the automatic flow when something needs human attention.

**US-6 — Review invoices across orders**

> As a shop owner, I want a dedicated `/invoices` page listing all issued invoices with filters (status, date, connection, with/without NIP), so that I can quickly find what I'm looking for.

**US-7 — See regulatory status when applicable**

> As a shop owner using Subiekt in PL, I want to see KSeF transmission status on each invoice (sent / pending / failed with reason), so that I have visibility into my fiscal compliance.

**US-8 — International users see only what applies to them**

> As a shop owner using OL outside Poland (e.g., DACH), I want to NOT see any PL-specific terminology (KSeF, NIP, faktura) in my UI, so that the product doesn't confuse me with concepts I don't use.

### 5.2 Acceptance criteria

User-visible criteria. Engineering AC (rate limits, retry policies, schema migrations) belong in Tier 2 implementation plans.

**AC-1** (US-1): operator can configure a Subiekt connection by providing bridge URL + Subiekt credentials in connection settings; connection-test passes when bridge is reachable and credentials are valid; clear error if bridge is unreachable or credentials wrong.

**AC-2** (US-2): connection settings include a "Trigger model" dropdown: `Manual` / `Auto on order paid` / `Auto on order shipped` / `Batched (operator-initiated)`. Selection persists per connection; changing it affects only future orders, not historical.

**AC-3** (US-3): when OL submits an invoice, it inspects the buyer's NIP (from Allegro/PrestaShop order payload). NIP present + valid format → faktura VAT. NIP absent or invalid → paragon. Operator can override per-order via edit on order detail.

**AC-4** (US-4): order detail page shows an "Invoice" panel with: status (`not issued` / `pending` / `issued` / `failed`), invoice number (when issued), document type (faktura / paragon), link out to Subiekt for the full document, error message (when failed).

**AC-5** (US-5): "Issue invoice" button on order detail enabled when status is `not issued` or `failed`; clicking triggers OL → bridge → Subiekt flow; success updates panel; failure shows operator-friendly message with retry option.

**AC-6** (US-6): `/invoices` page lists all invoices with columns: invoice number, document type, order link, customer name/NIP, status, issued date, regulatory status (when applicable). Filters: status, date range, connection, with/without NIP, regulatory status. Click row → order detail.

**AC-7** (US-7): when adapter declares `regulatory-transmission-tracking` capability AND operator hasn't disabled it per-connection, each invoice shows a regulatory status badge (label depends on adapter — for Subiekt: "KSeF"). Badge states: `✅ sent` / `⚠️ pending` / `❌ failed` with reason. Per-connection toggle in settings: "Show KSeF status".

**AC-8** (US-8): adapters that do NOT declare `regulatory-transmission-tracking` show no regulatory badge. Adapter language preferences (e.g., "faktura" vs "invoice", "paragon" vs "receipt") are localized via i18n catalog — never hardcoded in OL UI.

**AC-9** (cross-cutting — bridge): bridge ships as portable Windows ZIP via OL's release pipeline. README in the ZIP explains: edit `appsettings.json` → run `OpenLinker.SubiektBridge.exe` → confirm bridge is reachable from OL. Supported Subiekt versions documented prominently: ✅ nexo PRO, ⚠️ vanilla nexo (best effort), ❌ GT (planned v2 via separate bridge).

**AC-10** (cross-cutting — fake adapter): `libs/integrations/subiekt/testing/FakeSubiektBridgeAdapter` exists and is consumed by OL adapter `*.spec.ts` tests, enabling OL adapter development on Mac/Linux without Windows VM.

---

## 6. Out of scope

> **Phase D — 2026-05-16**. Top items someone might actually ask about (Stage 1 calibration).

| Item | Reason |
|---|---|
| **Subiekt GT support** | Different SDK (COM Automation vs .NET), requires separate bridge — v2 effort as a sibling adapter under same `InvoicingPort` |
| **Faktura korygująca** (invoice corrections) | v2 polish; v1 ships issuance only |
| **Bulk action** ("issue invoices for selected orders") | v2 polish (Phase B showed it's wanted but per-order works for v1 volumes) |
| **OL-native invoice generation** | We delegate to Subiekt by design; only reconsider if a non-Subiekt + non-Fakturownia + non-iFirma adapter is requested |
| **Direct KSeF integration** | Subiekt handles KSeF transmission; OL only reads status |
| **JPK_FA export** | Accountant pulls JPK from Subiekt directly |
| **MSI installer for bridge** | Portable ZIP for v1; MSI is v2 polish |
| **Bridge auto-discovery / mDNS / reverse tunnel** | Manual URL config for v1 |
| **Other invoicing providers** (Fakturownia, iFirma, etc.) | Separate impl issues against the same `InvoicingPort` once stable — not separate Product Designs |

---

## 7. Definition of done

> **Phase D — 2026-05-16**. Stage-1 qualitative bullets — quantitative metrics deferred until OL has telemetry infra.

The feature is considered successfully delivered when:

- **The maintainer (or a co-maintainer) has used it for their own real PL shop** for ≥30 days without falling back to manual Subiekt entry
- **At least 2 design-partner shops have used it in production** with no Subiekt-related support tickets escalating to "the integration is unusable"
- **Documentation makes Subiekt version support crystal clear** — nexo PRO ✅, vanilla nexo ⚠️ (best-effort), GT ❌ (planned v2). No user deploys blind.
- **A DACH user on a hypothetical non-Subiekt adapter sees zero PL fiscal terminology** in their UI — the capability-declaring pattern is genuine, not theater
- **Failure modes surface actionably** — when Subiekt is down, NIP is rejected, or KSeF temporarily fails, the operator sees clear messages and a retry path, not opaque errors

If any of these prove false within 60 days of release to design partners, this Product Design returns to Phase A for re-review.

---

## 8. Risks

> **Phase D — 2026-05-16**. Top product-direction risks. Engineering risks (rate limits, SQL contention, bridge restart handling) belong in Tier 2 implementation plans.

| ID | Risk | Mitigation |
|---|---|---|
| **R1** | InsERT decides Sfera-based third-party bridges violate their licensing model and asks us to stop | Bridge ships OSS code only (no bundled InsERT binaries). User installs Subiekt + Sfera under their own InsERT license. Existing commercial competitors (SubSync2, SellIntegro, BaseLinker) operate the same pattern, so it's well-established. Long-term legal review still recommended before public marketing push. |
| **R2** | Shop owners run vanilla nexo (not PRO) and Sfera DLLs aren't available there — adapter doesn't work | Documentation states version support clearly upfront (AC-9). Best-effort verification of vanilla nexo before v1 release; if it doesn't work, narrow positioning to "nexo PRO only" and add vanilla nexo as v2 if demand emerges. |
| **R3** | KSeF mandate enforcement timeline shifts again (was postponed 3+ times already) and shops don't actually adopt KSeF aggressively | Doesn't invalidate the feature — invoicing automation is valuable regardless of KSeF urgency. KSeF status surfacing is conditional on adapter capability + operator toggle, so it can't become noise if KSeF underuse persists. |
| **R4** | The "shop owner uses it, accountant complains" failure mode — accountant doesn't like automated invoices in Subiekt that they didn't enter, breaks their workflow | Configurable trigger (US-2) covers the cases where the accountant wants gated control (e.g., "operator-initiated batches" so accountant sees a stage before commit). If accountant friction is widespread, may need a v2 "accountant approval queue" surface. |

---

## 9. Implementation breakdown

> **Phase E complete — 2026-05-16**. Gate D = YES.

Ten implementation issues spawned, each independently shippable. Engineering risks and detailed effort breakdowns live in each issue + Tier 2 `/plan` outputs.

| # | Title | Effort | Blocks |
|---|---|:---:|---|
| [#751](https://github.com/SilkSoftwareHouse/openlinker/issues/751) | `InvoicingPort` + capability declarations + `InvoiceRecord` + `BuyerProfile` + migration | S (~3-5d) | #753, #754, #757, #758, #759 |
| [#752](https://github.com/SilkSoftwareHouse/openlinker/issues/752) | OL Subiekt Bridge bootstrap — .NET 8 Windows project + REST contract + release pipeline | M (~5-7d) | #755, #756 |
| [#753](https://github.com/SilkSoftwareHouse/openlinker/issues/753) | Subiekt adapter plugin — HTTP-to-bridge implementation of `InvoicingPort` | S (~3-5d) | #757, #758, #759 |
| [#754](https://github.com/SilkSoftwareHouse/openlinker/issues/754) | `FakeSubiektBridgeAdapter` for Mac/Linux dev | S (~2-3d) | — (enables #753 dev) |
| [#755](https://github.com/SilkSoftwareHouse/openlinker/issues/755) | Bridge: invoice issuance endpoint via Sfera nexo .NET SDK | M (~5-7d) | — |
| [#756](https://github.com/SilkSoftwareHouse/openlinker/issues/756) | Bridge: customer (kontrahent) upsert endpoint via Sfera | S (~2-3d) | — |
| [#757](https://github.com/SilkSoftwareHouse/openlinker/issues/757) | FE: order detail invoice panel + manual issue/re-issue buttons | S (~2-3d) | — |
| [#758](https://github.com/SilkSoftwareHouse/openlinker/issues/758) | FE: `/invoices` page with filters | M (~4-5d) | — |
| [#759](https://github.com/SilkSoftwareHouse/openlinker/issues/759) | FE: Subiekt connection settings (trigger model + bridge URL + capability toggles) | S (~3d) | — |
| [#760](https://github.com/SilkSoftwareHouse/openlinker/issues/760) | Docs: Subiekt integration page with version support matrix | S (~2d) | — (last child) |

**Critical path:** #751 + #752 (parallel) → #753 / #755 / #756 → #757 / #758 / #759 → #760

**Parallelizable from day 1:** #751 (domain), #752 (bridge bootstrap), #754 (fake adapter — independent)

**Total wall-clock estimate:** ~4-5 weeks with 1 backend + 1 FE + 1 .NET (bridge) dev in parallel; ~6-8 weeks with single-stack devs.

**ADRs likely to be filed during Tier 2** (only when architectural reviewer requests):
- Capability-declaring port pattern (`InvoicingPort.getCapabilities()`) — first usage in OL
- Bridge as OL-owned .NET project — bridge ownership model
- Capability-conditional FE rendering pattern — reusable for future invoicing adapters and other port types
- Existing ADR practice introduced via #725

---

## 10. Decision log

| Date | Phase | Decision | Reasoning | Decider |
|---|---|---|---|---|
| 2026-05-16 | Pre-A | Convert #728 from discovery/refinement issue to Product Design issue under workflow | Same pattern as #726 conversion — legacy issue style, content preserved as Phase B evidence input | @piotrswierzy (via workflow application) |
| 2026-05-16 | A→B | Phase A confirmed: port-first framing, Sfera bridge approach as primary Subiekt path (nexo PRO REST = future sibling adapter), shop owner primary persona (accountant = constraint), trigger configurable per-connection, paragon/faktura detected by NIP | See §1 ambiguity resolutions A1-A5 | @piotrswierzy |
| 2026-05-16 | B | Sfera bridge reference codebase (sfera-api-main, friend-provided) added as primary internal evidence. Validates bridge architecture as feasible, opens market beyond nexo PRO. Phase B external research scoped to: market distribution, commercial precedents, ToS, KSeF timeline, accountant signals | See §3.1 | @piotrswierzy |
| 2026-05-16 | B | Phase B external research complete. Key reframings: (1) KSeF SMB mandate is already in effect since 2026-04-01, not future — strongly supports "delegate to Subiekt" architecture. (2) Target is nexo PRO via Sfera bridge (not GT — Sfera is bundled free in nexo PRO; GT requires separate ~250-500 PLN Sfera license). (3) Bridge pattern commercially validated by 5+ competitors. (4) OL's edge is OSS + transparent pricing. (5) Common pain points (NIP detection, ≤30 min latency, VAT-margin off, contractor dedup) become Phase D acceptance criteria | See §3.2 | product-researcher subagent + @piotrswierzy |
| 2026-05-16 | Gate B | Sfera scope clarified: nexo family (PRO + vanilla TBD) via .NET SDK bridge; GT requires separate v2 bridge using COM Automation. Bridge ownership: OL builds own (not fork). Capability-declaring adapter pattern adopted for international UX (KSeF surfaces conditionally). Supported Subiekt versions documented prominently. Gate B passed | See §3.4-§3.7 | @piotrswierzy |
| 2026-05-16 | C | Shape E2 ("operator-controlled invoice surface") chosen. `/invoices` page + per-order panel + manual buttons + KSeF badge conditional on capability. Bulk + korekta + dedup deferred to v2 | See §4.2-§4.6 | @piotrswierzy |
| 2026-05-16 | C | Sub-decisions resolved: SC-1 = Portable Windows ZIP for production + FakeSubiektBridgeAdapter for Mac/Linux dev (docker-compose for production bridge is n/a — Subiekt is Windows-only); SC-2 = manual URL config; SC-3 = lazy customer sync; SC-4 = 2 capabilities in v1 (regulatory-transmission-tracking, receipt-issuance) | See §4.4 | @piotrswierzy |
| 2026-05-16 | Gate C | Gate C passed. Proceeding to Phase D specification | All Gate C decisions confirmed by maintainer | @piotrswierzy |
| 2026-05-16 | D | Phase D specification: 8 user stories, 10 user-visible acceptance criteria, 9 explicit out-of-scope items, qualitative DoD (Stage-1 calibration), 4 product-direction risks | See §5-§8 | @piotrswierzy |
