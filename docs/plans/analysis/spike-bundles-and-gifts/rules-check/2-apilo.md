# Rules check 2: Apilo

Date: 2026-11-04. Read-only. No account, no sign-up.

## Method and limits

- Reused: r1/phase2/3-apilo.md, r2/phase2/3-apilo.md, r3/phase2/2-apilo.md, r4/phase2/2-apilo.md, r5/4-competitors-pl.md.
- New pass over primary sources: the Polish help corpus listed in `https://apilo.com/help-sitemap.xml` (165 articles; 121 read in this pass, the other 44 were refused by the site's Wordfence rate limit and the earlier-round copies of the key ones were used instead), the feature page `https://apilo.com/pl/funkcje-apilo/zadania-automatyczne/`, and the REST API 2.0.0.13 OpenAPI document embedded in `https://developer.apilo.cloud/api/2.0.0.13`.
- Dates are the page's own `dateModified`.
- **Merchant voice: nothing found on any of these 21 rules.** The earlier rounds searched the Allegro community, wykop, forums and Facebook and found no Apilo thread about bundles or gifts (r1/phase1/5-merchant-voice.md: "No IdoSell, Apilo, Sellasist or wykop.pl thread on this topic surfaced"). The only Apilo thread found ("Opinie o Apillo", spolecznosc.allegro.pl, td-p/983203) is about sync frequency and support, not these rules. Web search and web fetch were unavailable for a further pass in this run (spend limit), so no new merchant quotes were collected. Where a row says "complaints: none found", that is the honest state.

## Sources

| ID | URL | Kind | Modified |
|---|---|---|---|
| A1 | https://apilo.com/pl/help/zestaw-produktow-do-czego-sluzy-i-jak-utworzyc/ | help | 2025-07-25 |
| A2 | https://apilo.com/pl/help/zadania-automatyczne/ | help | 2026-05-06 |
| A3 | https://apilo.com/pl/funkcje-apilo/zadania-automatyczne/ | feature page (lists literal UI items) | 2026-05-27 |
| A4 | https://apilo.com/pl/help/konfiguracja-modulu-fakturowania-paragonow/ | help | 2026-04-01 |
| A5 | https://apilo.com/pl/help/allegro-zwroty-platnosci-i-prowizji/ | help | 2026-02-17 |
| A6 | https://apilo.com/pl/help/polaczenie-z-kontem-allegro/ | help | 2026-04-08 |
| A7 | https://apilo.com/pl/help/polaczenie-z-shopify/ | help (FAQ) | 2026-03-04 |
| A8 | https://apilo.com/pl/help/fakturownia-pl-faktury-paragony-i-integracja-magazynu/ | help | 2026-04-15 |
| A9 | https://apilo.com/pl/help/polaczenie-z-kontem-ebay/ | help | 2026-05-13 |
| A10 | https://developer.apilo.cloud/api/2.0.0.13 | API spec | - |
| A11 | https://apilo.com/pl/help/manager-zamowien-3-0-organizacja-pracy/ | help | - |
| A12 | https://apilo.com/pl/help/paragony-podlaczenie-drukarki-fiskalnej/ | help | - |

## How Apilo is built (one paragraph, so the rows make sense)

Apilo has no "promotion" object. A gift is either (a) a component of a set ("Zestaw produktów", A1: "stwórz zestaw z gratisem (np. produkt „Czapka" oraz „Szal" połącz w zestaw „Czapka + szalik gratis")") or (b) a product added by a generic automation rule: event + conditions + ordered actions, one action being "Dodaj produkt do zamówienia" (A3: "Ustaw warunki (np. wartość zamówienia > 200 zł), które muszą być spełnione, aby system automatycznie dodał do zamówienia określony produkt (np. gratis)"). Documents are also issued by such rules, never by a built-in policy. Almost every promotion rule in our list therefore has no Apilo counterpart; the document and returns rules have partial ones.

## Rule by rule

### P1. Skip the gift when the bundle already contains it
- Apilo: **no dedicated behaviour.** The closest tool is the rule condition "Czy w zamówieniu istnieje zestaw?" (A3, condition list), which lets the operator exclude every order that contains any set from a gift rule. It is coarse (any set, not "a set containing this gift") and opt-in.
- Complaints: none found.
- Recommendation: **SIMPLIFY** to a gift rule that never adds a product already present in the order (as a line or as a bundle component), no special setting. One sentence why: it is a cheap, always-correct guard and needs no operator configuration, while Apilo's coarse condition shows sellers otherwise have to hand-build it.

### P2. Per-customer limit by channel buyer id, not e-mail
- Apilo: **no per-customer limit anywhere.** The 39 conditions (A3) include "Numer telefonu", "Dane do faktury", "Czy klient podał NIP?" but nothing about earlier orders of the same buyer. Apilo does keep the channel login on the order: API `RestOrderDetailDTO` has `customerLogin` (A10, no description) next to `addressCustomer`. No customer database is documented.
- Complaints: none found.
- Recommendation: **DROP from v1** (no per-customer limit); if a limit is ever added, key it by the channel login as the rule says. Why: no Polish OMS competitor we checked offers it, it needs a buyer-history read for every order, and Apilo shows the market lives without it.

### P3. Several promotions: priority number, "does not combine"
- Apilo: **no priority between rules, no "does not combine" flag.** Every active rule whose event fires and whose conditions pass runs. Ordering exists only for actions inside one rule: A2 "W polu numer 3. „Wykonaj akcję" dostępny jest suwak, umożliwiający łatwą zmianę i ustalenie optymalnej kolejności wykonywanych działań. UWAGA! KOLEJNOŚĆ AKCJI MA ZNACZENIE!". Rule groups have an order, but it is display order: A3 "Sam decyduj, które grupy i zadania chcesz widzieć jako pierwsze"; A2 "Za pomocą suwaka możesz dowolnie zmieniać kolejność wyświetlania stworzonych grup". (A3 also says "Pogrupuj reguły np. według marketplace, typu zadania lub priorytetu" - grouping by priority as a label, not an execution rule.)
- Complaints: none found.
- Recommendation: **SIMPLIFY**: all matching gift promotions apply (each at most once per order); no priority number and no combine flag; overlap is shown to the operator when saving (two active promotions with overlapping conditions). Why: Apilo runs thousands of shops with "everything that matches fires" and the operator narrows conditions; a priority/combine matrix is a second rule engine nobody asked for.

### P4. Budget that pauses the promotion; no budget without purchase cost
- Apilo: **no budget, no cost-based cap.** The only cap-like tool is the condition "Stan magazynowy produktu" (A3) and, for a set gift, the set's stock being "obliczany na podstawie dostępności najniższego stanem produktu" (A1) so the offer stops when the gift runs out.
- Complaints: none found.
- Recommendation: **DROP**; instead cap a promotion by gift **quantity** (or simply by the gift's stock), and stop when it is reached. Why: quantity is what a warehouse can see and count; a money budget needs purchase cost on every gift (often missing) plus a pause/resume state machine.

### P5. Which date counts; gift per qualifying unit
- Apilo: date - the condition is "Data złożenia zamówienia" (A3), i.e. the date the buyer placed the order; there is no option for "date received by the system". Per unit - conditions exist on line quantity ("Produkty na zamówieniu - ilość sztuk na pozycji", A3), but the fields of "Dodaj produkt do zamówienia" (product, quantity, price) are not documented anywhere public, so a "1 gift per 2 mugs" multiplier: **no evidence**.
- Complaints: none found.
- Recommendation: **SIMPLIFY**: always use the order placed date (fall back to received date only when the channel sends none, without an operator choice); keep "per qualifying unit" only as a plain "N gifts per M units" pair if the team needs it, otherwise one gift per order. Why: the date choice is a setting nobody would change; Apilo has only placed-date and it is the date the buyer saw the promotion.

### O1. Gift line id `ol-gift:{ruleId}:{lineId}`
- Apilo: no gift marker at all. Lines that came from a set carry an icon ("Informacja o tym, że pozycja zamówienia została utworzona na podstawie zestawu widnieje jako ikonka 2 kwadratów", A1) and an integer `productSet` in the API item detail (A10). Rule-added products carry nothing (item `type` is only "1-Product, 2-Shipment, 3-service", A10). Line id format: no evidence.
- Complaints: none found.
- Recommendation: **ADOPT** (it is internal and invisible) and add a visible "gift" marker on the line like Apilo's set icon. Why: a deterministic id is what makes re-ingestion idempotent; Apilo's lack of any marker is exactly why its gifts cannot be reported or treated differently on documents.

### O2. Operator adds a gift manually at different stages
- Apilo: adding lines by editing the order is supported (A1 "Wariant 2: Tworząc nowe zamówienie lub edytując istniejące skorzystaj z edycji/dodawania pozycji w zamówieniu"; A11 order detail lets you "spakować zamówienie oraz je edytować"). There is an event "Rozpakowano zamówienie" (A3), so unpacking exists. Stage-dependent warnings or refusals: **no evidence.** A document already issued is changed only by a manual correction (A4 "jeśli chcesz anulować sprzedaż wybranej pozycji – zmień ilość na 0").
- Complaints: none found.
- Recommendation: **SIMPLIFY** to two states: allowed until the parcel is packed; after packing, refused with "unpack first"; after a document exists, allowed with a note that the document does not include the gift (no separate after-routing warning). Why: the packed boundary is the only one that causes physical errors; routing is invisible to most operators.

### O3. Allegro multipack (productSet quantity > 1) held until a bundle is defined
- Apilo: **no evidence** of reading Allegro's `productSet.quantity` or holding such orders. Multipacks are modelled as a set of N of one product ("Możesz utworzyć zestaw „Kabel RJ-45 5m", który będzie składał się z 5 sztuk „Kabel RJ-45"", A1) linked to the offer in "Relacje produktów". An offer not linked to a set is simply imported as one product.
- Complaints: none found.
- Recommendation: **ADOPT** the hold (it prevents shipping 1 instead of 3), but make "check again" automatic when the bundle is saved rather than a separate button. Why: Apilo silently imports such an order as quantity 1 unless the operator pre-linked a set, which is the oversell/undership the rule prevents.

### O4. Ended promotion read-only, change by duplicating
- Apilo: rules have no "ended" state; they are switched on/off and stay editable. Duplicate exists: A2 "skopiowanie wybranego zadania automatycznego (skopiowane zadanie automatyczne jest domyślnie ustawione jako nieaktywne)".
- Complaints: none found.
- Recommendation: **ADOPT** the duplicate button (copy starts inactive, as in Apilo); read-only after end is fine if the promotion record is used by reports. Why: duplication is a proven, familiar pattern; editing a finished promotion would rewrite history behind past orders.

### D1. Gift on a receipt at 0,01 zł, grosz taken from a paid line
- Apilo: **no documentation of gift pricing on receipts/invoices.** Two facts bound it: the API refuses order lines below one grosz (`originalPriceWithTax` and `originalPriceWithoutTax` have `"minimum": 0.01` on every order-item DTO, A10), so a gift line is at least 0,01; and Apilo's only documented re-pricing keeps the document total equal to what was paid (shipping folding, see D2). Taking the grosz from a paid line: no evidence.
- Complaints: none found.
- Recommendation: **ADOPT** (keep the total equal to what the buyer paid). Why: adding 0,01 on top creates a receipt that does not match the payment; Apilo's own re-pricing preserves the paid total.

### D2. Split a line so qty x unit price matches
- Apilo: **yes, documented**, for shipping folded into items. A4: "Opcja Dodaj cenę proporcjonalnie ukrywa przesyłkę na fakturze, natomiast koszty przesyłki są wliczane proporcjonalnie do zakupionych towarów." ... "Przykład nr 2: w zamówieniu są następujące pozycje: 3x przedmiot 10pln/szt. (łącznie 30zł) + przesyłka 10zł. Na wystawionej fakturze pojawią się pozycje: 2x przedmiot 13,33zł/szt + 1x przedmiot 13,34zł/szt."
- Complaints: none found.
- Recommendation: **ADOPT** as is. Why: it is the exact pattern (one line of 3 becomes 2 + 1 so the sum is 40,00) and a shipping competitor does it in production.

### D3. Rounding remainder to the largest paid line, never a gift
- Apilo: the remainder lands on a split unit of the line being re-priced (the 13,34 above, A4); "largest line" is not stated. Gift exclusion: no gift concept, so no evidence.
- Complaints: none found.
- Recommendation: **ADOPT** (largest paid line, never a gift) - deterministic and close to Apilo's behaviour. Why: one fixed place for the grosz makes documents reproducible; excluding gifts keeps them at their nominal value.

### D4. Whole-order discount holds the document until "spread the discount"
- Apilo: **spreads automatically, no hold.** A7 FAQ "W jaki sposób naliczany jest rabat do zamówień?": "W ustawieniach platformy Shopify jest pole pozwalające na wybór strategii przez sprzedawcę, bez zmiany pozycji na odpowiednią mechanizm nie będzie uruchamiany. Rabat rozbijany jest tylko na przedmioty." The same automatic, proportional approach is used for sets: "jeśli cena zestawu w pozycji zamówienia różni się od ceny zestawu w magazynie Apilo to zostanie ona proporcjonalnie przeliczona, by odpowiadała pozycji w zamówieniu" (A1). The API keeps order-level discounts separately (`orderDiscounts`, "Discount type. 1 - product, 2 - shipment", A10).
- Complaints: none found.
- Recommendation: **SIMPLIFY**: spread an unallocated discount over item lines proportionally to their value automatically (items only, not shipping, not gifts) and show it on the order; no hold, no button. Why: the allocation is deterministic, so a click adds a waiting order and no decision.

### D5. EUR order with foreign VAT: no automatic PLN document, order waits
- Apilo: documents are only auto-issued by a rule the operator builds (A4 "Apilo może automatycznie wygenerować i wysłać fakturę do kupującego. Do tego celu użyj modułu zadań automatycznych"), and the conditions include "Waluta zamówienia" and "Kraj zamówienia" (A3), so foreign orders are held simply by not matching. Document templates are per currency ("Możesz przygotować klika szablonów faktur dostosowanych do poszczególnych kanałów sprzedaży – w różnych językach, walutach", A4) and OSS is supported ("Dla faktur OSS powinna zostać wybrana opcja „Użyj podstawowej stawki VAT wg kraju kupującego (OSS)"", A4). Exchange rate: own or NBP ("'źródło kursu przewalutowania'. Można wybrać pomiędzy kursem własnym - z Apilo, który jest domyślny, a NBP", A8). Receipts: "Fakturownia automatycznie nie fiskalizuje paragonów z walutą inną niż PLN" (A8). Foreign VAT on Allegro: "Podczas wybierania danego rynku należy ustalić konkretną stawkę VAT po stronie Allegro" (A6).
- Complaints: none found.
- Recommendation: **SIMPLIFY**: no special EUR rule; a document is issued automatically only when the order's currency/country has a configured document route (series in that currency, or OSS), otherwise the order shows "no document route" - the existing routing outcome. Why: Apilo proves the hold falls out of "no matching route" without a dedicated rule.

### D6. Returns
- Apilo: (a) **no automatic matching**: the operator picks the products: A5 "Wybierz za które produkty chcesz zwrócić płatność", and Apilo does not even pull the Allegro return: "Nie pobieramy z Allegro numerów zwrotów" (A5). (b) Kept gift: no gift concept; operator decides everything - matches the rule's "operator decides". (c) Lost bundle discount claw-back: **no evidence**; corrections are manual per line ("zmień ilość na 0", A4).
- Complaints: none found.
- Recommendation: (a) **SIMPLIFY**: pre-select the line without the bundle discount as a suggestion, operator confirms; (b) **ADOPT**; (c) **DROP** the automatic proposal; show the bundle discount amount on the returned line as information and let the operator type a deduction. Why: Apilo leaves all three to the operator and the edge cases (identical lines, partial sets) are rare enough that a suggestion beats a computed claim.

### C1. "Take the composition from PrestaShop" button
- Apilo: **no import of shop bundle definitions.** Sets are defined in Apilo only, built from Apilo products; an imported listing can be converted by hand: A1 "Kliknij przycisk „Zmień Produkt na zestaw"". No PrestaShop pack import or diff found in the PrestaShop connection article.
- Complaints: none found.
- Recommendation: **SIMPLIFY** to a one-time "import from PrestaShop" when creating the bundle; no ongoing difference detection. Why: Apilo shows sellers manage with OL-owned definitions; a one-time import saves typing without a two-master sync problem.

### C2. Small-gift register keyed by resolved customer
- Apilo: **no evidence** of any gift register, tax-free gift threshold or customer resolution (no customer database; only `customerLogin` on the order, A10).
- Complaints: none found.
- Recommendation: **DROP from v1**; export gift lines (date, buyer, gift, purchase cost) for the accountant instead. Why: no competitor tracks it, and the legal test is the accountant's, not the OMS's.

### C3. Separate option "hold every document with a gift until a decision"
- Apilo: no such option; auto-issue is always an operator-built rule, so a seller who wants manual handling just does not auto-issue (or adds a tag condition). Since gifts have no marker, Apilo cannot even target "orders with a gift".
- Complaints: none found.
- Recommendation: **DROP**; the existing per-document gift options (omit / 1 grosz / priced-in / internal) plus "auto-issue off" already cover it. Why: a fifth option duplicates switching auto-issue off for the channel.

## Three strongest findings

1. **D2 has a direct production precedent.** Apilo's invoice help (A4, modified 2026-04-01) shows exactly the line split: "3x przedmiot 10pln/szt. ... + przesyłka 10zł" becomes "2x przedmiot 13,33zł/szt + 1x przedmiot 13,34zł/szt", keeping the total at 40,00. D2 and D3 can be adopted with confidence.
2. **Apilo spreads order-level discounts and set price differences automatically; it never holds a document for them** (A7 "Rabat rozbijany jest tylko na przedmioty"; A1 "proporcjonalnie przeliczona"). D4's hold-and-click is unnecessary; spread proportionally and show it.
3. **Apilo has no promotion engine at all**: no priority, no combine flag, no budget, no per-customer limit, no gift marker (A2, A3, A10). All matching rules fire; ordering exists only inside one rule. P2, P3, P4 and C2 have no market precedent in Apilo and are the first candidates to drop or simplify for v1.
