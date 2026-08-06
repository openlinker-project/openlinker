# Product Spec — #1902 Polish e-receipt (e-paragon) support via eparagony.pl

**Status:** phase A complete; phase B complete; phase C complete (Gate C = A+E, 2026-07-29); phase D complete; Gate D = YES (build); phase E complete — ready for implementation
**Parent issue:** [#1902](https://github.com/openlinker-project/openlinker/issues/1902)
**Started:** 2026-07-28
**Last updated:** 2026-07-28
**Workflow:** [`docs/contributors/refinement-workflow.md`](../contributors/refinement-workflow.md)

---

## 1. Problem

> **Phase A — draft, pending Gate A**

### Problem statement

A Polish seller who is **obliged to operate a fiscal cash register** must produce a `paragon fiskalny` for every B2C sale. That obligation is discharged by a **homologated fiscal device** — an online fiscal printer (Posnet / Novitus / Elzab) or a sector-restricted `kasa wirtualna` — never by an order-management system.

For an online seller running OpenLinker, this creates a split: the order is in OL, but the receipt is produced on a physically separate track by whatever software drives the printer. Concretely, the operator today either

- runs the printer vendor's own software and **re-keys or re-imports** order lines into it, with no link back to the OL order; or
- runs one of eparagony.pl's existing platform connectors (WooCommerce, PrestaShop, Shopify, Comarch, enova365, Subiekt, **BaseLinker/Base**) — in which case the receipt is driven from *that* system, not from OL; or
- prints paper and encloses it with the parcel.

The gap is therefore **not** "OpenLinker cannot issue receipts" (nothing can, except a fiscal device). It is: *an OL-centric seller in this segment has no path from an OL order to a fiscal receipt, so OL cannot be their single operational surface — they must keep a second system in the loop specifically for receipts.*

**Volume of pain — unquantified.** We have no measurement of how much operator time the re-keying costs, nor how many OL-relevant sellers are in this segment. Contrast #728 (invoicing), where the spec could assert "30–60 minutes of daily manual data entry" from concrete order-volume reasoning. Here we cannot, and Phase B must either produce that number or the problem statement is a hypothesis rather than a finding. **Flagged as the key evidence gap.**

### Why now (and the honest answer: nothing forces it)

Three candidate "why now" arguments, graded:

| Argument | Status |
|---|---|
| Regulatory deadline forces it | ❌ **False.** There is no e-paragon mandate. MF's HUB paragonowy is voluntary, hardware-gated, requires per-transaction buyer consent, and `podatki.gov.pl` states *"Klient zawsze może otrzymać paragon papierowy"*. No KSeF-analogous deadline exists. |
| The addressable base is growing | ⚠️ **Weakly.** The exemption regulation (Dz.U. 2024 poz. 1902) is time-limited — §8 horizon 31.03.2027, exemptions to 31.12.2027 — and MF has widened the §4 exclusion list at each renewal. Direction of travel enlarges the obliged population, but slowly and unpredictably. |
| Competitive/channel parity | ⚠️ **Unvalidated.** eparagony.pl already integrates BaseLinker. Whether that gap blocks anyone from choosing OL is exactly what Phase B must test. |

So the honest framing is: **no forcing function; this is a discretionary parity/distribution bet.** That does not make it wrong — but it means the bar for evidence in Phase B is higher than for a compliance-driven feature, and "DEFER with a dated re-check" is a live and respectable outcome.

### The framing constraint (carried from the issue, non-negotiable)

OpenLinker can never *issue* a Polish fiscal receipt. Issuance is reserved to a homologated registering device (art. 111 ust. 3a pkt 1 ustawy o VAT), and eparagony.pl itself requires vendor-proprietary software running on a machine that drives a physical online fiscal printer. Anything OL builds is a **thin orchestration/delivery connector**: push order data to the hub, surface the resulting receipt against the order.

This is **not** an `InvoicingPort` `DocumentType`. An invoice and a fiscal receipt differ in issuer, device dependency, and legal basis — see ADR-026 for the invoicing domain this deliberately does *not* extend.

---

## 2. Affected persona

> **Phase A — draft, pending Gate A**

### Primary persona — "register-obliged PL online seller"

| Axis | Value |
|---|---|
| **Company size** | SMB. Below the ~20,000 zł turnover exemption they wouldn't need a register at all; enterprise sellers run ERP stacks that already own this. |
| **Sophistication** | Non-technical operator. Owns a fiscal printer but does **not** configure it — a `serwisant` does. Will not self-serve an API integration. |
| **Volume** | Unknown / to establish. eparagony.pl's own pricing tiers (0–500, up to 3,001–10,000 receipts/month) suggest the paying population clusters low-to-mid hundreds of receipts monthly. |
| **Geography** | **PL only.** This has no meaning outside the Polish fiscal regime — unlike shipping or marketplace adapters, there is no international generalisation. |

### What makes someone a member of this persona

Membership is **legally determined**, which is unusually crisp for a persona definition. A seller is in scope iff they cannot use the mail-order exemption — **poz. 41** of the annex to Dz.U. 2024 poz. 1902 (verified against the official Dziennik Ustaw text; secondary sources variously cite poz. 36 / poz. 15 / poz. 41 — **poz. 41 is correct**).

> *"Dostawa towarów w systemie wysyłkowym (pocztą lub przesyłkami kurierskimi), jeżeli dostawca towaru otrzyma w całości zapłatę za wykonaną czynność za pośrednictwem poczty, banku lub spółdzielczej kasy oszczędnościowo-kredytowej (odpowiednio na rachunek bankowy podatnika …), a z ewidencji i dowodów dokumentujących zapłatę jednoznacznie wynika, jakiej konkretnie czynności dotyczyła i na czyją rzecz została dokonana (dane nabywcy, w tym jego adres)"*

**There is effectively one route in, not two — corrected 2026-07-28.**

**Route A — §4-excluded category (the real route).** §4 ust. 1 disapplies the exemption for enumerated goods regardless of payment method. Verified from the official text: LPG and motor fuels; engine parts, engines, vehicle bodies, trailers/semi-trailers, containers, vehicle parts and accessories (excluding motorcycles); **desktop and portable computers incl. laptops and tablets, peripherals, games consoles and their parts**; **electronics incl. TVs, radios, speakers, telephones incl. smartphones, smartwatches, antennas, displays, monitors, recording/playback devices, navigation, storage devices, alarms**; optical goods; electric motors, generators, transformers; **photographic equipment incl. cameras, lenses, projectors**; **precious-metal goods**; **recorded and unrecorded digital and analogue data media**; tobacco. (Perfumes/eau de toilette and alcohol also appear in §4 per secondary sources; not re-verified line-by-line from the PDF.)

**Route B — cash/COD: RETRACTED as a route.** The Phase A draft asserted that COD breaks the "payment in full via bank" condition, and I told the maintainer at Gate A that COD was *probably the larger population*. **That was wrong.** Courier-collected `pobranie` remitted to the seller's bank account **preserves** the exemption. Confirmed by interpretacja indywidualna **0113-KDIPT1-3.4012.42.2025.2.ALN** (Dyrektor KIS, 24 March 2025), which addresses precisely this fact pattern and holds the exemption applies through 31.12.2027, provided the funds reach the seller non-cash and the records identify transaction and buyer (incl. address). Two independent secondary sources report the same ruling.

Residual cash exposure is narrow: a seller who takes **genuine cash in hand** (personal collection / odbiór osobisty za gotówkę), or whose payment records cannot identify the transaction and buyer. Both are edge cases for an online-first seller, not a population.

**Consequence for this spec:** the addressable base is **materially smaller than the Phase A draft assumed** — it is essentially "PL online sellers trading in §4 categories", not "§4 sellers plus everyone who offers COD". This shrinks the persona and weakens the case for building. Carried into Phase C as a primary input.

Everyone else — the majority of pure PL e-commerce, now explicitly **including ordinary COD sellers** — is exempt and **has no receipt to issue at all**. They are not a degraded-experience user of this feature; they are a non-user.

### Secondary consideration — not a persona

eparagony.pl itself is a **channel**, not a user. If a distribution argument carries this build, that should be recorded as a strategic rationale in Phase C, not smuggled in as user need. Kept separate deliberately.

### Persona ambiguities to resolve at Gate A

1. ~~**Is the §4 route or the COD route the primary one?**~~ **RESOLVED 2026-07-28** — there is only the §4 route; see the retraction above. The persona is narrower than drafted.
2. **Does this persona overlap OL's actual current users at all?** OL's existing integrations skew Allegro + PrestaShop/WooCommerce + InPost/DPD. Whether any known deployment sits in a §4 category is unknown — and if the answer is "none", that is a strong DEFER signal. **Now the single most decision-relevant open question**, since resolving #1 removed the broader population that would have made this moot.
3. **Would this persona even be an OL user?** A seller with a fiscal printer, a `serwisant` relationship, and (likely) Subiekt/Comarch already has an ERP that eparagony.pl integrates directly. OL may be redundant in their stack for this purpose.

### Sources for this section

- Official regulation text: [Dz.U. 2024 poz. 1902 (PDF)](https://dziennikustaw.gov.pl/D2024000190201.pdf) — poz. 41 of the annex and §4 ust. 1 read directly from the Dziennik Ustaw text, 2026-07-28.
- Interpretacja indywidualna 0113-KDIPT1-3.4012.42.2025.2.ALN, Dyrektor KIS, 24.03.2025 — COD-via-courier preserves the exemption. Reported by [inforlex](https://www.inforlex.pl/dok/tresc,FOB0000000000006897971,Zwolnienie-z-obowiazku-ewidencjonowania-sprzedazy-za-pomoca-kas-rejestrujacych-przy-sprzedazy-wysylkowej-towarow-za-pobraniem-Interpretacja-indywidualna-z-dnia-24-marca-2025-r-Dyrektor-Krajowej.html) and [jpk.info.pl](https://jpk.info.pl/aktualnosci/2025/sprzedaz-wysylkowa-bez-kasy-fiskalnej/).
- **Caveat:** an interpretacja indywidualna binds only the applicant. It is strong evidence of the tax authority's settled reading, not universally binding law. Sufficient for a product decision; would need a seller's own confirmation before any compliance claim is made to them.

---

## 3. Evidence & user research

> **Phase B — vendor-surface research complete 2026-07-28. User-pull research NOT done (see gap below).**

### Decision context

The maintainer confirmed at Gate A that we build. Recorded honestly: this is a **maintainer decision on strategic grounds, not an evidence-led conclusion**. The evidence assembled in Phase A runs the other way — no forcing function, no mandate, and a persona that narrowed to §4-category sellers once the COD route was retracted. Phase B was therefore re-scoped from "should we?" to **"what exactly must we build, and on what commercial terms?"**

### The parity spec — what eparagony.pl's BaseLinker connector actually does

Their Base connector is the de-facto definition of "parity", and it is **not** push-only:

- Orders flow automatically from Base → eparagony.pl, which generates the fiscal e-receipt.
- **Status flows back** — *"pełną kontrolę nad procesem wystawiania i wydawania eparagonów dzięki widocznym statusom"*.
- **Each receipt gets a unique link, surfaced in the Base panel.**

So the minimum credible shape is order push **+ receipt status and link read-back onto the order**. A push-only MVP would be visibly thinner than what their BaseLinker users already have.

Seller-side prerequisites are unchanged by any integration choice: vendor-proprietary printer-control software on a Windows/Linux/macOS machine or server, an online fiscal printer (Posnet / Novitus / Elzab) with constant connectivity, and a `serwisant` visit to configure the device. Vendor states ~90 minutes setup for a non-technical user.

### Commercially significant finding — integrator tier vs custom-API tier

eparagony.pl prices connection **by integration class**, charged to the seller on top of a volume-tiered base licence (49–349 zł/mo):

| Class | Add-on (by volume tier) | Examples |
|---|---|---|
| **Integrators** | **+19 / +39 / +69 zł** | BaseLinker/Base, SellAsist, Apilo, ZynqPro |
| eCommerce platforms | +39 / +59–69 / +89–119 zł | WooCommerce, Shopify, PrestaShop |
| ERP / accounting | +49–59 / +79–119 / +129–159 zł | Comarch, enova365, Subiekt |
| **Custom API** | **+79 / +129 / +189 zł** | anyone self-integrating |

**OpenLinker is categorically an integrator** — same shelf as BaseLinker, Apilo, SellAsist. If OL lands in the *Integrators* class our users pay **19–69 zł/mo**; if OL is treated as a *Custom API* customer they pay **79–189 zł/mo**. That is a **~60–120 zł/month difference per seller, permanently**, on a decision that costs us nothing but a conversation.

The vendor also states they *"in selected cases create integrators for specific systems"*, and runs a partner programme (a 10% discount is mentioned; revenue-share terms undisclosed).

### Vendor surface — corrections to the earlier deep-research pass

Read from the live integrations page 2026-07-28:

- **~60 integrations, not "20+"** as the vendor's homepage claims.
- **IdoSell and AtomStore ARE listed.** The deep-research pass *refuted* that claim during adversarial verification — a **false negative**. Do not rely on that refutation.
- **`Virtual Kasy` remains "wkrótce".** This matters: a shipped `kasa wirtualna` lane was one of the conditions that would have made device-free issuance possible. It has not fired.
- **LinkerCloud** (another integrator) is also "wkrótce" — the integrator shelf is actively being filled.
- API documentation and sandbox were **gated behind registration**; sandbox by email request to `pomoc@eparagony.pl`. No public OpenAPI/Swagger, no published plugin source found. **Superseded 2026-08-06 — both are now in hand; see the next subsection.**

### API access & sandbox — ✅ OBTAINED AND VERIFIED (2026-08-06, #1907)

Registration completed, credentials issued, and the sandbox verified by direct read-only calls. This closes the *technical-access* half of #1907; the commercial half (pricing class, who builds) is still open — see R3.

**Documentation.** The canonical contract is an OpenAPI 3.0 spec (`X-Api-Version: 3`, dated 20260311) plus 46 guide pages, mirrored read-only at `docs/vendor/eparagony/`. **That mirror is deliberately gitignored and must stay that way** — `docs.eparagony.pl/robots.txt` is `Disallow: /`, so the copy is for private use inside this repo, not redistribution. Recorded here so it is not "fixed" by a future contributor; the mirror's own README carries refresh instructions. Servers: `https://sandbox.eparagony.pl` and `https://api.eparagony.pl`; the OAuth endpoint sits on separate hosts (`login[.sandbox].eparagony.pl`). Surface is small — 1 auth call, 1 document-create, 3 document reads, 2 printer reads, 2 webhooks. The vendor warns the contract is **not frozen** (new fields may appear without notice), so the adapter must parse tolerantly.

**Credentials issued.** Per-server `client_id` / `client_secret`, a shared `posId`, a `webhookSecret`, and — notably — a dedicated `X-Integration-Id` of the form `openlinker:<secret>`. The vendor issues that header only to parties *"building an API integration for many customers rather than a single company"*, which is a supporting (not conclusive) signal that OL is being handled as an integrator rather than a self-serve Custom-API customer. It is **not** the written confirmation R3 needs.

**Sandbox verification** (read-only; nothing created or mutated; production deliberately untouched):

| Probe | Result |
|---|---|
| `POST login.sandbox.eparagony.pl/auth/token` (client_credentials) | `200` — bearer token, `expires_in: 3600` |
| `GET sandbox.eparagony.pl/printers/{num}/status` | `200` — `{"status":"INACTIVE","lastActiveAt":null,"crkStatus":{…}}` |
| same call without a token | `401 Access denied` — authorization genuinely enforced |
| `GET /documents/{random-uuid}/status` | `400 errorCode: 92` — token accepted, document absent |
| `GET /printers/{num}/reports/daily` without the `report_fiscal_get` scope | `403 Forbidden` — scope enforcement confirmed |

Same-day findings that constrain the adapter design (#1908):

- **Granted scopes: `document_create`, `printer_get`, `ecommerce`. Refused at token issuance (`400`): `document_get_jws`, `report_fiscal_get`.** The v1 push + status/link read-back path needs only the granted set, so this is not blocking — but if JWS retrieval or daily fiscal reports enter scope, they must be requested from the vendor first.
- **`printers/{anything}/status` returns the same `INACTIVE` stub for any device number.** No fiscal printer is attached to the sandbox, so the sandbox exercises the API contract but **not** the end-to-end fiscalisation path (device → eDPS → repository → webhook). Confirming that path needs either a vendor-side simulated device or a real printer, and is a prerequisite for calling #1908 verified rather than merely implemented.
- **Two documentation/reality drifts:** `X-Api-Version` (spec-mandatory) and `X-Integration-Id` are not actually enforced on the GET endpoints, and `errorCode: 92` is returned for a missing document although the spec documents only `100 – DOCUMENT_NOT_FOUND`. The adapter must not treat the documented error-code list as exhaustive.

### Evidence gap — explicitly not closed

**No user-pull evidence exists.** Zero inbound OpenLinker requests; no interviews with §4-category sellers; the re-keying cost remains unquantified. The build decision does not rest on user demand, and the spec should not pretend otherwise. If v1 is not adopted, this gap is the most likely explanation and the first thing to revisit.

---

## 4. Solution exploration

> **Phase C — draft, pending Gate C**

The framing constraint holds for every shape: OL never issues a receipt. Every option below is orchestration + surfacing.

| # | Shape | What the operator gets | Who builds | Seller's monthly add-on | Effort (us) |
|---|---|---|---|---|---|
| **A** | **Get listed as an Integrator; OL builds against their API** | Orders auto-push; receipt status + link on the OL order | OL | **19–69 zł** (integrator tier) | ~S–M |
| **B** | Self-serve Custom API integration | Same as A | OL | 79–189 zł | ~S–M |
| **C** | Ask eparagony.pl to build the OL connector | Same, plus OL appears in their catalogue | **Them** | integrator tier | ~0, but no control |
| **D** | Push-only MVP (no status read-back) | Orders reach the hub; no receipt visibility in OL | OL | either tier | ~S |
| **E** | Vendor-neutral `ReceiptHub` seam, eparagony as first adapter | Same as A, plus a second PL hub could implement later | OL | either tier | ~M–L |

**Trade-offs:**

- **A vs B** differ only in a commercial conversation, but that conversation is worth **60–120 zł/month to every one of our users** and puts OL on their integrations page — a distribution surface. A dominates B; B is the fallback if they decline.
- **C** is cheapest for us and lands the catalogue listing, but hands them control of quality, roadmap and breakage. Their own Base doc frames such connectors as *"integracja zewnętrzna"*, so support ownership would be ambiguous.
- **D** ships fastest but is *visibly* thinner than the BaseLinker connector our target sellers may already know. If the point is parity, D fails the point.
- **E** is the architecturally tidy option, but there is no second PL hub committed and no evidence anyone wants one. Building the abstraction now is speculative generality; the adapter boundary can be extracted later if a second hub appears.

**Recommendation: A, with C as an explicit ask in the same conversation.** Open the vendor conversation seeking integrator-class listing; offer that we build it (A) but ask whether they'd prefer to (C). Either answer is a good outcome; the failure mode is silently defaulting to B and charging our users 60–120 zł/month more than necessary. Scope to order-push **plus** status/link read-back — matching the Base connector, not a thinner cut.

**Deliberately not chosen: E.** Recorded so a future maintainer knows the vendor-neutral seam was considered and deferred, not overlooked.

> **Superseded 2026-07-29** — the maintainer asked whether the seam should be internationally general, not PL-neutral. A second deep-research pass (below) materially changes the answer to E. See §4a.

### 4a. International fiscalisation — second research pass (2026-07-29)

**Question asked:** is a generalised, cross-country fiscalisation port a sound abstraction to design now from a Polish-only first implementation?

**Answer: yes — and we should not invent the contract, because two vendors have already published it.**

**Finding 1 — the abstraction is proven, twice, commercially.**
[fiskaltrust/middleware](https://github.com/fiskaltrust/middleware) (EUPL-1.2, ~4,866 commits, active) self-describes as *"an integrated set of highly configurable software components for POS systems to abstract the complexity of national fiscalization laws"*, and its API docs state *"The Middleware provides the exact same interface across all markets."* [efsta EFR](https://docs.efsta.eu/efr/api/) states *"The API is a generic interface that can be used for all countries."* The "is a single port even coherent?" question therefore has an empirical answer rather than an architectural opinion.

**Finding 2 — the shape they converged on is our existing pattern.** A neutral transaction contract above; a per-country trust-anchor adapter below. fiskaltrust splits into Queue (neutral lifecycle + *"the logic that transforms international requests into country-specific ones"*) and **SCU** — *"abstractions of local signing devices or services, and therefore country-specific"* — with `scu-at`, `scu-be`, `scu-de`, `scu-es`, `scu-gr`, `scu-it`, `scu-me`, `scu-pt` in-repo. Device-anchored (IT), module-anchored (DE/AT) and certified-software (PT/ES) regimes all sit behind **one seam**.

**Finding 3 — the invariant core is narrow and real.** fiskaltrust API v0 exposes three operations: `Echo`, `Sign` (*"sign different types of receipts according to local fiscalization regulations… returns the data that need to be printed onto the receipt"*), `Journal`. efsta: only `/register` and `/cfg` are mandatory. Two independent vendors, same minimal core: **register a transaction, get back what must be printed.**

**Finding 4 — the leak that matters, and it bites in Poland.** efsta requires additional `/peri/*` endpoints (`peri/print`, `peri/print/state`) *"to directly print"* in **fiscal-printer countries** — i.e. the mandatory registration core is necessary everywhere but **sufficient only in non-device regimes**. A registration-only port **would not cover Poland or Italy.** A device/peripheral sub-capability is required from day one, not later.

Second leak: export/audit is irreducibly country-shaped (DSFinV-K for DE, DEP7 for AT, NF525 for FR, SAF-T for PT). Third: both vendors encode country *in the data* — fiskaltrust's `ftReceiptCase` is an Int64 carrying the ISO-3166 country code in its bytes, with per-country valid-value tables; efsta's "generic" interface carries `FR_NAF`/`FR_SRN`/`DE_Agentur`/`DE_STNR`. Closer to a **tagged union** than a neutral contract.

**Finding 5 — the taxonomy is the right axis but must not be hard-coded.** Trust-anchor class is **not stable per country**. Italy is mid-migration from RT device to certified software (legal basis 2025, operation from 1 Jan 2026, portal 5 Mar 2026) — anchored on an *accredited provider*, not arbitrary software. Czechia has **no obligation today** (EET abolished 1 Jan 2023), returning 1 Jan 2027 as pure remote reporting. A port that encodes "Poland = device" as a type will age badly; the anchor belongs in the adapter, not the contract.

**Finding 6 — efsta already covers Poland; fiskaltrust does not.** efsta documents 17 jurisdictions (`AT BE CZ DE DK ES FR HR HU IT LT NO PL PT SE SI SK`). fiskaltrust covers roughly AT/DE/FR/IT/ES/PT/GR. **Strategic consequence:** integrating efsta is a candidate route to PL **plus** 16 other markets through one adapter — a different roadmap shape from the eparagony.pl connector, and one that serves the "not only PL" goal directly. Commercial terms unknown.

**Finding 7 — the potentially-disqualifying question is NOT settled.** Does OpenLinker itself need per-country certification? Evidence is **circumstantial only**: fiskaltrust and efsta hold the certifications and expose plain APIs to arbitrary integrators (Microsoft Dynamics 365 Commerce and Erply integrate without being homologated per country), which strongly suggests an orchestrator behind a certified provider does not need its own homologation. **But this was not verified against any regulator's text**, and Portugal (certified-software regime) deserves a direct legal check. The research flags this as *"the weakest and most consequential item in the report"*. **Treat as an open risk, not a cleared one.**

**Scope caveat — what this pass did NOT answer.** Adversarial verification concentrated on the middleware question. **The regime inventory is essentially unanswered**: only Italy and Czechia were verified. Germany, Austria, Portugal, Spain (Verifactu/TicketBAI — the most time-sensitive), Hungary, Croatia, Slovenia, Greece, Romania and the Nordics remain **unverified**. Two Italy claims were *refuted* as stated, and even "Poland's trust anchor is a GUM-approved device" only reached 1-2. **No date-bearing regime claim from this pass should be published without independent checking.**

## 5. Product specification

> **Phase D complete.** Chosen shape: **A + E** — build the eparagony.pl connector, on integrator commercial terms, as **adapter #1 behind a general fiscalisation capability** whose decomposition is taken from the fiskaltrust/efsta published contract rather than inferred from Poland.

Persona shorthand below: **"the seller"** = register-obliged PL online seller (§4-excluded category), per §2.

### User stories & acceptance criteria

**US-1 — Receipt without re-keying.**
*As the seller, I want an order in OpenLinker to produce a fiscal e-receipt automatically, so that I stop re-entering order lines into my printer software.*
- Given a connected fiscalisation provider and an order that requires a receipt, the receipt is issued without the operator opening another system.
- The operator can tell, from the order, that a receipt was requested — including while it is still in flight.
- If the order does not require a receipt, nothing is issued and nothing is shown.

**US-2 — See the receipt against the order.**
*As the seller, I want the receipt's status and a link to it on the OL order, so that I can answer a customer question without leaving OpenLinker.*
- The order shows a clear issued / pending / failed state.
- Where the provider returns a receipt link or identifier, the operator can open or copy it from the order.
- This is explicit parity with what eparagony.pl's BaseLinker connector already gives its users; a push-only result does not satisfy this story.

**US-3 — Failures are visible and safe to retry.**
*As the seller, I want a failed receipt to be obvious and safely retryable, so that I never register the same sale twice.*
- A failure is surfaced on the order with an actionable reason, not silently swallowed.
- Retrying never produces a second fiscal registration of the same sale. **A double-fiscalisation is a legal event for the seller, not a data-quality issue** — this AC is the highest-severity one in this spec.
- An unresolved failure never blocks the rest of order processing.

**US-4 — Connect once, in configuration.**
*As the seller (non-technical, printer configured by a `serwisant`), I want to connect our fiscalisation account to OpenLinker as a setup step, so that enabling this is configuration and not a project.*
- The account is connected from the connection UI, in line with every other OL integration.
- The operator is told plainly what they must have in place first (fiscal printer online, vendor printer-control software running, `serwisant` configuration done).
- A misconfigured or unreachable setup is diagnosable from OL — the operator can tell *which* precondition is missing.

**US-5 — A second provider is an adapter, not a fork.**
*As a maintainer or OSS adopter, I want a second fiscalisation provider to be addable as an adapter, so that OpenLinker is not welded to one Polish vendor or to Poland.*
- Adding a provider does not require changing order handling or any core domain code.
- No vendor name and no country assumption (notably "there is a fiscal printer") appears in the shared contract.
- The contract accommodates the four observed trust-anchor classes without naming them: certified device, security module, certified software + hash chain, remote authority endpoint.

### Effort

**~M.** Roughly comparable to a shipping-carrier adapter, plus the capability seam. Excludes the two blocking prerequisites (§8 R1, R3), which are days of investigation and conversation rather than engineering. Day-level breakdown belongs in Tier 2.

---

## 6. Out of scope

1. **Issuing fiscal receipts ourselves.** Legally reserved to a certified mechanism. OL orchestrates and surfaces; it never issues.
2. **Fiscal-device provisioning, configuration or servicing.** The `serwisant` owns this, and so does the vendor's printer-control software. OL does not install, configure or diagnose hardware.
3. **A second adapter (efsta or otherwise) in v1.** The capability exists so this is cheap later; building two adapters at once would prove the abstraction against a provider we have no commercial relationship with. **efsta covering PL + 16 jurisdictions is the obvious adapter #2** and is recorded as such.
4. **Journal / audit export.** Country-format-specific (DSFinV-K, DEP7, SAF-T). Deliberately a separate sub-capability nobody is asking for yet.
5. **Corrections, voids and returns as fiscal operations.** Real and eventually necessary, but each regime constrains them differently and no evidence says our users need them at v1. **Known gap, not an oversight.**
6. **Non-PL regimes.** The port is shaped so they fit; none is implemented.
7. **Deciding per-order whether a receipt is legally required.** OL surfaces and orchestrates; the seller (and their accountant) own the fiscal determination. OL must not imply it knows a seller's obligation — see R5.

---

## 7. Definition of done

Qualitative, per Stage 1 calibration — no adoption percentages we cannot measure.

- At least one real §4-category seller runs it in production for ≥30 days without falling back to their previous receipt path.
- No incident in which OpenLinker caused a **double fiscal registration**. This is the one that would matter to a seller's tax position, so it is a hard bar rather than a target.
- Adding a second provider looks credibly like writing an adapter — assessed by a maintainer reading the code, not asserted here.
- The operator can answer "was a receipt issued for this order?" from the OL order alone, without opening the vendor panel.
- No support question of the form "why did OL tell me a receipt was issued when it wasn't".

---

## 8. Risks

Top product-direction risks only. Engineering risks belong in Tier 2 plans.

**R1 — Per-country certification liability. ✅ CLOSED FOR POLAND (2026-07-29, #1906). Portugal unresolved (advisory).**

**Poland — answered from primary text. OpenLinker carries no homologation obligation.**

Source: consolidated *ustawa o podatku od towarów i usług*, **Dz.U. 2025 poz. 775** (tekst jednolity, Obwieszczenie Marszałka Sejmu z 21.05.2025), retrieved via the Sejm ELI API and read directly.

**art. 111 ust. 6b** places the obligation on a closed, named set of parties:

> *"**Producenci krajowi i podmioty dokonujące wewnątrzwspólnotowego nabycia lub importu kas rejestrujących w celu wprowadzenia ich na terytorium kraju do obrotu** są obowiązani do uzyskania dla danego typu kas rejestrujących potwierdzenia Prezesa Głównego Urzędu Miar, że kasy te spełniają funkcje wymienione w ust. 6a i wymagania techniczne dla kas rejestrujących."*

i.e. **manufacturers of cash registers, and those importing / intra-Community-acquiring them to place on the Polish market.** OpenLinker is none of these. It neither produces nor places a `kasa rejestrująca` on the market; it sends transaction data to a hub that drives a device someone else manufactured and homologated.

**art. 111 ust. 6a** confirms the obligation is a property *of the device*: the `kasa` must ensure correct recording, storage and secure transmission to the Centralne Repozytorium Kas, and its **pamięć fiskalna** must carry a unique number assigned by the minister. These are device capabilities, not properties of upstream software.

**The precise boundary — art. 111b.** Software *can* be a cash register: ust. 1 permits `kasy rejestrujące mające postać oprogramowania` for defined groups of taxpayers/activities, and ust. 2 states *"Do kas rejestrujących, o których mowa w ust. 1, przepisy art. 111 i art. 111a **stosuje się odpowiednio**"* — so a software cash register **does** attract art. 111 ust. 6b.

> **The line is therefore: FEEDING a `kasa` carries no obligation; BEING a `kasa` does.** OpenLinker must stay on the feeding side. If OL ever shipped something that itself performs fiscal registration — rather than handing off to a certified device or a certified `kasa wirtualna` — art. 111 ust. 6b would attach and this risk reopens.

*Near-miss guarded against:* **ust. 6fa** requires a GUM decision when the `program pracy kasy rejestrującej` changes. That is the device's own operating program, not integrating software. Do not misread it as covering upstream systems.

*Scope note:* this establishes what the statute says. It is not legal advice, and no seller-facing compliance claim should be made on it without a professional opinion (per #1906's stated out-of-scope).

**Portugal — ❌ could not establish. Advisory only; does not block v1.**
Attempted: WebSearch (session budget exhausted by the two prior research passes); `diariodarepublica.pt` search endpoints (HTTP 301); the Portaria 363/2010 detail page (HTTP 200 but a JavaScript shell — 24 characters of extractable text); `info.portaldasfinancas.gov.pt` (404) and `portaldasfinancas.gov.pt` (302). **Unresolved:** whether Portugal's certified-software regime attaches to software that *issues* invoices only, or reaches upstream systems that merely transmit to certified software. Closing it needs either a JS-rendered fetch of the DRE page or restored search budget. **Consequence if adverse:** would constrain generalising the port into PT, not the PL v1.

**R2 — No user-pull evidence at all.**
Zero inbound requests; no interviews with §4-category sellers; the re-keying cost was never quantified. The build rests on a maintainer strategic call, not demand. If v1 goes unused, this is the reason, and it was known in advance.

**R3 — Integrator classification may be declined. ⏳ STILL OPEN (2026-08-06, #1907).**
If eparagony.pl treats OL as a Custom-API customer instead, our users pay 79–189 zł/mo rather than 19–69 — permanently, per seller. This is decided in a conversation, not by code, and the default path lands in the expensive class.

API access and a working sandbox are now in hand, and OL was issued a multi-customer `X-Integration-Id` — a supporting signal, **not** a classification. Custom-API customers also get sandboxes, so technical access does not retire this risk. Outstanding: (a) written confirmation of the pricing class, (b) a recorded decision on who builds the connector — us (option A) or them (option C), (c) partner-programme terms. Until (a) and (b) land, #1907 stays open. Per the §9 sequencing, #1908's *design* still runs in parallel — but (b) could make that work redundant if the vendor elects to build the connector themselves, so the conversation should be pressed before #1908 moves from design into build.

**R4 — Counterparty standing. ✅ CHECKED (2026-07-29, #1906). No red flags; one limitation.**

Retrieved from the Ministry of Justice KRS API (`OdpisAktualny`, stan z dnia 14.07.2026) and the Ministry of Finance VAT whitelist (`wl-api.mf.gov.pl`). NIP sourced from the vendor's own site, then used as the authoritative key.

| | |
|---|---|
| Legal name | PLATFORMA DETALISTÓW SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ |
| KRS | 0000697156 |
| NIP / REGON | 5213796333 / 368414541 |
| Registered | 2017-10-31 (≈8.7 years trading) |
| Seat | ul. Twarda 18, 00-105 Warszawa |
| Share capital | **47 100,00 PLN** |
| VAT status | **Czynny** (active) |
| Board | 4 members; representation by **two members acting jointly** |
| **Dział 6** (liquidation / bankruptcy / restructuring) | **EMPTY — no entries** |

**Read:** an eight-year-old, VAT-active company with a clean register — no liquidation, bankruptcy or restructuring proceedings. Nothing here argues against a dependency.

**Limitation — financial health was NOT assessed.** Share capital of 47 100 PLN is small but unremarkable for a Polish sp. z o.o. and says nothing about solvency. Filed financial statements live in the *Repozytorium Dokumentów Finansowych*, a separate system not queried here. If this dependency ever becomes load-bearing (e.g. a revenue-sharing partnership rather than a connector), pull the RDF filings before relying on it.

**R5 — Over-claiming compliance.**
The persona is legally defined and most PL e-commerce is *exempt* (courier COD preserves the exemption — see §2). If OL's UI implies a seller needs receipts, or that using this makes them compliant, we mislead them about their own tax position. Copy must describe what OL did, never what the law requires of them.

*Deliberately excluded as Tier 2 concerns:* retry/idempotency mechanics, offline-mode tolerances, provider API drift, printer connectivity failure modes.

## 9. Implementation breakdown (Phase E)

| # | Issue | Effort | Notes |
|---|---|---|---|
| [#1906](https://github.com/openlinker-project/openlinker/issues/1906) | Close certification-liability + counterparty questions | S | **BLOCKING** — spike. R1 is potentially invalidating; must close before code ships |
| [#1907](https://github.com/openlinker-project/openlinker/issues/1907) | Secure integrator-class listing + API/sandbox access | S | **BLOCKING** — non-engineering. Worth 60–120 zł/mo per seller. *Partial 2026-08-06: docs + sandbox obtained and verified; pricing class and build-owner still open.* |
| [#2009](https://github.com/openlinker-project/openlinker/issues/2009) | ADR + implementation plan for the fiscalisation capability | S–M | **Pre-code input to #1908**, not a by-product. A new capability port mandates an ADR per `docs/architecture/adrs/README.md`; the plan is the `/plan` #1908 already asks for |
| [#1908](https://github.com/openlinker-project/openlinker/issues/1908) | Fiscalisation capability + eparagony adapter (register) | M | Core. `/plan` first — new capability port |
| [#1909](https://github.com/openlinker-project/openlinker/issues/1909) | Receipt status + link on the order | S | The parity bar; push-only fails US-2 |
| [#1910](https://github.com/openlinker-project/openlinker/issues/1910) | Device/peripheral sub-capability | M | Required for PL. `/plan` first |
| [#1911](https://github.com/openlinker-project/openlinker/issues/1911) | Connection setup + preconditions UI | S | |
| [#2010](https://github.com/openlinker-project/openlinker/issues/2010) | Integration documentation set (package docs, capabilities, user + manual-testing guides) | S–M | Follows #1908. Split out so it isn't retrofitted, as it was for infakt and Subiekt. The manual-testing chapter is additionally gated on a sandbox fiscal device |

Sequencing: #1906 and #1907 run in parallel with #1908's design. **#1908 must not ship before #1906 closes.** #2009 precedes #1908's build. #1909/#1910/#1911 follow #1908, and #2010 follows them.

## 9a. Research provenance

Two deep-research passes back this spec. Both had material errors worth knowing about before trusting any single finding:

- **Pass 1 (2026-07-28)** — PL legal + vendor baseline. Produced a **false negative**: adversarially "refuted" that eparagony.pl integrates IdoSell/AtomStore; the live integrations page lists both. Also under-counted their integrations (~60, not "20+").
- **Phase A correction (2026-07-28)** — targeted legal research overturned this spec's own Phase A draft *and* the Gate A briefing on COD. See decision log.
- **Pass 2 (2026-07-29)** — international fiscalisation. Answered the abstraction question well; **left the regime inventory essentially unanswered** (only IT and CZ verified) and left R1 on circumstantial evidence only.

**Standing lesson:** primary sources settled every question that mattered here — the Dz.U. PDF, the KIS interpretacja, the live vendor pages, the fiskaltrust repo. Verify against those before acting on a synthesised finding.

## 10. Decision log

| Date | Decision | Rationale |
|---|---|---|
| 2026-07-28 | Spec opened from #1902 | Prior deep-research pass (2026-07-28, 25 claims adversarially verified) supplied the legal and vendor baseline; recorded in #1902 as inputs, not conclusions. |
| 2026-07-29 | **R1 closed for Poland** (#1906) | art. 111 ust. 6b of the VAT act (Dz.U. 2025 poz. 775) puts the GUM homologation duty on *manufacturers and importers of cash registers*. art. 111b ust. 2 applies art. 111 *odpowiednio* to software-form registers — so the line is **feeding a `kasa` (no duty) vs being one (duty)**. OL stays on the feeding side. |
| 2026-07-29 | **R4 checked** (#1906) | KRS 0000697156, registered 2017, VAT-czynny, Dział 6 empty (no liquidation/bankruptcy). Financial statements not pulled — noted as a limitation. |
| 2026-08-06 | **API docs + sandbox obtained and verified** (#1907) | Registration completed; OAuth, an authenticated read, scope enforcement and the unauthenticated-401 control all confirmed against `sandbox.eparagony.pl` (read-only, production untouched). Spec mirrored to `docs/vendor/eparagony/`. Closes the technical-access AC of #1907 only. |
| 2026-08-06 | **R3 stays open despite sandbox access** (#1907) | A sandbox is issued to Custom-API customers too, so it proves nothing about pricing class. The multi-customer `X-Integration-Id` is a supporting signal, not a classification. #1907 remains BLOCKING until the class is confirmed in writing and the build-owner decision is recorded. |
| 2026-08-06 | **Sandbox cannot verify the fiscalisation path** (#1907) | `printers/{any}/status` returns a constant `INACTIVE` stub — no device is attached. The sandbox validates the API contract but not device → eDPS → repository → webhook. #1908 needs a simulated or real printer before it can be called verified. |
| 2026-07-29 | Portugal left open | Access-blocked, not ambiguous. Advisory and non-blocking for v1; recorded with what was tried. |
| 2026-07-28 | **Gate A: build** | Maintainer decision on strategic grounds. Recorded plainly: the assembled evidence runs the other way (no mandate, no user-pull, persona narrowed to §4 categories). Phase B re-scoped from "should we?" to "what exactly, on what terms?". |
| 2026-07-28 | Target the **Integrator** pricing class, not Custom API | OL is categorically an integrator (same shelf as BaseLinker/Apilo/SellAsist). Integrator add-on is 19–69 zł/mo vs 79–189 zł for Custom API — a permanent 60–120 zł/mo saving *for our users*, contingent only on a vendor conversation. |
| 2026-07-28 | Scope includes **status/link read-back**, not push-only | Their BaseLinker connector surfaces receipt status and a per-receipt link in the Base panel. A push-only MVP would be visibly thinner than what the target seller may already have. |
| 2026-07-28 | Vendor-neutral `ReceiptHub` seam **deferred, not overlooked** | No second PL hub committed, no demand signal for one. Extract the boundary if/when a second appears. |
| 2026-07-28 | **COD is not a route into the persona — retracted** | Courier-remitted `pobranie` preserves the mail-order exemption (interpretacja 0113-KDIPT1-3.4012.42.2025.2.ALN, KIS, 24.03.2025). The Phase A draft, and the Gate A briefing, wrongly assumed the opposite and called COD the likely-larger population. Addressable base is therefore §4 categories only — materially smaller. |
| 2026-07-28 | Annex position is **poz. 41**, not poz. 36 | Read from the official Dz.U. 2024 poz. 1902 PDF. Secondary sources cite 36 / 15 / 41 inconsistently; the primary text settles it. |
| 2026-07-28 | Receipts modelled as **distinct from** invoicing | Different issuer (fiscal device vs. software), device dependency, and legal basis. Extending `InvoicingPort`/`DocumentType` would be a category error. Carried into every later phase as a fixed constraint. |
