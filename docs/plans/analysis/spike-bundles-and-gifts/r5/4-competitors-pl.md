# R5 red team 4: BaseLinker, Apilo, Sellasist

Date: 2026-11-04. Read-only. Scope: claims C-039..C-042, C-047, C-048 and every matrix cell in
`app-src/src/data.ts` where `r1` and `r2` disagree for BaseLinker (index 0), Apilo (1), Sellasist (2).

Method: re-fetched the deciding primary source for each cell. Source kinds:
- BaseLinker: official help (base.com/pl-PL/pomoc), official changelog "Spis aktualizacji" (vendor blog), official API docs (api.baselinker.com, developers.baselinker.com).
- Apilo: official help (apilo.com/pl/help), official feature page, official REST API spec 2.0.0.13 (OpenAPI embedded in developer.apilo.cloud, downloaded with curl and parsed).
- Sellasist: official help, fetched fresh today through the same WordPress endpoints r1 used (`wp-json/wp/v2/help` + `admin-ajax.php?action=get_page_sections`), so article bodies and their `modified` dates are current as of today.

Note: the web fetch tool limits verbatim quotes to ~125 characters; longer passages are quoted in segments.

## 1. Disputed cells

Legend: F Full, P Partial, N None, U Unknown. "r1"/"r2" = the arrays in data.ts.

| Case | Competitor | r1 | r2 | Correct | Deciding evidence (verbatim) |
|---|---|---|---|---|---|
| B-05 parent + children | BaseLinker | U | N | **U** | The custom-shop protocol line has no parent field (developers.baselinker.com OrdersGet lists only `id, variant_id, name, quantity, price, weight, tax, ean, sku, location, attributes`), BUT the native Shoper and WooCommerce integrations now import channel sets: "Dodano obsługę zestawów produktów w Shoper, umożliwiając użytkownikom import zestawu jako zestaw w Base" (https://base.com/pl-PL/blog/spis-aktualizacji-lipiec-2025/) and "zestawy mogą być importowane do Base jako zestawy ... Dzięki temu sprzedawcy mogą sprawniej obsługiwać zamówienia zawierające produkty w zestawach" (https://base.com/pl-PL/blog/spis-aktualizacji-marzec-2026/). Whether an order with parent + child rows is de-duplicated is not documented. r2's N rests on the generic shop protocol, which Shoper/Woo do not use. N is a guess. |
| B-05 | Apilo | U | N | **U** (N only as inference) | Order item DTO has `type` "(`1-Product`, `2-Shipment`, `3-service`)" and an integer `productSet`; no channel parent/child field (developer.apilo.cloud/api/2.0.0.13, schema RestOrderItemsDTO). Nothing in help on channels sending children. Absence of a field does not prove double counting. |
| B-05 | Sellasist | U | N | **U** | No set/parent field on cart lines (api.yaml `carts_response`); Woo (modified 2025-11-07) and Shoper (2026-05-05) integration articles have no word "zestaw". Same reasoning as Apilo. |
| B-16 bundle cost | BaseLinker | U | P | **P (weak)** | "The tag for average purchase price now also works for bundles – [bundle_average_purchase_price]" (http://base.com/en-EN/blog/base-changelog-march-2025/). The help "Cena zakupu" page does not mention bundles at all (https://base.com/pl-PL/pomoc/wiedza/cena-zakupu/), so "sum of components" and use in margin reports stay unverified. |
| B-18 import definitions | BaseLinker | F | P | **P (strong)** | r2 under-counted. Confirmed imports: Shoper (lipiec 2025, quote above), WooCommerce (marzec 2026, quote above), Upgates/Unas `include_bundles`, VTEX "flagę is_bundle oraz szczegółową listę jego elementów (bundle_elements)" (czerwiec 2026), HostGator (lipiec/sierpień 2026), Nexo and Subiekt GT: "gdy wyłączona jest opcja „traktuj jako zestawy", tak jak ma to już miejsce w integracji z SGT" (https://base.com/pl-PL/blog/spis-aktualizacji-czerwiec-2026/). Not found: PrestaShop packs, IdoSell sets, Erli product sets - three of the four sources the case names. So Partial, not Full. |
| G-07 gift as component | BaseLinker | U | P | **P** | "Zestaw może mieć oddzielną cenę, inną niż suma produktów wchodzących w jego skład" and on split "ta różnica będzie wyświetlana jako rabat" (https://base.com/pl-PL/pomoc/wiedza/zestawy/). Any product can be a component; no gift example, no zero-value component documented. |
| G-11 gift and returns | BaseLinker | P | N | **N** | Only generic tools: "zmieniając cenę produktu w zwrocie, można zmienić zwracaną kwotę" and "zwrot może zostać zaakceptowany lub odrzucony tylko w całości" (https://base.com/pl-PL/pomoc/faq/manager-zamowien/zwroty/). No threshold or gift logic. A manual price edit is not coverage of the case. |
| G-01 channel flag | Apilo | U | N | **N** | Item type enum only Product/Shipment/service (API spec above). IdoSell connection page has no mention of gratis, 0.01 or position import (https://apilo.com/pl/help/polaczenie-z-idosell/). |
| G-05 operator adds gift | Apilo | P | F | **F (probable)** | Order detail actions include "spakować zamówienie oraz je edytować" (https://apilo.com/pl/help/manager-zamowien-3-0-organizacja-pracy/); action "Dodaj produkt do zamówienia" exists and "Zdarzenia własne" = "Automatyzacja pod jednym przyciskiem" (https://apilo.com/pl/funkcje-apilo/zadania-automatyczne/). No page says verbatim "add a position in edit", so not certain. Caveat: the REST API has no order-item endpoint (paths: orders, documents, media, note, payment, shipment, status, tag) and `originalPriceWithTax` has `"minimum":0.01`, so a 0 zł gift cannot be written via API. |
| G-08 gift runs out | Apilo | N | P | **N** | Feature page lists condition "Stan magazynowy produktu" and actions "Dodaj produkt do zamówienia", "Wyślij e-mail" (https://apilo.com/pl/funkcje-apilo/zadania-automatyczne/), but the help page does not say which product the condition checks or what the add action does when out of stock: it only says "Dodaj warunki, które sprecyzują, kiedy akcja ma zostać wykonana" (https://apilo.com/pl/help/zadania-automatyczne/). r2 rated P on "(unverified semantics)" - an unverified mechanism cannot carry P. BaseLinker has equal DIY blocks and was rated N, so P here was also inconsistent. |
| G-10 receipt/invoice | Apilo | U | P | **P (generic)** | Invoice config covers VAT override and "Dodaj cenę proporcjonalnie" (shipping folded into items); zero-price and gift lines are not mentioned at all (https://apilo.com/pl/help/konfiguracja-modulu-fakturowania-paragonow/). A gift line prints as an ordinary line with its price and VAT; no rebate or reason. |
| G-11 | Apilo | U | N | **N** | Returns module is shipping-only ("Apilo Zwroty"); no gift handling anywhere (r2 S7, plus the Manager 3.0 page lists only "zwrot płatności i prowizji (dla zamówień z Allegro)"). |
| G-12 gift reporting | Apilo | U | N | **N** | No gift type exists (item types 1/2/3), so no report can separate gifts. |
| B-15 return one component | Sellasist | P | N | **P** | Returns card: "przyjąć lub odrzucić częściowo", "zmienić ilość produktów", and "wszystkie zaakceptowane przez Ciebie produkty zostaną automatycznie przywrócone na stan magazynowy" (https://sellasist.pl/pomoc/jak-dodac-zwrot-zamowienia/, modified 2026-03-03). After the set split (default "Automatycznie rozbijaj zestaw na produkty") a component is its own line. Same basis BaseLinker and Apilo got P for. Lost bundle discount: not handled. |
| G-01 | Sellasist | U | N | **N** | IdoSell integration article (modified 2026-10-12) handles only a coupon code: "Kod rabatowy: Wybierz pole dodatkowe w Sellasist, w którym ma zostać zapisany kod rabatowy" (https://sellasist.pl/pomoc/instrukcja-konfiguracji-nowego-modulu-integracji-sellasist-i-idosell/). No gift flag read. |
| G-06 rule adds gift | Sellasist | P | F | **P** | Threshold and dates are documented: "Wartość zamówienia ⇒ Większa lub równa 1000 PLN" (https://sellasist.pl/pomoc/dodaj-produkt-efekt-automatyzacji-dla-zamowien/), "DATA ZŁOŻENIA ... promocję „XYZ", która ma obowiązywać dla wszystkich zamówień złożonych między 1-10 czerwca" (akcje-dla-zamowien list article). Once-per-order guarantee is not stated anywhere, and Apilo has the same condition set and is rated P. F is inconsistent. |
| G-07 | Sellasist | U | P | **P** | "Jeżeli chcesz zmienić cenę produktu w zestawie, zmień ją w kolumnie Cena produktu w zestawie" (https://sellasist.pl/pomoc/zestawy-produktow-w-panelu-sellasist/). Gift-as-component possible, not documented, no 0 zł guarantee. |
| G-08 | Sellasist | N | P | **P** | The gift effect checks stock by default: "Opcja Ignoruj stan magazynowy dodawanego produktu pozwala dodać produkt do zamówienia bez względu na jego aktualny stan magazynowy ... (gdy brak towaru na magazynie nie powinien blokować akcji automatycznych)" (https://sellasist.pl/pomoc/dodaj-produkt-efekt-automatyzacji-dla-zamowien/, modified 2026-02-11). So the default is "block". Failed actions are visible and retryable: "W Dzienniku zdarzeń znajdziesz wszystkie wykonane akcje", "możliwość ponownego wykonania akcji, gdy automatyczna próba zakończy się niepowodzeniem" (https://sellasist.pl/pomoc/stan-magazynowy-warunek-automatyzacji-dla-asortymentu/). No substitute, no buyer notice. |
| G-10 | Sellasist | F | P | **P** | "zaznacz checkbox Dodaj pozycję rabatującą"; "W przypadku dodania kilku produktów, całkowity rabat zostanie zsumowany w jednej pozycji"; "Jeśli dodawane produkty mają różne stawki VAT, system utworzy osobne pozycje rabatujące dla każdej stawki" (same article). A separate negative line per VAT rate, not a rebate on the gift line; no typed reason; no zero-bucket check. Case definition requires those for F. |
| G-11 | Sellasist | U | N | **N** | Returns articles (nowy-modul-zwrotow-zamowien, jak-dodac-zwrot-zamowienia, utworz-zwrot..., Allegro returns) contain no "gratis". Generic per-line returns only. |
| G-12 | Sellasist | P | N | **N** | Only an automation hook: "Symbol i EAN: Pola powiązane z automatyzacją ... np. tworząc kolejną akcję automatyczną: Jeśli pole Symbol produktu zawiera dany ciąg znaków, wyślij e-mail" (dodaj-produkt article). A hook is not a report. |

Data error found: data.ts row G-08 `r1: ['N','N','N',...]` does not match the run-1 reports, which rated BaseLinker, Apilo and Sellasist **Partial** (r1/phase2/2-baselinker-gifts-docs.md line 122, 3-apilo.md line 126, 4-sellasist.md line 165). So the note "W obu rundach nikt nie zamienia gratisu ani nie powiadamia kupującego" also misreports run 1.

Consistency rule applied: the same documented mechanism gets the same rating across the three (generic per-line returns = P for B-15; unverified DIY rule blocks = N for G-08; generic order edit = F for G-05).

## 2. Claim verdicts

**C-039 BaseLinker: min stock, per warehouse then summed, one global split switch, no nesting, no pre-built kits - PROBABLE, two parts overstated.**
- Min stock: confirmed. "Stan magazynowy zestawu jest równy najniższemu stanowi produktu wchodzącego w skład zestawu." (https://base.com/pl-PL/pomoc/wiedza/zestawy/)
- Per warehouse then summed: the FAQ says "w pierwszej kolejności obliczamy stan zestawu osobno dla każdego magazynu" / "a następnie to sumujemy" (https://base.com/pl-PL/pomoc/faq/magazyn-bl/), but the changelog calls summing a new OPTION: "Added a new option to synchronize stock levels for bundles – enabling the sum of stock from all warehouses" (http://base.com/en-EN/blog/base-changelog-march-2025/). Conflict; the changelog is newer and more specific, so "summed" should read "optionally summed".
- One global split switch: the switch is global ("Ustawienie dotyczy także zamówień wprowadzonych ręcznie", help Zestawy), but run 1 cites a deferred action "Rozbij zestawy" (2022, from a third-party blog, not reopened) and the June 2024 changelog has "[Marketplace] Splitting set of products in order" (http://base.com/en-EN/blog/baselinker-changelog-june-2024/), plus the June 2026 event "Zestaw został rozbity". "Only one switch" is not proven; say "one global switch, possibly plus a per-order action (unverified)".
- No nesting: confirmed, API: "relationships between two bundles are not allowed." (https://api.baselinker.com/index.php?method=addInventoryProduct)
- No pre-built kits: probable (absence in help; no kitting document found).
- Missed: getOrders `bundle_id` "Only applies to bundles from Base inventory." (https://api.baselinker.com/index.php?method=getOrders) - channel-defined sets never reach order lines as structure.

**C-040 BaseLinker gift only by price 0; IdoSell gift -> 0.01 zł - CONFIRMED.** "Dodaliśmy automatyczne korygowanie zamówień z produktami oznaczonymi w IdoSell jako gratisy" with technical 0.01 zł and value subtracted from other products (https://base.com/pl-PL/blog/spis-aktualizacji-lipiec-2026/). getOrders has no gift or list-price field on products. Checked changelogs through September 2026 (published 19.10); October 2026 is not published yet.

**C-041 Apilo in-set price, proportional re-pricing, 15 min - CONFIRMED.** "proporcjonalnie przeliczona, by odpowiadała pozycji w zamówieniu", "stan magazynowy zestawu produktów jest przeliczany co 15 minut", "System Apilo automatycznie rozdzieli produkt zestawowy." (https://apilo.com/pl/help/zestaw-produktow-do-czego-sluzy-i-jak-utworzyc/)

**C-042 Sellasist "Dodaj pozycję rabatującą", hide-from-picking, dynamic sets - CONFIRMED with two corrections.**
- Not "list price": the gift goes at the product's main price or a special price: "Niezaznaczenie checkboxa spowoduje pobranie ceny głównej produktu".
- The Rabat line is one per VAT rate SUMMED over all gifts ("całkowity rabat zostanie zsumowany w jednej pozycji"), so it cannot be attributed to a gift.
- Hide flags are PRODUCT-level, not line-level: "W zakładce Informacje podstawowe, w sekcji Magazyn zaznaczam opcje: nie pokazuj w trybie zbierania" (https://sellasist.pl/pomoc/jak-dodac-opcje-ukrycia-produktu-w-trybie-zbierania-i-pakowania/). A product sold both normally and as a gift is hidden in both cases.
- Dynamic sets: "Klient nie wybrał jeszcze produktu z grupy produktów zestawu"; "Stan magazynowy produktów jest aktualizowany w systemie dopiero po dokonaniu wyboru przez klienta." (https://sellasist.pl/pomoc/zestawy-dynamiczne-2/, modified 2026-10-11)

**C-047 "No competitor has a gift out-of-stock swap/notify policy" - DISPUTED as worded.**
- Swap to a declared substitute: confirmed absent in all three.
- "Any policy": refuted for Sellasist, whose gift effect blocks by default when the gift is out of stock and offers an explicit override, with a failed-action log and manual retry (quotes in G-08 row).
- Notify: buildable (not native) in BaseLinker via events "Rezerwacja ponad stan magazynowy" and "Nie zrealizowano zamówienia (brak stanów magazynowych)" (https://base.com/pl-PL/pomoc/wiedza/akcje-automatycznie-zdarzenia-systemowe/) and condition "Ilość w zamówieniu a stan magazynu" with the example "można np. wysłać powiadomienie do magazyniera" (marzec 2026); in Apilo via "Stan magazynowy produktu" + "Wyślij e-mail" (semantics unverified).
- Safe wording: "No competitor lets a gift declare a substitute or tells the buyer; Sellasist stops the gift by default; others need hand-built rules."

**C-048 "No competitor offers a common, integration-declared standard for bundles and gifts" - PROBABLE, with one partial counterexample.**
- BaseLinker's June 2026 discount module is a common structure every integration fills: "Rabaty pochodzące z marketplace'ów (tam, gdzie platforma udostępnia dane)" (czerwiec 2026), getOrders `type` "order"/"item"/"shipment", `value_before`, `value_after`, `order_lines_details`. That is a neutral reduction model fed by integrations - but not declared (silent where absent), and not for gifts or bundles.
- Bundle semantics are per-integration flags with different names: `include_bundles` (Upgates, Unas), `is_bundle` + `bundle_elements` (VTEX), "traktuj jako zestawy" (Nexo, SGT). Ad hoc, not a standard.
- Sellasist has one named setting repeated in every integration ("Sposób naliczania rabatów") - common vocabulary, but operator-chosen, not integration-declared, and not about bundles or gifts.
- Apilo: none; sets resolve catalogue-side through "Relacje".
- So the claim holds for "bundles AND gifts, declared by the integration". Do not market it as "nobody normalises discounts" - BaseLinker now does, for discounts.

## 3. Counterarguments against the proposed design (from these three)

1. **Catalogue-side resolution is cheaper and is what all three do.** All three ignore channel bundle encodings and resolve a set via the offer->product link. Alternative for OL: v1 ships only `bundle (snapshot)` + SKU-based recognition + `fulfilmentLineId`, and defers `composition` on channel lines to adapters that actually send children (Woo, Shoper). Cost: double-count risk on those two until v2. Counter: OL already has Shoper reserving a set as 1 unit (data.ts gap), so composition for Shoper is needed early anyway.
2. **BaseLinker's discount log shows the three-state problem in the wild.** "tam, gdzie platforma udostępnia dane" means an absent entry is ambiguous. This supports our `listUnitPriceGross` "absent = unknown" rule; keep it.
3. **Sellasist's per-VAT summed Rabat line is the pragmatic fiscal answer.** It avoids zero-value lines and negative per-gift lines on fiscal printers. Alternative for OL: when `LineAdjustmentRenderingDeclarer` says "no line rebate", fall back to one summed rebate per VAT bucket instead of merging or dropping the gift. Cost: per-gift attribution lost on the document (keep it in OL data).
4. **Split timing as a lifecycle step (Sellasist).** Sellasist lets the operator split after the invoice so the document shows the set as one line; but stock moves only at split. OL's snapshot-at-ingestion avoids that stock gap; worth stating as a deliberate difference.
5. **Product-level gift flags are an anti-pattern to avoid.** Sellasist hides a product everywhere; OL's gift role must stay on the line.

## 4. Missed by runs 1 and 2

- BaseLinker imports Shoper (07/2025), WooCommerce (03/2026) and Subiekt GT ("traktuj jako zestawy") sets; r2 B-18 listed only Upgates/VTEX/Nexo and downgraded to P on an incomplete list (P is still right, for a different reason).
- BaseLinker getOrders `bundle_id`: "Only applies to bundles from Base inventory."
- BaseLinker bundle warehouse summing is an option (03/2025), not the default rule.
- Apilo REST API: no order-item add/edit endpoint, and `originalPriceWithTax` `minimum: 0.01` on write - a 0 zł gift cannot be written through the API.
- Sellasist failed-action log with manual retry ("Dziennik zdarzeń") - prior art for G-16.
- Sellasist freezes imported carts: "Do pobranych już zamówień nie dopuszczamy do aktualizacji pobranych już produktów" (Woo/Shoper/IdoSell articles) - a gift or bundle change in the shop after import is never reflected. Relevant to OL re-ingestion.
- Sellasist "DANE KLIENTA" condition matches by "adresu e-mail, numeru telefonu, numeru NIP lub przynależności klienta do określonych grup" - phone/NIP matching is a stronger per-customer guard than email-only (G-15 r2 says Sellasist N; worth re-checking whether an effect can add a customer to a group).
- data.ts G-08 r1 row is a transcription error (see section 1).
- BaseLinker October 2026 changelog is not published yet (September 2026 was published 19.10), so "including 2026 changelogs" is covered through September only.

## Sources
- https://base.com/pl-PL/pomoc/wiedza/zestawy/ (help)
- https://base.com/pl-PL/pomoc/faq/magazyn-bl/ (help FAQ)
- https://base.com/pl-PL/pomoc/wiedza/cena-zakupu/ (help)
- https://base.com/pl-PL/pomoc/faq/manager-zamowien/zwroty/ (help FAQ)
- https://base.com/pl-PL/pomoc/faq/manager-zamowien/zamowienia/karta-zamowienia/ (help FAQ)
- https://base.com/pl-PL/pomoc/wiedza/akcje-automatycznie-zdarzenia-systemowe/ (help)
- https://base.com/pl-PL/pomoc/wiedza/typy-akcji-automatycznych/ (help)
- https://base.com/pl-PL/blog/spis-aktualizacji-lipiec-2025/ , -marzec-2026/ , -czerwiec-2026/ , -lipiec-2026/ , -sierpien-2026/ , -wrzesien-2026/ (official changelog)
- http://base.com/en-EN/blog/base-changelog-march-2025/ , http://base.com/en-EN/blog/baselinker-changelog-june-2024/ (official changelog)
- https://api.baselinker.com/index.php?method=getOrders , https://api.baselinker.com/index.php?method=addInventoryProduct (API docs)
- https://developers.baselinker.com/shops_api/index.php?method=OrdersGet , ...?method=ProductsData (protocol docs)
- https://apilo.com/pl/help/zestaw-produktow-do-czego-sluzy-i-jak-utworzyc/ , https://apilo.com/pl/help/zadania-automatyczne/ , https://apilo.com/pl/help/manager-zamowien-3-0-organizacja-pracy/ , https://apilo.com/pl/help/polaczenie-z-idosell/ , https://apilo.com/pl/help/konfiguracja-modulu-fakturowania-paragonow/ (help)
- https://apilo.com/pl/funkcje-apilo/zadania-automatyczne/ (feature page)
- https://developer.apilo.cloud/api/2.0.0.13 , https://developer.apilo.cloud/api/2.0.0.13-changelog (API spec)
- https://sellasist.pl/pomoc/dodaj-produkt-efekt-automatyzacji-dla-zamowien/ , .../zestawy-dynamiczne-2/ , .../jak-dodac-opcje-ukrycia-produktu-w-trybie-zbierania-i-pakowania/ , .../zestawy-produktow-w-panelu-sellasist/ , .../jak-dodac-zwrot-zamowienia/ , .../nowy-modul-zwrotow-zamowien/ , .../czym-jest-automatyzacja-jak-dziala-automatyzacja/ , .../stan-magazynowy-warunek-automatyzacji-dla-asortymentu/ , .../instrukcja-konfiguracji-nowego-modulu-integracji-sellasist-i-idosell/ , .../jak-uruchomic-nowa-integracje-sellasist-z-woocommerce/ , .../instrukcja-konfiguracji-nowego-modulu-integracji-sellasist-i-shoper/ , .../akcje-dla-zamowien-lista-warunkow-i-efektow-omowienie-wraz-z-zastosowaniem/ (help, fetched 2026-11-04)
