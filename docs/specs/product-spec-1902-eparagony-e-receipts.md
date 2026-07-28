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

Membership is **legally determined**, which is unusually crisp for a persona definition. A seller is in scope iff they cannot use the mail-order exemption (annex poz. 36 of Dz.U. 2024 poz. 1902), which happens when either:

1. **They trade in a §4-excluded category** — consumer electronics (computers/laptops/tablets, RTV/telecom), photographic equipment, precious-metal goods, perfumes and eau de toilette, tobacco, alcohol, motor-vehicle parts and accessories, recorded/unrecorded media, motor fuels, LPG; **or**
2. **They take cash or COD** — any cash element breaks the exemption's "payment in full via bank/post" condition. Given COD's persistence in PL e-commerce, this may be the larger of the two routes.

Everyone else — the majority of pure PL e-commerce — is exempt and **has no receipt to issue at all**. They are not a degraded-experience user of this feature; they are a non-user.

### Secondary consideration — not a persona

eparagony.pl itself is a **channel**, not a user. If a distribution argument carries this build, that should be recorded as a strategic rationale in Phase C, not smuggled in as user need. Kept separate deliberately.

### Persona ambiguities to resolve at Gate A

1. **Is the §4 route or the COD route the primary one?** They imply different sellers and different marketing. Untested.
2. **Does this persona overlap OL's actual current users at all?** OL's existing integrations skew Allegro + PrestaShop/WooCommerce + InPost/DPD. Whether any known deployment sits in a §4 category is unknown — and if the answer is "none", that is a strong DEFER signal.
3. **Would this persona even be an OL user?** A seller with a fiscal printer, a `serwisant` relationship, and (likely) Subiekt/Comarch already has an ERP that eparagony.pl integrates directly. OL may be redundant in their stack for this purpose.

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
| 2026-07-28 | Receipts modelled as **distinct from** invoicing | Different issuer (fiscal device vs. software), device dependency, and legal basis. Extending `InvoicingPort`/`DocumentType` would be a category error. Carried into every later phase as a fixed constraint. |
