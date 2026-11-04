# UX compare: synthesis of 5 reports

Reports: 1-promotions, 2-bundles, 3-operations, 4-docs-settings-analytics, 5-simplicity-audit.

## Diagnosis
- Competitors handle bundles + gifts in 2 places (a product of type "Zestaw" and an automatic rule "Dodaj produkt") with about 2 new concepts. The prototype has 10 screens and about 15 concepts (master, OMS, adapter, routing, versions, frozen composition, ATP, stock path, who pays, gift form, declaration).
- The prototype is a good map of cases for backend and tests, but a poor template for the product UI: guide, state catalogue and the "Paragon i faktura" lab are team tools.

## Cut list for v1 (ranked by effect)
1. Bundle editor: 5-step wizard -> one form (product, components + qty, gift toggle in row menu, one line "Dostępne: 12 szt., ogranicza Kubek"). Remove price-split step (compute at return time), availability step, channel/GPSR step (link "Wystaw ofertę" after save), version panel (history tab only).
2. Promotion composer: 3 start cards (gratis do produktu / od kwoty / do każdej sztuki), 4 visible fields, rest under "Więcej opcji". Product picker instead of SKU text. No out-of-stock choice: promo pauses itself, order goes with a note. Channel matrix -> one marker per channel. "Pomiń, jeśli produkt już jest w zamówieniu" ON by default.
3. Order detail: show a gift once, in the line. Remove the gift section; source and funding in the gift badge tooltip. Stock path only on error or OMS off. No "część zestawu" captions (indent says it). Hide technical keys and version unless the order has an old version. Pricing panel: 4 rows + "Koszt gratisów", rest under "Pokaż szczegóły".
4. Orders list: 1 status badge + max 1 reason; bundle/gift as icons by the product name; drop the duplicate attention box.
5. Settings: two lines "Gratis: pomijany" and "Zestaw: jedna pozycja" + small preview. Gift form alternatives under "Zmień (dla księgowej)", grosz automatic. Remove provider matrix. "Jak kanał wysyła zestawy" only when unknown (Shoper). Gift in another VAT rate automatically priced-in instead of a hold.
6. Documents: no separate menu screen; preview lives in the order and next to settings.
7. Analytics: one report (table of promotions + "kosztowało Cię X" + CSV), channel and movements as filter/column; margin share, cost per order and bundle analytics later (#3588).
8. Returns: one amount field + one line "Według wzoru Allegro: 25,00 zł. Użyj".
9. Jargon: master -> system name ("w PrestaShop"), routing -> "przydzielenie do pakowania", OMS and adapter gone from UI.
10. Bundle list: rows show name, SKU, available, price; one "Dostępność nieznana" state with a one-sentence reason instead of 4 alerts.

## Keep (better than competitors)
- OL-only gift still leaves the warehouse (Allegro, Erli).
- "Klient płaci 0,00 zł / Kosztuje Cię X", shown once.
- Multipack hold + "Utwórz zestaw 3 x Kawa".
- Document total always equals what was paid.
- Promotion test on a sample order; visible self-pause with reason; Copy / Extend.
- Packing bench (only drop "część zestawu" captions).
- ATP = min of components with the limiting one named; no nesting; invisible frozen composition; "Synchronizuj skład z PrestaShop".

Effect: about 5 screens instead of 10, about 6 concepts instead of 15.
