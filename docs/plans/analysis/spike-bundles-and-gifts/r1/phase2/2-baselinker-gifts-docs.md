# Phase 2 / BaseLinker (base.com) part 2: gifts, automatic actions, order editing, sales documents

Researcher: product-research subagent, 2026-11-04. Read-only desk research, public sources only.
Anything not confirmed by a quoted source is marked **(unverified)**.

## Sources consulted
- [S1] Help PL "Pozostałe wybrane akcje - przykłady automatycznych akcji" - https://base.com/pl-PL/pomoc/wiedza/pozostale-wybrane-akcje-przyklady-automatycznych-akcji/ (EN: https://base.com/en-EN/help/knowledgebase/other-selected-actions-examples-of-automatic-actions/) - THE gift recipe.
- [S2] Help FAQ PL "Karta zamówienia" - https://base.com/pl-PL/pomoc/faq/manager-zamowien/zamowienia/karta-zamowienia/ - gratis FAQ, rabat as negative line, "Zmień ceny produktów".
- [S3] Blog "Jak przyspieszyć swoją pracę? Praktyczne przykłady automatycznych akcji" (23.11.2023, upd. 27.11.2025) - https://base.com/pl-PL/blog/?p=19326
- [S4] Blog "Spis aktualizacji - lipiec 2023" (10.08.2023) - https://base.com/pl-PL/blog/?p=18909 - new conditions.
- [S5] Blog "Nowe funkcje: Powracający klient, odstępy w akcjach, VIES..." (21.09.2023) - https://base.com/pl-PL/blog/nowe-funkcje-powracajacy-klient-odstepy-w-akcjach-vies-i-nowe-automatyczne-akcje/
- [S6] Help FAQ PL "Automatyczne akcje" - https://base.com/pl-PL/pomoc/faq/automatyczne-akcje/
- [S7] Help EN "Automation / automatic actions" - https://base.com/en-EN/help/knowledgebase/automatic-actions/ ; "Order of executing automatic actions" - https://base.com/en-EN/help/knowledgebase/order-of-executing-automatic-actions/
- [S8] Help PL "Typy akcji automatycznych" - https://base.com/pl-PL/pomoc/wiedza/typy-akcji-automatycznych/
- [S9] API addOrderProduct - https://api.baselinker.com/index.php?method=addOrderProduct
- [S10] API getOrders - https://api.baselinker.com/index.php?method=getOrders (products[] incl. bundle_id; discounts[] log)
- [S11] API getNewReceipts - https://api.baselinker.com/index.php?method=getNewReceipts
- [S12] Help "Paragony - drukarka fiskalna" PL/EN - https://base.com/pl-PL/pomoc/wiedza/paragony-drukarka-fiskalna/ , https://base.com/en-EN/help/knowledgebase/receipts-fiscal-printer/
- [S13] Blog "BaseLinker Printer" (20.03.2023, upd. 19.08.2025) - https://base.com/pl-PL/blog/baselinker-printer-drukowanie-paragonow/
- [S14] Blog "Rozbudowa funkcji paragonów" (2017, upd. 2025) - https://base.com/pl-PL/blog/rozbudowa-funkcji-paragonow/
- [S15] Help PL "Faktury" (series settings) - https://base.com/pl-PL/pomoc/wiedza/faktury/ ; EN "Sales documents" - https://base.com/en-EN/help/knowledgebase/sales-documents-invoices-receipts/
- [S16] FAQ eparagony.pl - https://base.com/pl-PL/pomoc/faq/dokumenty-sprzedazy/eparagony-pl/ ; blog integracja eparagony (17.10.2023) - https://base.com/pl-PL/blog/integracja-z-eparagony-pl-zapomnij-o-papierowych-paragonach/
- [S17] FAQ KSeF - https://base.com/pl-PL/pomoc/faq/dokumenty-sprzedazy/ksef/ ; https://base.com/pl-PL/integracje/ksef/
- [S18] Help EN "Bundles" - https://base.com/en-EN/help/knowledgebase/bundles/
- [S19] Help PL "Asystent pakowania" - https://base.com/pl-PL/pomoc/wiedza/asystent-pakowania/
- [S20] FAQ PL "Zwroty" - https://base.com/pl-PL/pomoc/faq/manager-zamowien/zwroty/ ; "Zwroty - przykłady automatycznych akcji" - https://base.com/pl-PL/pomoc/wiedza/zwroty-przyklady-automatycznych-akcji/
- [S21] "Spis aktualizacji - lipiec 2026" (24.08.2026) - https://base.com/pl-PL/blog/spis-aktualizacji-lipiec-2026/ ; EN https://base.com/en-EN/blog/base-changelog-july-2026/ - IdoSell gifts -> 0.01 zł, Kaufland discount handling options.
- [S22] Changelog May 2024 - https://base.com/en-EN/blog/baselinker-changelog-may-2024/ - gift flag in additional field (BL Connect), Etsy gift_sender, Shopify discounts per item.
- [S23] FAQ "Pobieranie zamówień ze sklepu" - https://base.com/pl-PL/pomoc/faq/sklep/pobieranie-zamowien-ze-sklepu/ - discount as line vs spread.
- [S24] Help EN "Order card" - https://base.com/en-EN/help/knowledgebase/order-card-how-to-use/
- [S25] SellPander integration page - https://base.com/en-US/integrations/sellpander/ (third-party "Gratisy" module)
- [S26] Blog "Promocje w Base" (29.09.2025) - https://base.com/pl-PL/blog/promocje-w-base/ - catalogue price promos only, no gifts.
- [S27] Help "Rezerwacje" - https://base.com/pl-PL/pomoc/wiedza/rezerwacje/
- Searches of Społeczność Allegro / forums for "BaseLinker gratis" complaints returned nothing gift-specific (thin signal).

## Key findings (narrative)

### 1. How a gift gets into an order
**There is no gift concept in BaseLinker. A gift is just another product line added to the order.** Three ways:

a) **Automatic action "Dodaj produkt do zamówienia (np. gratis)"** [S1] (EN: "Add the product to your order (e.g., free of charge)"). The documented recipe ("gratis do zamówień powyżej 500 zł"):
   - Event: "Pobrano zamówienie" (Order fetched) - any event can be chosen.
   - Condition (optional): order source.
   - Main condition: "Wartość zamówienia (tylko produkty)" >= 500 (variant with shipping: plain "Wartość zamówienia"). Condition added July 2023 [S4].
   - Action fields: katalog (inventory) holding the product; **magazyn, z którego zostanie zdjęty stan** (warehouse to decrement); product ID; **nazwa widoczna w zamówieniu** (free-text name shown on the order); **ilość i cena**. "Możesz też wpisać nazwę produktu, EAN, SKU lub lokalizację."
   - => Gift identity on the order = whatever name/price the operator typed into the action. No flag. Price can be 0 (implied by "np. gratis"/"free of charge"; exact 0 acceptance (unverified)).
   - FAQ [S2]: "Jak automatycznie dodawać do zamówienia jakiś produkt np. gratis?" -> "Możesz utworzyć akcję automatyczną, która doda produkt do zamówienia."

b) **Manual add on the order card**: "+Dodaj produkty do zamówienia" -> from catalogue (with tag filter since May 2024 [S22]) or "Add products manually" [S24]. Line editable: quantity (whole numbers only), price, currency.

c) **From the channel**: imported as-is. IdoSell gift-flagged products since July 2026: "automatyczne korygowanie zamówień z produktami oznaczonymi w IdoSell jako gratisy ... otrzymują one techniczną cenę 0,01 zł, a ich wartość jest odejmowana od pozostałych produktów w zamówieniu" [S21]. Flag itself is NOT preserved as a field (getOrders products[] has no gift field [S10]).

d) Third-party: SellPander "Gratisy" module "allows you to add a free giveaway to your Base.com order, depending on the order size" [S25] - no details public.

### 2. Conditions available for gift rules
- "Wartość zamówienia" / "Wartość zamówienia (tylko produkty)" [S4][S1]
- "Ilość sztuk konkretnego produktu (SKU)" [S4]
- Product present: EN "Product with name/ID/SKU/EAN/tag" (PL label (unverified))
- Order source / channel [S1]
- "Klient ma inne zamówienia" (returning customer, time window minutes..months) [S5]; identifies customer by phone first, then email / Allegro-Amazon login; **does not see archived orders** ("Aktualnie niestety nie.") [S6]
- Delay 1 min..60 days [S5]
- NOT found: "while stocks last" stock condition on the gift, per-customer gift counter, campaign date range (date-range via enabling/disabling an action group manually [S7]).
- Actions are not retroactive [S7]; all actions on the same event run even if an earlier one changes data [S7] -> no idempotency/once-per-order guarantee documented (re-fire on repeated status events (unverified)).

### 3. Reminding the packer (interface actions)
- Action "Wyświetl komunikat" (Display message) on event "Utworzono przesyłkę" with condition order value >= 500: text, size, background colour, sound, how it closes, optional event buttons [S1]. Blog: "Akcje interfejsowe pozwalają na automatyczne wyświetlanie komunikatów przypominających pracownikom o ważnych kwestiach, takich jak np. dodanie gratisu do zamówienia." [S3]
- Runs only when a Base user triggers the event on the order card or in the Packing Assistant [S1].
- This is the documented answer for G-04 (gift promised in listing, not on order): a pop-up reminder, not a tracked line.

### 4. Pack bench (Asystent pakowania)
- Gift line is a normal line -> must be picked/scanned (scan by EAN or SKU only [S19]).
- Setting "Produkty domyślnie zebrane/spakowane": "możliwość ustalenia nazw produktów z zamówienia które automatycznie oznaczane będą jako spakowane ... Przydatne np. w przypadku obsługi zamówień posiadających stałą pozycję jak rabat." Matching by **product name** [S19]. Usable to auto-skip a non-physical "Rabat" line or (unverified) a gift you do not want scanned.
- Bundles in assistant: not on this page (other agent).

### 5. Discounts / price edits on the order (X-01)
- FAQ "Jak dodać rabat do zamówienia?" [S2]: Option 1 "Kliknij 'Dodaj produkt do zamówienia' i stwórz pozycję o nazwie np. 'Rabat' i cenie na minusie." Option 2 "Operacje na produktach" -> "Zmień ceny produktów" (bulk change prices/VAT/weight of all lines [S24]).
- Shop orders: discount "ujęty jako odrębna pozycja zamówienia" or "rozłożony równo na wszystkie produkty" [S23].
- Shopify: setting "downloading discounts from separate order items" [S22].
- Kaufland (Jul 2026): seller chooses to ignore discounts, show as separate lines, fold into products, or lower product price [S21].
- MerchantPro wallet -> separate discount line [S21].
- API getOrders `include_discounts_data`: `discounts[]` = **log** with `type` (order|item|shipment), `order_product_id`, `discount_amount`, `discount_percent`, `value_before`, `value_after`, `details` (e.g. coupon code), `profile_id` (who; -1 API), `order_lines_details` per-line breakdown [S10]. `price_brutto` described only as "Single item gross price" (after-discount reading (unverified)).

### 6. Receipts (paragony), fiscal printer, e-paragony
- Module "Paragony - drukarka fiskalna" (Integracje -> Dodaj integrację -> Pozostałe). Needs external program; free Base Printer supports Posnet (new protocol), Novitus, Elzab [S12][S13]. "Fiskalizacja nastąpi w momencie utworzenia paragonu w systemie." [S13]
- Receipt creation: from order card button, bulk from order list, or automatic action [S12]. Status icon: wydrukowany / oczekuje / błąd wydruku.
- Receipt line model (API getNewReceipts) [S11]: per product only `name`, `price_brutto`, `tax_rate` (special -1 ZW, -0.02 NP, -0.03 OO), `quantity`, `sku`, `ean`. **No discount field on a receipt line.** So: a gift added at 0 -> a 0.00 line sent to the printer; a "Rabat" negative line -> a negative line sent to the printer.
- No Base doc says how 0.00 or negative lines are handled by printers. Printer protocols refuse a discount that makes a line negative (Novitus err #20, from Novitus protocol doc) - Base's own FAQ only says printer problems are the external integrator's responsibility: "Za integrację 'Paragony - drukarka fiskalna' odpowiadają zewnętrzne firmy." Base's own move to "techniczna cena 0,01 zł" for IdoSell gifts [S21] strongly suggests 0-price lines cause document problems (inference, unverified).
- e-paragony via eparagony.pl (online fiscal printer required, up to 30k/day/printer, no buyer data on receipt, invoice-to-receipt only if receipt carries NIP) [S16]; Allegro e-receipt passing added Jul 2026 [S21]; Novitus e-receipts BETA May 2024 [S22].
- Receipt settings live in numbering series of type "paragon fiskalny" [S14][S15].

### 7. Invoices / KSeF
- Numbering series settings (Zamówienia -> Faktury -> Ustawienia -> Edytuj) [S15]: Stawka VAT = fixed (zw., 0%, 3%, 5%...) / as in order / OSS buyer-country; in automatic action "Zgodnie z serią numeracji" or "Użyj stawki przypisanej do produktu zamówienia" (action wins).
- Shipping line: on/off; VAT fixed / **proporcjonalna do VAT produktów** -> one shipping line per VAT rate present, prefixed with the rate / OSS [S15]. (Relevant pattern for splitting a mixed-VAT amount.)
- Item name can append ID/EAN/SKU/attributes [S15].
- Nothing documented about 0-price lines, discounts or bundles on invoices.
- Corrections: template not customisable, correction-of-correction from invoice list only [S15][S22].
- KSeF 2.0 send included in subscription; corrections sent too; authorised invoices not resent; no receipt of purchase invoices; B2C can be excluded per series [S17]. 0-value line acceptance by KSeF (unverified).

### 8. Bundles on documents (B-14)
- Setting "Zamówienia -> Ustawienia -> Obsługa zamówień": bundle split off -> "one item with a given bundle will appear in the order"; split on -> "all components of the bundle will appear in the order instead of the purchased offer"; when bundle price differs from sum of components "this difference will be displayed as a discount" [S18].
- So the document mirrors the order: one line (bundle VAT) or component lines + a discount. How that "discount" is printed on a fiscal receipt (which has no discount field [S11]) is undocumented (unverified). getOrders `bundle_id` marks component lines split from a Base-inventory bundle [S10].

### 9. Returns & corrections (B-15, G-11)
- Returns module (Zamówienia -> Zwroty, Asystent zwrotów). FAQ [S20]: corrections + partial refunds supported; "zmieniając cenę produktu w zwrocie, można zmienić zwracaną kwotę"; products on return card editable; stock up after "Zrealizuj"; Allegro returns accepted/rejected only as a whole; one return per order; returns imported only from Allegro.
- Automatic actions: "Wystaw korektę" (corrects returned lines), "Zwrot płatności Allegro (dla pozycji zwrotu)", "Zwrot prowizji Allegro (dla pozycji zwrotu)" [S20].
- No bundle-aware or gift-aware refund logic (lost bundle discount / threshold gift) - operator edits the price on the return card manually.

### 10. Gift wrapping (G-14)
- Order card product attributes may show "packing for a gift" [S24]; BL Connect passes additional fields, example "whether the order is a gift in Additional Field 1 to use special gift wrapping"; Etsy gift_sender -> additional field [S22]. Allegro GIFT_WRAP / Amazon IsGift mapping (unverified).

## Per-use-case table

| ID | Coverage | How it works for the operator | Limits / edge cases | Source |
|---|---|---|---|---|
| G-01 flagged by channel | Partial | IdoSell gift-flagged lines auto-corrected to "techniczna cena 0,01 zł", value subtracted from other lines | Flag not kept (no gift field in API products[]); other channels (Woo plugin meta) not documented | S21, S10 |
| G-02 unflagged 0/0.01/100% discount | Partial | Imported as-is; per-channel discount options (separate line / spread / fold / lower price; Kaufland 4 options; Shopify per-item); discount log in API | No recognition of "this is a gift"; depends on each integration | S21, S22, S23, S10 |
| G-03 folded into paid qty | Unknown | Not documented | Allegro multipack 0.01 behaviour (unverified) | - |
| G-04 promised in listing only | Partial | Automatic action adds a product (cond: source / product SKU / order value) OR "Wyświetl komunikat" reminder at "Utworzono przesyłkę" | Reminder is a pop-up, not a tracked line; condition on Allegro offer ID (unverified) | S1, S3 |
| G-05 operator adds gift | Full | Order card "+Dodaj produkty do zamówienia" (catalogue w/ tag filter, or manual), set qty + price (0) | No gift marker; manual lines may not decrement stock (unverified); edits not pushed back to shop ("zmiany ... osobno w sklepie") | S2, S24, S22 |
| G-06 rule adds gift | Partial | "Dodaj produkt do zamówienia (np. gratis)": catalogue, warehouse to decrement, product ID, display name, qty, price; conds "Wartość zamówienia (tylko produkty)", "Ilość sztuk konkretnego produktu (SKU)", product name/SKU/EAN/tag, source, "Klient ma inne zamówienia", delay | No "while stocks last", no per-customer counter (returning-customer cond ignores archive), no campaign dates (toggle group by hand), not retroactive, no once-per-order guarantee | S1, S4, S5, S6, S7 |
| G-07 gift as bundle component | Unknown | Bundles can have own price; split shows price diff as discount | 0-value component behaviour undocumented | S18 |
| G-08 gift stock / runs out | Partial | Action decrements chosen warehouse; reservations optional per catalogue | No out-of-stock fallback documented (stop/swap/skip); likely adds anyway (unverified) | S1, S27 |
| G-09 bench + slip, scanned | Partial | Gift is a normal line -> picked/scanned (EAN/SKU); "Produkty domyślnie zebrane/spakowane" auto-marks lines by NAME; interface pop-up reminder | No gift badge; name-based skip is fragile | S19, S1 |
| G-10 receipt/invoice | Partial (weak) | Line goes to receipt as price_brutto/tax_rate/qty, no discount field; invoices per series VAT settings | 0.00 / negative "Rabat" lines on fiscal printer undocumented; Base itself uses 0,01 zł for IdoSell gifts | S11, S15, S21, S2 |
| G-11 gift & returns | Partial | Return card: edit lines/prices to change refund; "Wystaw korektę" action | No threshold-gift logic; whole-return accept/reject for Allegro; 1 return/order | S20 |
| G-12 gift reporting | None (unverified) | No gift report found; only generic product stats | No 100 zł/customer/year register | - |
| G-13 buyer chooses gift | None (unverified) | Not native; SellPander "Zestawy dynamiczne" lets buyer/employee pick variant after purchase (bundles, not gifts) | - | S25 |
| G-14 gift wrap / is-gift | Partial | Additional fields (BL Connect example, Etsy gift_sender), product attr "packing for a gift"; drive automations | Allegro GIFT_WRAP / Amazon IsGift mapping (unverified) | S22, S24 |
| B-14 bundle on documents | Partial | Document follows order: unsplit = 1 bundle line; split = components + price difference "as a discount"; invoice VAT per product rate; shipping VAT proportional (one line per rate) | How the bundle discount prints on a receipt (no discount field) undocumented | S18, S15, S11 |
| B-15 return one component | Partial | Return card editable lines + price -> refund amount; "Wystaw korektę" for returned lines; stock up on "Zrealizuj" | No automatic lost-bundle-discount calc; Allegro whole-return only | S20 |
| X-01 neutral discount | Partial | API discount log (type order/item/shipment, value_before/after, per-line breakdown, who applied); per-integration choice: separate line vs spread vs fold | Order line itself still one price; FAQ recommends negative "Rabat" line for manual discount | S10, S21, S23, S2 |

## UX patterns worth copying
1. Gift-by-rule = generic "add product to order" action with explicit fields (katalog, magazyn to decrement, product, display name, qty, price) - one mental model for gifts, inserts, leaflets.
2. Interface action "Wyświetl komunikat" at shipment-creation / in packing assistant, conditioned on order value: cheap packer reminder (colour, sound, must-acknowledge).
3. "Produkty domyślnie zebrane/spakowane": per-name list of lines auto-marked packed (non-physical lines). Copy the idea, but key it on a line FLAG not the name.
4. Per-channel discount ingestion choice (ignore / separate line / spread / fold into price) + an audit log of discounts (value_before/after, who, coupon).
5. Shipping VAT "proporcjonalna do VAT produktów" = one line per VAT rate - the same split technique needed for bundles/gift rebates across rates.
6. Defensive 0,01 zł "technical price" for imported gifts, with value removed from other lines - evidence that zero lines hurt downstream documents.

## Anti-patterns / complaints
1. No gift flag anywhere: a gift is "a product at 0 zł with a name someone typed"; reports, returns, documents cannot tell it apart (IdoSell flag converted to price 0.01 and lost).
2. Manual discount = negative-price line "Rabat" (official FAQ) - fiscal printers reject negative lines / discounts driving a line below zero; receipt API has no discount field.
3. Packer skip list matches by product NAME (fragile, renames break it).
4. Rule engine has no stock-aware gift fallback, no per-customer limit (returning-customer check ignores archive), no campaign window, no once-per-order guarantee; all matching actions on an event fire.
5. Returns: Allegro return accepted/rejected only as a whole, one return per order, refund amount = manual price edit on return card; no bundle/threshold awareness. Fiscal-printer problems are pushed to "zewnętrzne firmy".

## New use cases not in the catalogue
- N-1 Packer reminder pop-up (must acknowledge) driven by a rule, as an alternative to adding a tracked line (S1, S3).
- N-2 Non-physical order lines auto-marked packed (discount line, gift card, digital) (S19).
- N-3 Per-channel setting for how imported discounts are represented (ignore / separate line / spread / fold) (S21, S23).
- N-4 Discount audit trail on order: who applied which discount, coupon code, value before/after, per-line breakdown (S10).
- N-5 Wallet/store-credit payment represented as a discount line (MerchantPro) (S21).
- N-6 Gift/is-gift status propagated to a downstream fulfiller (BL Connect wholesaler gift wrapping via additional field) (S22).
- N-7 Bundle/split mode setting also applies to manually created orders (S18).
