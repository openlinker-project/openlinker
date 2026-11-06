# Rules check 3: Sellasist against the 21 prototype rules

Date: 2026-11-04. Read-only desk research. No account, no sign-up.

## Method and limits

- **Reused:** r1/phase2/4-sellasist.md, r2/phase2/4-sellasist.md, r3/phase2/3-sellasist.md, r4/phase2/3-sellasist.md, r5/4-competitors-pl.md.
- **Fetched fresh today:** the whole help centre, 899 articles. Index via `GET https://sellasist.pl/wp-json/wp/v2/help?per_page=100&page=N`, bodies via `POST https://sellasist.pl/wp-admin/admin-ajax.php` with `action=get_page_sections&post_id=N`. Every article was text-searched per rule. Also the API spec `https://api.sellasist.pl/api.yaml` (v1.92.8).
- **Merchant voice: none found.** One web search (the tool was rate-limited for part of the session) returned no Sellasist-specific review. The public ideas board `https://pomysly.sellasist.pl/` (Frill) loads ideas through GraphQL; the list query needs an input object I could not reconstruct without introspection, so ideas were not read. Complaints below are the ones Sellasist itself answers in its help (FAQ entries, warnings).
- Quotes are verbatim from the article text. "No evidence" means a full-text search of all 899 articles found nothing.

## Background: Sellasist's model in four lines

1. **No promotion object.** A gift is an automation ("Akcje dla zamówień"): conditions, then the effect "Dodaj produkt". Every matching action runs.
2. **Gift on documents** = the gift line at its price plus an automatic "Rabat" line cancelling it, one per VAT rate; or the gift hidden from documents.
3. **Bundle ("zestaw")** = a catalogue product flagged as a set; the order line is split into components by an automation.
4. **Discounts from channels** are normalised per integration: subtract from line prices, or a separate "Rabat" line, plus "balance to the amount paid".

## Promotions

### P1. Skip the gift when a bundle in the order already contains it
- **Sellasist: no equivalent.** The effect has no "already in order" check. Conditions can look at products ("DANE PRODUKTU", "POLE DODATKOWE PRODUKTU", "ZESTAW NIEROZBITY NA PRODUKTY"; list at https://sellasist.pl/pomoc/akcje-dla-zamowien-lista-warunkow-i-efektow-omowienie-wraz-z-zastosowaniem/), but nothing documents a de-duplication against bundle components.
- **Complaints:** no evidence.
- **Recommendation: SIMPLIFY.** One generic check: do not add a gift product already present on the order (any line, bundle components included, since OL expands at ingestion). Not a bundle-specific rule.

### P2. Per-customer limit counted by channel buyer id, not e-mail
- **Sellasist: no limit counter at all.** The customer condition matches the current order only: "rozpoznawać zamówienia na podstawie adresu e-mail, numeru telefonu, numeru NIP lub przynależności klienta do określonych grup" (https://sellasist.pl/pomoc/dane-klienta-warunek-akcji-automatycznej-dla-zamowien/). It does keep the channel identity: the order API carries `external_login` ("Login kupującego w zewnętrznym portalu") and `external_user_id`, and orders can be searched by "zewnętrznym user ID lub user login" (api.yaml, `GET /orders` param `external_user`).
- **Complaints:** no evidence.
- **Recommendation: ADOPT the key, keep the feature optional.** Keying by channel buyer id is exactly what Sellasist stores and searches by; e-mail aliases make e-mail useless on Allegro. But no Polish competitor offers a per-customer gift limit, so it can ship later.

### P3. Several matching promotions: priority number, "does not combine"
- **Sellasist: no equivalent.** No priority or execution order for automations is documented (search for "priorytet", "kolejność" in automation articles: only order/status priority, e.g. "Automatyczne przypisanie priorytetu" for orders, same list article). Every action whose conditions hold runs. Actions can only be grouped for overview ("Grupy akcji automatycznych", https://sellasist.pl/pomoc/grupy-akcji-automatycznych/). Its own storefront has a stacking rule, but a fixed one: "Rabaty i promocje nie łączą się, z wyjątkiem gratisu" (https://sellasist.pl/pomoc/jak-dzialaja-rabaty-indywidualne-dla-klientow/) and "Wybierana jest najkorzystniejsza dla kupującego zniżka" (https://sellasist.pl/pomoc/jak-skonfigurowac-programy-lojalnosciowe-w-sellasist/).
- **Complaints:** no evidence.
- **Recommendation: SIMPLIFY.** Default: all matching gift rules apply (Sellasist's model). Add only one flag, "exclusive", where an exclusive rule wins by a single fixed order (e.g. oldest first or highest threshold). Drop the free priority number for v1.

### P4. Budget pauses the promotion; no budget without purchase cost
- **Sellasist: no equivalent.** No budget, no counter, no auto-pause. The only stock-related brake is the default stock check on the gift, with "Ignoruj stan magazynowy dodawanego produktu" to override (https://sellasist.pl/pomoc/dodaj-produkt-efekt-automatyzacji-dla-zamowien/). Failed runs are visible in "Dziennik zdarzeń" for a month.
- **Complaints:** no evidence.
- **Recommendation: DROP the money budget for v1.** Use the gift product's stock as the natural cap (Sellasist's behaviour), optionally a "max gifts given" count. A cost budget needs purchase costs that many catalogues do not have.

### P5. Which date counts; gift per qualifying unit
- **Date:** only "Data złożenia" exists, with a warning: "Jeżeli ustawisz datę wstecz, system sprawdzi wszystkie zamówienia z tego okresu i zastosuje do nich wybrany efekt akcji, co może być problematyczne dla zamówień już zrealizowanych" (https://sellasist.pl/pomoc/data-zlozenia-warunek-akcji-automatycznej-dla-zamowien/).
- **Per unit:** "Ustawiaj ilość produktów gratisowych proporcjonalnie do ilości produktu w zamówieniu" adds one gift per qualifying unit (1:1, "doda próbkę kremu do każdego zamówionego swetra"; same Dodaj produkt URL). No N:M ratio such as 1 per 2.
- **Complaints:** the backdating warning above is Sellasist answering the retro-application problem itself.
- **Recommendation: SIMPLIFY.** Use the order-placed date only, and never apply a rule to orders that arrived before the rule was activated. Per-unit: ship 1:1 ("one gift per qualifying unit"); add "1 per N" only on demand.

## Order and packing

### O1. Gift line id `ol-gift:{ruleId}:{lineId}`
- **Sellasist:** no gift id or flag in the order API; cart lines carry `product_id, variant_id, quantity, price, tax_rate` only (api.yaml `carts`). Its workaround is a Symbol/EAN on the discount line: "Wpisz dowolną wartość, aby móc automatycznie procesować kolejne etapy" (Dodaj produkt URL).
- **Complaints:** no evidence; r3 lists "a gift is just a product" as Sellasist's main weakness.
- **Recommendation: ADOPT.** A deterministic, internal id is what Sellasist lacks; it makes re-ingestion idempotent and gifts reportable. Keep it internal.

### O2. Manual gift add: OK before routing, warn after routing, refused after packing, warn after invoice
- **Sellasist:** manual add is a pattern via an extra field "Dodaj gratis" and buttons ("Aktywatory") (list article above). In WMS the gift can be hidden in picking and added at packing: "Gratisy są dodawane dopiero w trybie pakowania" (https://sellasist.pl/pomoc/jak-dodac-opcje-ukrycia-produktu-w-trybie-zbierania-i-pakowania/). No documented stage lock. After an invoice, edits are handled by corrections: "Automatyczne wystawianie korekt faktur jest szczególnie przydatne w sytuacjach takich jak ... wprowadzanie zmian w produktach zamówienia" (https://sellasist.pl/pomoc/jak-wystawic-fakture-vat-i-korekte-do-faktury-vat-w-obcej-walucie/).
- **Complaints:** no evidence.
- **Recommendation: SIMPLIFY.** Two states: allowed until the parcel is closed (with a warning if a pack task exists), refused after. After an invoice, warn only; a 0-value gift changes no money, so no correction is needed.

### O3. Allegro multipack held until a bundle "3 x coffee" is defined
- **Sellasist:** resolved at catalogue import, not at the order. Allegro set import: "system porównuje skład i ilości produktów w zestawie ... Jeśli nie uda się dopasować oferty, a w Rodzaju importu ustawiono Powiąż produkty, ani nowy produkt, ani nowy zestaw nie zostaną utworzone" (https://sellasist.pl/pomoc/jak-zaimportowac-asortyment-i-oferty-z-allegro/). Multipack = experimental "produkty zależne": "modyfikują stan produktu głównego o podaną liczbę sztuk" (https://sellasist.pl/pomoc/jak-sprzedawac-w-wielopaku-czym-sa-produkty-zalezne/).
- **Complaints:** both are experimental features; no user voice.
- **Recommendation: SIMPLIFY.** Keep the hold (it prevents a wrong stock decrement), but let the operator fix it once on the offer mapping ("this offer = 3 x coffee"), which releases all held orders of that offer. Sellasist shows the fix belongs to the offer link, not to each order.

### O4. Ended promotion is read-only; change = duplicate
- **Sellasist:** actions stay editable; copying is a first-class button: "Klikając Zapisz jako nowy - utworzysz jej kopię" (Data złożenia URL; same text in https://sellasist.pl/pomoc/dane-klienta-warunek-akcji-automatycznej-dla-zamowien/). No end-date or read-only state.
- **Complaints:** no evidence.
- **Recommendation: ADOPT, lightly.** Read-only after end keeps reports honest; "Duplicate" is the same one button Sellasist uses. No versioning beyond that.

## Documents and returns

### D1. Gift on receipt as 0,01 zł, grosz taken from a paid line
- **Sellasist: different approach.** The gift keeps its full price and a separate "Rabat" line cancels it: "Szalik o wartości 119 PLN dodany jako gratis → Rabat wyniesie: -119 PLN ... system utworzy osobne pozycje rabatujące dla każdej stawki" (Dodaj produkt URL). Or "Ukryj na dokumentach sprzedaży" hides it. No 0,01 zł in any of the 899 articles.
- **Complaints:** no evidence.
- **Recommendation: SIMPLIFY.** Offer two modes only: omit the gift from the document (default), or gift at price + one discount line per VAT rate (Sellasist's proven pattern). Drop 0,01 zł unless a fiscal printer is confirmed to reject the discount pattern.

### D2. Uneven line split into two lines
- **Sellasist:** closest is the balancing option: "korekta zostanie zastosowana wyłącznie do pierwszej sztuki" (https://sellasist.pl/pomoc/instrukcja-konfiguracji-integracji-sellasist-i-shopgold/). It admits the rounding issue: "mogą wystąpić różnice wynikające z zaokrąglania kwot do groszy" (https://sellasist.pl/pomoc/instrukcja-konfiguracji-nowego-modulu-integracji-sellasist-i-ebay/). Whether "first unit" becomes its own line is not stated.
- **Complaints:** the eBay text above is Sellasist warning about the problem.
- **Recommendation: ADOPT.** Splitting is the only way to keep qty x unit price exact, and Sellasist's "first unit" fix is the same idea.

### D3. Rounding grosz to the largest paid line
- **Sellasist:** corrects via the discount line or "zmieni cenę jednego z produktów" (shopGold URL), on the first unit, not the largest line. Never on a gift: gifts are added after import and are not part of channel balancing.
- **Recommendation: ADOPT.** Same principle; "largest paid line" is a deterministic choice; keep "never a gift line".

### D4. Unallocated order discount holds the document until "spread the discount"
- **Sellasist:** no hold. Per-integration setting chosen once: "Odejmuj od ceny produktów" or "Utwórz nowy pusty produkt „Rabat”" plus "Wyrównaj rozbieżności w kwocie do zapłaty" (shopGold URL). For payment fees it spreads per VAT rate: "kwota prowizji zostanie podzielona proporcjonalnie do wartości produktów objętych poszczególnymi stawkami VAT" (https://sellasist.pl/pomoc/dokumenty-sprzedazowe-i-magazynowe-nowy-modul-w-sellasist/).
- **Complaints:** rounding warning (D2).
- **Recommendation: SIMPLIFY.** Make proportional spreading automatic (setting per connection, default on); hold only when it cannot be done (mixed VAT and channel says nothing). No per-order button.

### D5. EUR order with foreign VAT waits for review
- **Sellasist:** automates instead of holding: conditions "WALUTA", "DANE ADRESOWE WYSYŁKI", effect "Zmień stawkę VAT w zależności od kraju wysyłki" (https://sellasist.pl/pomoc/zmien-stawke-vat-w-zaleznosci-od-kraju-wysylki-efekt-w-automatyzacji-dla-zamowien/), foreign-currency invoices with an automatic rate "z dnia poprzedzającego wystawienie faktury", and "Przy transakcjach OSS, paragon nie jest wystawiany" (https://sellasist.pl/pomoc/instrukcja-konfiguracji-serii-dokumentow-w-sellasist/).
- **Complaints:** FAQ: "510 CZK a na fakturze 510,02 CZK" until a setting is ticked (foreign-currency URL).
- **Recommendation: ADOPT the hold for v1.** Sellasist's automation needs per-country rules the operator must build; a hold is the safe default until OL has an OSS/foreign-VAT path. Never issue a PLN receipt for an OSS sale (same rule as Sellasist).

### D6. Returns: line matching, kept gift, bundle-discount claw-back
- **Sellasist:** returns are per line, operator decides: "przyjąć lub odrzucić częściowo ... zmienić ilość produktów ... edytować pozycję zwrotu" and "Kwota zwrotu jest przeliczana automatycznie na podstawie ilości zaakceptowanych zwrotów" (https://sellasist.pl/pomoc/jak-dodac-zwrot-zamowienia/, https://sellasist.pl/pomoc/nowy-modul-zwrotow-zamowien/). Allegro refunds: "Zaznacz produkty, których zwrot przyjmujesz" (https://sellasist.pl/pomoc/jak-dokonac-zwrotu-produktow-i-platnosci-w-zamowieniach-z-allegro/). No gift or bundle-discount logic.
- **Complaints:** no evidence.
- **Recommendation: SIMPLIFY.** (a) ADOPT matching to the undiscounted line, deterministic; (b) ADOPT "never deduct a kept gift automatically" (matches Sellasist's operator-decides); (c) DROP the automatic claw-back proposal; show the lost discount as information and let the operator edit the refund amount, which Sellasist already allows.

## Configuration and analytics

### C1. "Take the composition from PrestaShop"
- **Sellasist: no evidence** of PrestaShop pack import (PrestaShop articles 4732, 3984, 4873 have no "zestaw"/"pakiet"). Bundles come from file import, API, or Allegro set offers (r4 B-18).
- **Recommendation: SIMPLIFY.** One-way import on first link (and a manual "re-import" button), no ongoing diff detection.

### C2. Small-gift register (art. 7 ust. 3-4) keyed by resolved customer
- **Sellasist: no evidence** (no "małe prezenty", "ewidencja", "art. 7" in any article).
- **Recommendation: DROP from the product for v1.** No competitor does it; give an export of gifts per customer so the accountant keeps the register.

### C3. Document option "hold every document with a gift"
- **Sellasist:** no such option; gifts go on documents via discount line or are hidden.
- **Recommendation: DROP.** Two clear modes (D1) remove the need for a "decide later" mode.

## Summary table

| Rule | Sellasist | Recommendation |
|---|---|---|
| P1 skip gift already in bundle | No check | SIMPLIFY: generic "gift already on order" |
| P2 limit by channel buyer id | No limit; stores `external_user_id` | ADOPT key, feature later |
| P3 priority + no-combine | All matching actions run | SIMPLIFY: all apply + one "exclusive" flag |
| P4 budget auto-pause | None; gift stock check | DROP: stock is the cap |
| P5 date + per unit | Placed date only; 1:1 proportional | SIMPLIFY: placed date, no retro; 1:1 |
| O1 gift line id | No gift id | ADOPT |
| O2 manual add by stage | Add at packing; corrections after invoice | SIMPLIFY: until parcel closed |
| O3 multipack hold | Fixed at offer import | SIMPLIFY: fix once on offer mapping |
| O4 read-only + duplicate | "Zapisz jako nowy" | ADOPT |
| D1 0,01 zł gift | Full price + Rabat line per VAT, or hide | SIMPLIFY: omit / discount-line |
| D2 split uneven line | Correction on first unit | ADOPT |
| D3 grosz to largest line | Balancing on one product | ADOPT |
| D4 hold until spread | Per-connection setting, no hold | SIMPLIFY: auto-spread |
| D5 EUR foreign VAT hold | VAT-by-country automation, no receipt for OSS | ADOPT hold for v1 |
| D6 returns | Per line, operator decides, editable amount | SIMPLIFY: drop auto claw-back |
| C1 PrestaShop composition | No evidence | SIMPLIFY: import once |
| C2 small-gift register | No evidence | DROP: export instead |
| C3 hold documents with gift | None | DROP |

## Three strongest findings

1. **Gift on documents is solved without 0,01 zł.** Sellasist's documented pattern is the gift at price plus an automatic "Rabat" line per VAT rate, or hiding the gift. It is simpler than borrowing a grosz and keeps totals exact (https://sellasist.pl/pomoc/dodaj-produkt-efekt-automatyzacji-dla-zamowien/).
2. **No priority, no budget, no per-customer limit, and nobody asks for them in public.** All matching automations run; the only brake is the gift's stock. P3/P4/P2 are inventions beyond the Polish market baseline and can be cut to one "exclusive" flag and a stock cap.
3. **Rules must not apply backwards.** Sellasist warns that a backdated date condition "zastosuje do nich wybrany efekt akcji, co może być problematyczne dla zamówień już zrealizowanych" (https://sellasist.pl/pomoc/data-zlozenia-warunek-akcji-automatycznej-dla-zamowien/). OL should only apply a rule to orders arriving after activation.
