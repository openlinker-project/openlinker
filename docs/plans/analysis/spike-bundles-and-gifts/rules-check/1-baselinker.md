# Rules check 1: BaseLinker (base.com) against the 21 prototype rules

Date: 2026-11-04. Read-only desk research. No account, no sign-up, so every statement about the live panel comes from vendor help, the API reference or the official changelog.

## Method and limits

- **Reused** (not re-fetched unless noted): r1/phase2/1-baselinker-bundles.md, r1/phase2/2-baselinker-gifts-docs.md, r2/phase2/1-2, r3/phase2/1-baselinker.md, r4/phase2/1-baselinker.md, r5/4-competitors-pl.md.
- **Fetched fresh today** to fill gaps: help "Order of executing automatic actions", FAQ "Automatyczne akcje", help "Automatyczne akcje", help "Oznaczenie powracającego klienta", blog "Promocje w Base", FAQ "Pobieranie zamówień ze sklepu", changelog "Spis aktualizacji - lipiec 2026", help "Faktury", help "Paragony".
- **Gap:** the web tool hit its spend limit partway through. Three planned checks did not run: Allegro multipack linking (O3), PrestaShop pack import (C1) and fresh merchant-voice searches. For those I rely on earlier rounds and say so.
- Quotes are the fetch tool's verbatim excerpts, which can be truncated. Anything without a source is marked **no evidence**.
- **Merchant voice is thin.** Earlier rounds searched Społeczność Allegro and forums for "BaseLinker gratis" and found nothing gift-specific. The complaints below come from vendor FAQ answers, blog comment threads and one third-party blog.

## Background: BaseLinker's model in five lines

1. **No gift concept.** A gift is an ordinary order line, added by the automatic action "Dodaj produkt do zamówienia (np. gratis)" or by hand.
2. **No promotion engine for gifts.** "Promocje w Base" (09/2025) changes catalogue prices only.
3. **Gift rules are automatic actions**: event, then conditions, then action. Every action whose conditions match runs.
4. **A bundle ("zestaw")** is a catalogue product with its own price. One global switch decides whether it is split into component lines on the order.
5. **Documents** carry only a gross unit price, a VAT rate and a quantity per line. There is no discount or gift field.

## Per rule

### P1. Skip the gift if a bundle in the order already contains it
- **What BaseLinker does: no equivalent.** Conditions can test whether a product is present: "only if it comes from eBay, one of the products is an iPhone" (https://base.com/en-EN/help/knowledgebase/automatic-actions/, via r4 S14). No documented condition looks at bundle components, and no documented rule de-duplicates a gift. With bundle splitting on, the components become ordinary lines, so a product-present condition could in theory see them. That inference is unverified.
- **Complaints:** no evidence.
- **Recommendation: SIMPLIFY.** Replace the bundle-specific rule with one generic check: do not add the gift when the gift product is already on the order, on any line, bundle components included (OL expands bundles at ingestion, so they are visible). One rule covers bundles, a manual add and a channel-sent gift alike.

### P2. Per-customer limit counted by the channel buyer id, not by e-mail
- **What BaseLinker does: equivalent, and the same choice.** FAQ: the system "sprawdza w pierwszej kolejności numer telefonu". For the "Klient ma inne zamówienia" condition it "sprawdza zamówienia po adresie e-mail, natomiast dla Allegro/Amazon po loginie z tego serwisu" (https://base.com/pl-PL/pomoc/faq/automatyczne-akcje/). The look-back window tops out at 60 days ("Dni: ostatnie 2, 3, 7, 14, 30, 60 dni"; https://base.com/pl-PL/pomoc/wiedza/oznaczenie-powracajacego-klienta/).
- **Complaints:** archived orders are invisible. Asked whether the condition covers them, the vendor answers "Aktualnie niestety nie." (FAQ above). Nothing counts gifts given; the condition only asks "has other orders".
- **Recommendation: ADOPT.** Key the count on OL's resolved customer, which for Allegro already comes from the buyer login and id, not the alias e-mail. Count over all history, not a rolling window, so you avoid BaseLinker's archive blind spot.

### P3. Several matching promotions: a priority number decides, and "does not combine" loses to a higher priority
- **What BaseLinker does: no priority and no exclusivity.**
  - Order: "Automatic actions will be executed in the order they are set in the automation list view". With groups, order is "taken into account based on ID".
  - All matching actions run: "all automatic actions will be executed, even if one of them makes changes". Conditions for one event are checked together, before any action runs.
  - The page describes no way to stop the remaining actions (https://base.com/en-EN/help/knowledgebase/order-of-executing-automatic-actions/). The only stop is on failure: "Opcja Przerwij po błędzie dostępna dla niektórych akcji pozwala przerwać wykonywanie pozostałych akcji" (https://base.com/pl-PL/pomoc/wiedza/automatyczne-akcje/).
  - Price promotions say nothing about overlapping ("Promocje w Base", https://base.com/pl-PL/blog/promocje-w-base/).
- **Complaints:** r1 noted "no once-per-order guarantee; all matching actions on an event fire". There is no merchant quote.
- **Recommendation: SIMPLIFY.** Drop the priority number. Every matching gift promotion applies (BaseLinker's default, and what merchants already expect). Exclusivity, if it is ever needed, becomes one checkbox, "nie łącz z innymi", resolved by list position.

### P4. Budget: auto-pause when the gift budget is spent; a gift with no cost cannot have a budget
- **What BaseLinker does: no equivalent.**
  - There is no budget, spend cap, or quantity cap on a gift action or a promotion. "Promocje w Base" covers dates only: "aktywna do odwołania" or a date range, started and ended automatically.
  - Gift stock: the action only names "magazyn, z którego ma być obniżany stan". No out-of-stock stop is documented (r1, r4 G-08).
  - The nearest tools are DIY: the events "Rezerwacja ponad stan magazynowy" and "Nie zrealizowano zamówienia (brak stanów magazynowych)" (r5).
- **Complaints:** r1 noted that "Silent overselling of gift possible unless operator builds this". There is no merchant quote.
- **Recommendation: SIMPLIFY.** Replace the money budget with "stop when the gift's stock runs out", plus an optional cap on the number of gifts given. Drop the purchase-cost precondition: it blocks activation on data most catalogues do not hold.

### P5. Choice of which date counts, and a gift per qualifying unit
- **What BaseLinker does: no date choice, and a fixed gift quantity.**
  - No date condition is named in the help ("Automatyczne akcje" lists none). "Akcje nie działają wstecz."
  - Timing is chosen through the event. For Allegro the vendor recommends "pobrano formularz opcji dostawy" over "pobrano zamówienie", because "Zamówienia od razu po pobraniu z Allegro/eBay nie zawierają jeszcze kompletu produktów i danych" (FAQ automatyczne-akcje).
  - The campaign window is the price-promotion date range, or switching an action group on or off by hand: "Możesz również szybko włączyć lub wyłączyć całą grupę."
  - Per unit: the action takes a fixed "ilość". The condition "Ilość sztuk konkretnego produktu (SKU)" is a threshold. No per-N-units multiplier is documented.
- **Complaints:** no evidence.
- **Recommendation: SIMPLIFY.** Use one date with no switch: the channel's order-placed date, falling back to received-by-OL when the channel sends none. Keep a fixed gift quantity per order with a threshold condition; defer "1 per N units" until a seller asks for it.

### O1. Internal, deterministic gift line id `ol-gift:{ruleId}:{lineId}`
- **What BaseLinker does: nothing like it.** The gift is identified only by "nazwę, która będzie widoczna w zamówieniu" (https://base.com/pl-PL/pomoc/wiedza/pozostale-wybrane-akcje-przyklady-automatycznych-akcji/). getOrders products carry no gift field (r3/r4). The packing skip list matches lines by name ("możliwość ustalenia nazw produktów..."; https://base.com/pl-PL/pomoc/wiedza/asystent-pakowania/).
- **Complaints:** r1/r3 flag name matching as fragile and note there is no once-per-order guarantee, so an action re-fired on a repeated event could add the gift twice (unverified).
- **Recommendation: ADOPT.** The id is invisible to the operator. It is exactly what BaseLinker lacks: it makes re-ingestion idempotent and keeps gifts out of name-based matching.

### O2. Manual gift add, gated by stage (before routing OK, after routing warn, after packing refused, after invoice warn)
- **What BaseLinker does: no stage gates documented.** The order card offers "+Dodaj produkty do zamówienia" at any time (r1 S24, r4 S15). The only packer aid is the pop-up action "Wyświetl komunikat" ("przypominających pracownikom o ważnych kwestiach, takich jak np. dodanie gratisu do zamówienia"; r1 S3).
- **Complaints:** edits are not pushed back to the shop ("zmiany ... osobno w sklepie", r1). No stage-related complaint was found.
- **Recommendation: SIMPLIFY.** Do not build a new four-state ladder. Reuse the existing operator-edit refusals from #3542/#3543 (`ORDER_PACKED`, `SALES_DOCUMENT_ISSUED` and friends), so adding a gift behaves like any other line edit.

### O3. Allegro multipack is held until a bundle "3 x coffee" is defined, then "check again"
- **What BaseLinker does: partly.** A multipack is modelled as a bundle with one component and N pieces, and the offer is linked to that bundle ("the value is the number of pieces of this product in the bundle", https://api.baselinker.com/index.php?method=addInventoryProduct). Product cards can also carry case EANs with a quantity ("to work with products cases (4-pack etc.)", getInventoryProductsData, r4 S2).
- **No evidence** of any hold, of a re-check, or of how Allegro productSet quantity is read; earlier rounds also rated this Unknown. A fresh check today was blocked by the tool limit.
- **Complaints:** a single bundle is needed per pack size (r2).
- **Recommendation: SIMPLIFY.** Use BaseLinker's model (the multipack is a one-component bundle linked to the offer). Reuse OL's existing `awaiting_mapping` state, which re-resolves when the mapping changes, instead of a dedicated hold plus a "check again" button.

### O4. An ended promotion is read-only; duplicate it to change it
- **What BaseLinker does: no evidence of a read-only state.** Promotions end automatically on their date, and on deactivation the promo prices are cleared ("Promocje w Base"). Action groups are switched on and off ("szybko włączyć lub wyłączyć całą grupę"). Editing or duplicating ended promotions is not described anywhere.
- **Complaints:** no evidence.
- **Recommendation: DROP.** Let an ended promotion be edited and re-activated. The history is safe without the lock, because each gift line keeps its own frozen snapshot (O1 id plus the frozen name, as the automation runs table already does).

### D1. Gift on a receipt as 0,01 zł, the grosz taken from a paid line (same VAT rate first)
- **What BaseLinker does: almost exactly this, for IdoSell gifts (07/2026).** Gift lines "otrzymują one techniczną cenę 0,01 zł, a ich wartość jest odejmowana od pozostałych produktów w zamówieniu" (https://base.com/pl-PL/blog/spis-aktualizacji-lipiec-2026/). Which line gives up the grosz, and whether VAT rate matters, is not documented.
- **Complaints:** receipts have no discount field, so negative or zero lines are a printer problem. The vendor pushes these to the integrator: "Za integrację 'Paragony - drukarka fiskalna' odpowiadają zewnętrzne firmy" (r1). r3 calls the technique an anti-pattern, because the list price is lost.
- **Recommendation: ADOPT, keeping "same VAT rate first".** That is the part BaseLinker leaves unspecified, and moving a grosz across VAT rates changes the tax.

### D2. Split a line whose value does not divide evenly by quantity
- **What BaseLinker does: no evidence.** Receipt lines carry only `price_brutto`, `tax_rate` and `quantity` (getNewReceipts, r1). The shop FAQ admits rounding drift, "Przyczyną jest różnica w zaokrąglaniu cen po stronie sklepu i systemu", and the fix it gives is to disable the integration option "og_fix" (https://base.com/pl-PL/pomoc/faq/sklep/pobieranie-zamowien-ze-sklepu/).
- **Complaints:** rounding mismatches between shop and system (the FAQ above).
- **Recommendation: ADOPT, applied only when needed** (quantity above 1 and the division leaves a remainder). It is the only way to make quantity times unit price equal the line total on a fiscal document, which is the drift BaseLinker's own FAQ admits.

### D3. A one-grosz rounding remainder goes to the largest paid line, never to a gift
- **What BaseLinker does: no evidence** (see D1; the allocation rule is undocumented).
- **Complaints:** no evidence.
- **Recommendation: ADOPT and reuse.** OL already does this: `splitShippingAcrossRates` and `distributeOrderDiscount` both put the remainder on the largest part. Call the same helper rather than writing a second rule.

### D4. A whole-order discount holds the document until the operator clicks "spread"
- **What BaseLinker does: never holds; the integration setting decides.**
  - Shop orders: the discount is either "ujęty jako odrębna pozycja zamówienia" or "rozłożony równo na wszystkie produkty" (pobieranie-zamowien-ze-sklepu FAQ).
  - Kaufland: "pominąć, tworzyć osobne pozycje rabatowe, łączyć z produktami" (lipiec 2026).
  - Manual discount: a negative line, "stwórz pozycję o nazwie np. 'Rabat' i cenie na minusie" (r1 S2).
- **Complaints:** an "equal" spread is wrong for VAT on mixed-rate orders; negative lines break fiscal printers (r1, r3).
- **Recommendation: SIMPLIFY.** Spread automatically and proportionally to line values (OL's `distributeOrderDiscount`) and show the result on the order. Hold only when the spread cannot work (for example no paid line can absorb it). A click on every order is friction BaseLinker users never face.

### D5. EUR order with foreign VAT (Erli, DE 19%/7%): no automatic PLN document; the order waits for review
- **What BaseLinker does: issues automatically.**
  - Invoices are in the order currency.
  - Conversion: "Przeliczaj na PLN → Wyświetl podsumowanie w PLN" at the NBP rate, fetched automatically.
  - VAT: per series, either fixed or "użyć stawki VAT obowiązującej w danym kraju kupującego (OSS)" (https://base.com/pl-PL/pomoc/wiedza/faktury/).
  - Documents exist only when issued by hand or by an automatic action, so a seller can condition the action by country.
- **Complaints:** no evidence.
- **Recommendation: SIMPLIFY.** Do not add a special EUR rule. Reuse OL's sales-document routing: no rule or country default for DE gives the existing `unresolved / no-configuration-for-country` state. A seller who configures DE routing gets documents automatically, as BaseLinker sellers do.

### D6. Returns: (a) match identical lines to the one without the bundle discount; (b) a kept gift is never deducted automatically; (c) propose clawing back the lost bundle discount
- **What BaseLinker does:**
  - **(a) No evidence.** Return items carry `bundle_id` and `order_product_id` (getOrderReturns, r4 S7). Allegro returns are accepted or rejected only whole ("zwrot może zostać zaakceptowany lub odrzucony tylko w całości", r5).
  - **(b) Effectively yes:** nothing is automatic. The operator changes the refund by editing price: "zmieniając cenę produktu w zwrocie, można zmienić zwracaną kwotę" (r1/r5).
  - **(c) No:** "No automatic lost-bundle-discount calc" (r1, r3, r4 B-15).
- **Complaints:** whole-return-only for Allegro and one return per order (r1).
- **Recommendation:**
  - **(a) DROP the preference.** Match by `resolvedOrderLineId` (#3171) and, where it is ambiguous, report it as the existing flow does, instead of a guessed tie-break.
  - **(b) ADOPT.** This is BaseLinker's de facto behaviour and needs no extra screen.
  - **(c) SIMPLIFY** to showing the lost-discount amount as information next to an editable refund amount, which is BaseLinker's manual edit with a hint.

### C1. "Take the composition from PrestaShop" button when the OL bundle differs from the PrestaShop pack
- **What BaseLinker does: imports sets per platform.**
  - Shoper (07/2025), WooCommerce (03/2026), Upgates, VTEX, Unas, HostGator (2026).
  - Nexo and Subiekt GT with the option "traktuj jako zestawy" (r5, lipiec 2026).
  - **PrestaShop packs: no evidence in any round.** A fresh check today was blocked by the tool limit.
  - No diff view or re-pull button is documented.
- **Complaints:** a third-party author says shop-defined sets had to be rebuilt in BaseLinker by hand: "musimy rozbijać i łączyć na nowo" (https://budowanie-sklepu.pl/scalanie-magazynow-automatyzacja-kontroli-stanow-problematyka-synchronizacji-menager-baselinker/, via r1). A 2018 vendor reply said scanning bundles was a problem until "w BaseLinkerze pojawi się wbudowana obsługa zestawów" (r1).
- **Recommendation: ADOPT, one-way only.** The button removes exactly the manual rebuild merchants complain about. Do not add a two-way sync.

### C2. Small-gift register (PL VAT art. 7 ust. 3-4) keyed by resolved customer
- **What BaseLinker does: nothing.** No gift report, no per-customer counter, no register was found in any round (r1 G-12, r3, r4).
- **Complaints:** no evidence.
- **Recommendation: SIMPLIFY.** Drop the legal register from v1. Ship a gift export per resolved customer per year (same key as P2), which an accountant can turn into the register. A statutory register implies a compliance claim OL should not make without professional advice.

### C3. Separate option "hold every document with a gift until a decision"
- **What BaseLinker does: no such mode.** Documents are not automatic in the first place ("Faktury nie są tworzone automatycznie" unless issued by hand or by an action; faktury help). A seller holds them by conditioning the issuing action.
- **Complaints:** no evidence.
- **Recommendation: DROP.** Keep the four gift document modes. A seller who wants manual control already has the trigger model `manual` and the existing sales-document holds.

### A1-A3
Assumptions only; not checked.

## Summary table

| Rule | BaseLinker | Recommendation |
|---|---|---|
| P1 | No gift de-duplication; product-present conditions only | SIMPLIFY: skip if the gift product is on any line |
| P2 | Phone first, then Allegro login or e-mail; 60-day window; archive invisible | ADOPT (resolved customer, full history) |
| P3 | List order; all matching actions run; no priority or exclusivity | SIMPLIFY: all apply, list order, optional "nie łącz" later |
| P4 | No budget, no stock stop | SIMPLIFY: stop on gift stock 0, optional count cap; drop cost budget |
| P5 | No date condition; fixed gift quantity | SIMPLIFY: placed date only; fixed quantity, defer per-N |
| O1 | Gift known only by its display name | ADOPT |
| O2 | Edit at any stage, no gates | SIMPLIFY: reuse #3542 edit refusals |
| O3 | Multipack = one-component bundle; no hold documented | SIMPLIFY: reuse `awaiting_mapping` and auto re-resolve |
| O4 | No evidence | DROP read-only; allow edit |
| D1 | IdoSell gift = 0,01 zł, value taken from other lines | ADOPT (keep same-VAT-first) |
| D2 | No evidence; admits rounding drift | ADOPT, only when needed |
| D3 | No evidence | ADOPT via existing remainder helper |
| D4 | Never holds: separate line or "równo" spread per integration | SIMPLIFY: auto proportional spread |
| D5 | Auto-issues: order currency, NBP conversion, OSS VAT per series | SIMPLIFY: reuse routing `unresolved` |
| D6 | Manual refund edit; nothing automatic | (a) DROP, (b) ADOPT, (c) SIMPLIFY to info + editable amount |
| C1 | Imports sets for many platforms, not PrestaShop (no evidence) | ADOPT (one-way) |
| C2 | Nothing | SIMPLIFY: gift export per customer |
| C3 | No such mode | DROP |

## Three strongest findings

1. **D1 is already BaseLinker's production behaviour.** "techniczna cena 0,01 zł, a ich wartość jest odejmowana od pozostałych produktów" (lipiec 2026). OL's version is the same idea plus "same VAT rate first", the part BaseLinker leaves undefined.
2. **P2 matches BaseLinker's identity choice** (phone, then marketplace login, not e-mail). BaseLinker's documented weakness, "Aktualnie niestety nie" for archived orders, says OL should count over full history.
3. **BaseLinker has no priority, budget, exclusivity or holds** (P3, P4, D4, C3). All matching actions run, and discounts are spread or turned into lines automatically. The prototype's heavier rules go beyond what the market leader's users work with, so the simpler variants are safe.
