# Rules check: synthesis of 7 reports

Sources: 1 BaseLinker, 2 Apilo, 3 Sellasist, 4 Shopify + apps, 5 Linnworks/Cin7/Brightpearl, 6 Allegro sellers, 7 Erli/PL shops/accounting.
Vote order in the "votes" column: BL / Ap / Se / Sh / Gl / Al / PL (A = adopt, S = simplify, D = drop).

| Rule | Votes | Decision |
|---|---|---|
| P1 skip gift if bundle has it | S S S S S A D | SIMPLIFY: generic opt-in "skip if the product is already in the order (also as a component)". Allegro sells gifts as set components, so it matters there. |
| P2 per-customer limit by buyer id | A D A A A A S | ADOPT the key (OL resolved customer). The limit itself is optional, can come after the pilot. |
| P3 priority + does not combine | S S S A S S A | SIMPLIFY: list order + one "do not combine with others" switch. BOGOS and PrestaShop have exactly this. |
| P4 money budget | S D D S D S S | DROP the money budget. Use a gift unit cap and "stop when out of stock", visible as paused. |
| P5 which date + per-unit gift | S S S S A S S | Order-placed date only, no choice, no backwards application. "1 gift per N" as an option with a cap. |
| O1 gift line id | all A | ADOPT. |
| O2 manual gift by stage | S S S S S A S | SIMPLIFY: allowed until the parcel is closed, refused after; one warning if a document exists. |
| O3 multipack hold | S A S A A A A | ADOPT as a generic awaiting_mapping hold plus a one-click "create bundle N x" on the hold. |
| O4 ended promotion read-only | D A A S S A A | SIMPLIFY: editable (orders keep their snapshot) plus "Copy". |
| D1 0,01 from a paid line | A A S S A A S | SIMPLIFY: per document provider. Omit where possible; grosz from a same-rate paid line only where the provider refuses 0. Sellasist alternative: full price + discount line per VAT rate. |
| D2 split line for qty x price | A A A S S A A | ADOPT, automatic, only when needed, no UI. |
| D3 remainder to largest line | all A | ADOPT (Shopify: allocated once, never redistributed). |
| D4 hold until "spread discount" | all S/D | DROP the hold. Spread proportionally automatically, show it, manual override. |
| D5 EUR foreign VAT hold | S S A A S A A | ADOPT for now via the generic "no document route" block. Target: automatic OSS invoice (Shoper does it). |
| D6a duplicate-line tie-break | D S S A S S - | SIMPLIFY: operator picks, OL suggests. |
| D6b never auto-deduct a kept gift | all A | ADOPT. |
| D6c claw-back proposal | S D D S D A S | SIMPLIFY: show the Allegro/Swap amount ("paid minus full price of kept items, min 0") as an editable hint, never automatic. |
| C1 take composition from PrestaShop | A S S S S - A | SIMPLIFY: one-way import/sync from PrestaShop on demand, no diff screen. |
| C2 small-gift register | S D D A S S S | SIMPLIFY: yearly export by customer for the accountant, no enforcement. |
| C3 hold every gift document | all D | DROP. |
