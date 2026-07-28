# Product Spec — #1902 Polish e-receipt (e-paragon) support via eparagony.pl

**Status:** phase A in progress
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

> Phase B — not started.

## 4. Solution exploration

> Phase C — not started.

## 5. Product specification

> Phase D — not started.

## 6. Out of scope

> Phase D — not started.

## 7. Definition of done

> Phase D — not started.

## 8. Risks

> Phase D — not started.

## 9. Decision log

| Date | Decision | Rationale |
|---|---|---|
| 2026-07-28 | Spec opened from #1902 | Prior deep-research pass (2026-07-28, 25 claims adversarially verified) supplied the legal and vendor baseline; recorded in #1902 as inputs, not conclusions. |
| 2026-07-28 | **COD is not a route into the persona — retracted** | Courier-remitted `pobranie` preserves the mail-order exemption (interpretacja 0113-KDIPT1-3.4012.42.2025.2.ALN, KIS, 24.03.2025). The Phase A draft, and the Gate A briefing, wrongly assumed the opposite and called COD the likely-larger population. Addressable base is therefore §4 categories only — materially smaller. |
| 2026-07-28 | Annex position is **poz. 41**, not poz. 36 | Read from the official Dz.U. 2024 poz. 1902 PDF. Secondary sources cite 36 / 15 / 41 inconsistently; the primary text settles it. |
| 2026-07-28 | Receipts modelled as **distinct from** invoicing | Different issuer (fiscal device vs. software), device dependency, and legal basis. Extending `InvoicingPort`/`DocumentType` would be a category error. Carried into every later phase as a fixed constraint. |
