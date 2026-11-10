# Research: Merchant voice on bundles ("zestawy") and free gifts ("gratisy")

Phase 1 (PROBLEM) - researcher 5 of 5. Date: 2026-11-04.
Scope: what real sellers, packers and their accountants struggle with. Product signal only; no
architecture, no build/no-build recommendation.

## Method and honest limits

- Web search + page fetches only. Reddit itself was not reachable through the search tool (no
  reddit.com thread came back for any query); Reddit-flavoured signal below comes from Shopify
  Community, Shopify App Store reviews (via apps.shopify.com and appnavigator.io mirrors),
  ShipStation community, Amazon Seller Central forums. Treat "reddit" coverage as **absent**.
- Polish signal comes mostly from Społeczność Allegro (spolecznosc.allegro.pl), BaseLinker/Base.com
  help + blog, Shoper help/app store, Polish tax/accounting portals (podatki.biz, infor, rp.pl,
  amavat.pl, bezprawnik.pl), Comarch help, one useme.com job post (Subiekt nexo).
- No IdoSell, Apilo, Sellasist or wykop.pl thread on this topic surfaced (searched; nothing
  relevant). Facebook groups were not indexed in any useful way.
- Several English sources are vendor-authored (app developers framing the problem to sell their
  app). Marked where it matters.
- Nothing here is legal/tax advice; forum quotes are opinions.

## Sources consulted (what was found)

Polish:
- https://spolecznosc.allegro.pl/t5/zaawansowani-sprzedawcy/kupuj%C4%85cy-nie-chce-odda%C4%87-gratis%C3%B3w/td-p/75425 - seller gives ~70 PLN threshold gift; buyers keep it after partial return; "not in the parcel" dispute.
- https://spolecznosc.allegro.pl/t5/pocz%C4%85tkuj%C4%85cy-sprzedawcy/allegro-pobiera-prowizj%C4%99-od-gratis%C3%B3w/m-p/49695 - "buy 5 get 6th free" priced 0,01 zł, charged 0,25 zł commission; Allegro help text confirms 100% discount -> 0,01 zł.
- https://spolecznosc.allegro.pl/t5/zaawansowani-sprzedawcy/reklamacja-a-gratis/td-p/47930 - does the gift go back on complaint vs withdrawal; can the gift itself be complained about.
- https://spolecznosc.allegro.pl/t5/zaawansowani-sprzedawcy/gratisy-do-oferty/td-p/1050074 - buyer demands gifts promised in description; promotion had ended; moderator: offer misleading.
- https://spolecznosc.allegro.pl/t5/zaawansowani-sprzedawcy/zwrot-niekompletnego-zestawu/m-p/265182 - returned set missing parts; refund reduction "backed by calculations".
- https://spolecznosc.allegro.pl/t5/dyskusje-kupuj%C4%85cych/jaka-kwota-do-zwortu/td-p/1166508 and https://spolecznosc.allegro.pl/t5/pocz%C4%85tkuj%C4%85cy-sprzedawcy/zestaw-10-produkt%C3%B3w/td-p/727363 - how much to refund when one item of an Allegro "zestaw ofert" is returned; discount loss.
- https://spolecznosc.allegro.pl/t5/dyskusje-kupuj%C4%85cych/reklamacja-cz%C4%99%C5%9Bci-zestawu/td-p/937503 - complaint about one component (pump) of a timing-belt kit; seller demands whole kit back.
- https://spolecznosc.allegro.pl/t5/dyskusje-kupuj%C4%85cych/oferta-a-brak-towaru/td-p/74677 - buyers paid, then told "no stock"; seller updates stock manually once a day.
- https://base.com/pl-PL/pomoc/faq/magazyn-bl/ and https://base.com/pl-PL/blog/?p=17041 - BaseLinker kits: stock derived from components; kits only split in shop orders if linking + stock sync are enabled; per-warehouse calc.
- https://base.com/pl-PL/blog/?p=19326 - BaseLinker automatic action "Dodawanie produktu do zamówienia jako gratis" above order value (e.g. 500 zł) + interface reminder to staff to add a gift.
- https://spolecznosc.allegro.pl/t5/zaawansowani-sprzedawcy/czy-warto-korzysta%C4%87-z-baselinker/td-p/602245 - user complaint that listing "w zestawach" works "w sposób tak dziwny, że tylko Base rozumie jego sens" (search-snippet quote; not re-verified on fetched page).
- https://www.shoper.pl/help/artykul/stany-magazynowe-zestawow/ and https://www.shoper.pl/aplikacje/stany-magazynowe-zestawow - Shoper bundle stock; paid third-party app that recalculates all bundle stock "co godzinę"; Shoper Faktury i Magazyn updates stock only when codes match exactly.
- https://useme.com/pl/jobs/subiekt-nexo-pro-sfera-pro-dodatek-automatyczny-montaz-kompletow-przy-zapisie-wz,135569/ - Subiekt nexo PRO user commissioning an add-on: kit (KT) stock goes down but component (TW) stock doesn't.
- https://pomoc.comarch.pl/optima/pl/2026/?p=9511 - Comarch Optima refuses to fiscalise a document with lines at price 0.
- https://systim.pl/dokumentacja-fiskalizator-do-sklepu-shoper.pdf (via search snippet) - fiscal printer blocks zero-value transactions; printer remembers name+rate, rename product (add a dot) workaround.
- https://bezprawnik.pl/jak-rozliczac-gratisy-w-sklepie-internetowym - gift VAT thresholds (10 zł unit / 100 zł per customer per year with records; >200 zł -> VAT + PIT-8C); "1 zł" offers.
- https://www.shoper.pl/learn/?p=68759 (search snippet) - "samo oznaczenie produktu jako „gratis” lub przypisanie mu ceny 0 zł nie przesądza o sposobie opodatkowania".
- https://amavat.pl/zestawy-i-pakiety-produktow-z-roznymi-stawkami-vat-jak-je-prawidlowo-fakturowac/ - mixed-rate sets; allocate set discount "w sposób racjonalny, możliwy do odtworzenia"; sales/warehouse/accounting systems disagree on set structure.
- https://ksiegowosc.infor.pl/podatki/vat-akcyza/61553,Czy-zestaw-produktow-opodatkowac-jedna-stawka-VAT.html, https://pro.rp.pl/prawo-i-podatki/art17046001-nie-kazdy-zestaw-bedzie-opodatkowany-jedna-stawka-vat - dominant view: split per component rate unless functional link (art. 45 k.c.).
- https://trans.info/pl/pelna-kontrola-nad-logistyka-e-commerce-ktore-funkcje-wms-ograniczaja-bledy-w-kompletacji-zamowien-509503 - picking errors -> complaints, reshipping; general, not set-specific.

English:
- https://community.shopify.com/t/bundle-sold-but-components-didnt-decrement-how-are-you-catching-oversells/658245 - shared components, decrement lag, multi-location, pre-built kits, packer substitution. (Several replies are app vendors.)
- https://appnavigator.io/app/bundles/reviews/506805 - 1-star: bundles show no stock when stock exists AND "consistently overselling ... like outrageously"; "our inventory is now a mess".
- https://apps.shopify.com/simple-bundles/reviews?rating=1 and https://appnavigator.io/app/simple-bundles/reviews/?rating=1 - "wiped our entire inventory", "variants going OOS randomly", "processing orders that are empty and missing SKUs", bundle drops products so order reflects 1 of 2.
- https://appnavigator.io/app/shopify-bundles/reviews/?rating=1 - bundles "randomly become unavailable" though components in stock; shipping/fulfilment computed on components.
- https://appnavigator.io/app/shopify-bundles/reviews/?rating=2 (search snippets) - packing slip shows components not bundle (confuses customers); bundle invisible to invoicing/3PL.
- https://community.shipstation.com/ideas/show-retail-price-for-bundle-components-on-packing-slip-5121 and search snippets of https://community.shipstation.com/t5/ShipStation-Features/Bundles-on-Packing-Slips-and-Pick-Lists/m-p/26170 - bundle title printed 5x; components at $0.00 on slip.
- https://community.shopify.com/t/problem-with-bundles-integrating-with-shipstation/215800 - Shopify doesn't flag bundle lines vs standalone; can't group on slip.
- https://community.shopify.com/t/inventory-shortage-errors-not-flagged-when-using-bundle-product-and-regular-product/312878, https://community.shopify.com/t/bundles-by-shopify-incorrect-inventory-based-on-tracking/347563, https://community.shopify.dev/t/out-of-stock-customizable-bundles/35912 - shortage not flagged; incorrect bundle inventory; customizable bundles OOS.
- https://support.getbyrd.com/en/knowledge-base/partial-fulfilment-of-orders- - 3PL: orders with bundles are not partially fulfilled at all.
- https://support.getrecharge.com/hc/en-us/articles/12044989552023-Bundles-orders-processing-with-out-of-stock-products - bundle orders with OOS products (vendor doc).
- https://community.shopify.dev/t/bugs-in-shopifys-returns-admin-and-webhook/23780, https://community.shopify.com/t/order-api-refunds-no-refund-line-items/87161, https://apps.shopify.com/order-ops - restock bugs on component refunds; dedicated paid app for prorated bundle-component refunds.
- https://help.monkcommerce.com/en/article/why-did-some-customers-not-receive-free-gift-with-their-order-i0ung6/ - gift skipped by express checkout, removed by customer, other cart apps, ~1-2% slow loads; check gift in stock.
- https://monkcommerce.com/blogs/stop-using-the-wrong-shopify-free-gift-apps (search snippet) - out-of-stock gift variant = "single most common cause" of gift problems (vendor).
- https://apps.shopify.com/reviews/811311 (BOGOS) and https://apps.shopify.com/sales-motivator-free-gifts/reviews?rating=4 (search snippets) - POS inventory feed made gift look OOS; gift charged when discount code used; "ask what happens when gift is OOS".
- https://community.shopify.com/t/cpi-for-gifted-inventory/645288, https://community.shopify.com/t/how-do-i-properly-account-for-promotional-product-giveaways/15565, https://apps.shopify.com/missing-cost-audit - cost of gifted items, 100%-discount orders distort figures, missing cost => full sale counted as profit.
- https://sellercentral.amazon.com/seller-forums/discussions/t/c461007f-255c-40ff-b5c9-f84686f91e89 - virtual bundles forced to FBM, hidden.
- https://www.selfemployed.com/news/amazon-product-bundle-brand-packaging-rule-2027/ - from 11 Jan 2027 seller-built bundles under one ASIN must be brand-packaged or have authorisation letters (context, not a merchant pain per se).

## Findings

### Theme A - Bundle stock drifts from component stock (strongest, cross-market)

- Shared components are the core mechanism. Shopify Community OP: "everything looks fine until a
  component in the bundle also sells on its own" - plus decrement lag ("a second order can slip
  through in that window"), multi-location ("the set still sells, and then ships in two boxes"),
  pre-built kits still counted as loose units (solo product sells "units that are sealed in a gift
  box"), and packer substitution leaving "both counts wrong".
  https://community.shopify.com/t/bundle-sold-but-components-didnt-decrement-how-are-you-catching-oversells/658245
- Drift goes both ways, often in the same tool. Bundles.app 1-star: "1) the bundles updating to no
  inventory when there was inventory and 2) consistently overselling on our inventory.. Like
  outrageously." / "Issues kept coming up" in busy season / "our inventory is now a mess."
  https://appnavigator.io/app/bundles/reviews/506805
- Simple Bundles 1-star cluster (2023-2026): "The app wiped our entire inventory and set everything
  to 0." (2026-05-11); "variants going OOS randomly"; "our inventory has been restored randomly many
  times". https://apps.shopify.com/simple-bundles/reviews?rating=1
- Shopify's own Bundles app 1-star: bundles "randomly become unavailable" though built from "items
  that are clearly in stock" (2026-02-16). https://appnavigator.io/app/shopify-bundles/reviews/?rating=1
- Poland: Shoper needs a paid third-party app whose headline is "Aplikacja co godzinę aktualizuje
  wszystkie zestawy w sklepie!" - i.e. an hourly window in which a set can oversell a component.
  https://www.shoper.pl/aplikacje/stany-magazynowe-zestawow
- Poland: BaseLinker documents that shop-order kits are split into components only if links are
  correct AND stock sync to the shop is enabled - a silent misconfiguration path.
  https://base.com/pl-PL/pomoc/faq/magazyn-bl/
- Poland: Subiekt nexo PRO user paying a freelancer because kit (KT) stock drops but component (TW)
  stock does not; WZ created from a status change; wants assembly at WZ save.
  https://useme.com/pl/jobs/subiekt-nexo-pro-sfera-pro-dodatek-automatyczny-montaz-kompletow-przy-zapisie-wz,135569/
- Poland (general overselling context): Allegro buyer threads where seller updates stock manually
  "raz dziennie" and buyers get "brak towaru" after paying.
  https://spolecznosc.allegro.pl/t5/dyskusje-kupuj%C4%85cych/oferta-a-brak-towaru/td-p/74677
- Signal strength: **many** (5+ independent sources, 2020-2026, PL + global).

### Theme B - Packing / picking: the warehouse sees the wrong thing

- Packing slip shows components but not the bundle, or the bundle but not components. Shopify
  Bundles reviewers: bundles "appear as separate products on packing slips, which confuses
  customers"; the original bundle is missing so "invoicing and third-party fulfilment services can't
  see it". https://appnavigator.io/app/shopify-bundles/reviews/?rating=2 (search-snippet paraphrase)
- ShipStation: "show bundle on packing slip" prints the bundle title once per child (5x); unchecking
  it shows components at $0.00. Community Manager (Aug 2024): improvements "under consideration".
  https://community.shipstation.com/t5/ShipStation-Features/Bundles-on-Packing-Slips-and-Pick-Lists/m-p/26170 (snippet; page 404 on fetch)
- Shopify does not flag bundle lines vs standalone lines, so ShipStation can't group them.
  https://community.shopify.com/t/problem-with-bundles-integrating-with-shipstation/215800
- Merchants hack around: "warehouse location" field used to list bundle components; staff notes to
  remember bundle contents ("sometimes they got it wrong and sent the wrong items" - edit-order case
  study, vendor; page 404 on fetch, snippet only).
- Simple Bundles: "constantly processing orders that are empty and missing SKUs" and a fix that
  "cancels and replaces orders" which "caused even more headaches for us and our customers"
  (2023-04-12). https://appnavigator.io/app/simple-bundles/reviews/?rating=1
- Gift forgotten by packer: Allegro seller packs "we dwie osoby" and still faces "the gift was
  never in the parcel" claims; forum advice = film packing and unboxing.
  https://spolecznosc.allegro.pl/t5/zaawansowani-sprzedawcy/kupuj%C4%85cy-nie-chce-odda%C4%87-gratis%C3%B3w/td-p/75425
- BaseLinker ships a "remind staff to add the gift" interface action - a tell that gifts are added
  by humans at the bench. https://base.com/pl-PL/blog/?p=19326
- Signal strength: **some-many** (packing slip: several; "gift forgotten": few direct quotes).

### Theme C - Partial availability, variants and substitution

- 3PL Byrd: orders with bundles "will not be partially fulfilled" at all.
  https://support.getbyrd.com/en/knowledge-base/partial-fulfilment-of-orders-
- Shopify: component with "continue selling when out of stock" is excluded from availability, so
  the bundle stays sellable at zero; pre-order/negative stock variants leave bundle showing stock;
  customizable (pick size/colour) bundles OOS questions.
  https://community.shopify.com/t/bundles-by-shopify-incorrect-inventory-based-on-tracking/347563,
  https://community.shopify.dev/t/out-of-stock-customizable-bundles/35912
- Substitution by packer breaks counts (Theme A thread).
- Polish signal: none found for variant-choice sets or substitution. (weak for PL)
- Signal strength: **some**, almost entirely non-PL.

### Theme D - Returns of part of a set, and of the gift

- Allegro "zestaw ofert": each offer is a separate contract; partial return can forfeit the set
  discount; sellers ask "jaka kwota do zwrotu". Moderator: reduce refund "proporcjonalnie" but it
  "powinno być poparte odpowiednimi wyliczeniami".
  https://spolecznosc.allegro.pl/t5/zaawansowani-sprzedawcy/zwrot-niekompletnego-zestawu/m-p/265182,
  https://spolecznosc.allegro.pl/t5/dyskusje-kupuj%C4%85cych/jaka-kwota-do-zwortu/td-p/1166508
- Complaint on one component of a kit: seller demands whole kit back, buyer refuses; forum split.
  https://spolecznosc.allegro.pl/t5/dyskusje-kupuj%C4%85cych/reklamacja-cz%C4%99%C5%9Bci-zestawu/td-p/937503
- Gift on partial return: "Dokonanie częściowego zwrotu powoduje, że nabywca przestaje spełniać
  warunki otrzymania gratisu"; vs "Moim zdaniem zaistniała sytuacja to Wasze ryzyko". Advice:
  note the gift on paragon/faktura at zero value and in the offer.
  https://spolecznosc.allegro.pl/t5/zaawansowani-sprzedawcy/kupuj%C4%85cy-nie-chce-odda%C4%87-gratis%C3%B3w/td-p/75425
- Gift on complaint vs withdrawal: moderator "kupujący nie musi zwracać gratisu w przypadku
  reklamacji, ale już przy odstąpieniu od umowy powinien zwrócić wszystko"; "Kupujący samego
  gratisu reklamować nie może." https://spolecznosc.allegro.pl/t5/zaawansowani-sprzedawcy/reklamacja-a-gratis/td-p/47930
- Global: a single bundle price has no per-item amount, so a one-item refund needs a pricing
  decision (fieldguide/WooCommerce snippet, vendor); Shopify restock bugs on partial refunds of
  the same line; a paid app exists purely to refund one bundle component at prorated price and
  restock the exact SKU. https://community.shopify.dev/t/bugs-in-shopifys-returns-admin-and-webhook/23780,
  https://apps.shopify.com/order-ops
- Signal strength: **many** in PL (Allegro forum keeps returning to it), some globally.

### Theme E - Documents: gift at 0 zł, 0,01 zł workaround, mixed VAT, corrections

- Allegro forces 0,01 zł: help text "Jeśli udzielisz 100% rabatu, obniżymy cenę przedmiotu do
  0,01 zł i naliczymy minimalną prowizję w wysokości 0,25 zł." Seller: a gift still costs 25 gr;
  user: "Gratis" should mean zero / let 0,00 be valid.
  https://spolecznosc.allegro.pl/t5/pocz%C4%85tkuj%C4%85cy-sprzedawcy/allegro-pobiera-prowizj%C4%99-od-gratis%C3%B3w/m-p/49695
- Fiscal side refuses zero: Comarch Optima will not approve/fiscalise a document with lines at
  price 0 ("nie występują pozycje z ceną sprzedaży 0 ... program wyświetli komunikat i nie dopuści
  do zatwierdzenia dokumentu i jego fiskalizacji").
  https://pomoc.comarch.pl/optima/pl/2026/?p=9511 . Systim/Shoper fiskalizator doc (snippet): fiscal
  devices don't register zero-value transactions; printer remembers name+rate, workaround is
  renaming the product (append a dot). (weak - snippet only)
- No source found that explicitly documents the "0,01 zł on paragon" practice as a fiscal-printer
  workaround (outside Allegro's own 0,01). Treat the exact printer behaviour as **unverified**.
- Gift tax rules are a minefield merchants must hand-track: <=10 zł unit cost and <=100 zł per
  customer per year needs customer-identifying records; >200 zł -> VAT + PIT-8C; "1 zł after
  threshold" offers must be economically justified. https://bezprawnik.pl/jak-rozliczac-gratisy-w-sklepie-internetowym
- "samo oznaczenie produktu jako „gratis” lub przypisanie mu ceny 0 zł nie przesądza o sposobie
  opodatkowania" (Shoper Learn, snippet).
- Mixed-rate sets: dominant interpretation = split per component rate unless functional link;
  discount allocation "Rabat na zestaw powinien być przypisany w sposób racjonalny, możliwy do
  odtworzenia i uzasadnienia"; "sales, marketing, warehouse, and accounting systems often disagree
  about the bundle's structure, which can repeat the error across many orders" (amavat paraphrase).
  https://amavat.pl/zestawy-i-pakiety-produktow-z-roznymi-stawkami-vat-jak-je-prawidlowo-fakturowac/
- KSeF-specific gift/0-zł handling: no merchant discussion found (weak/absent).
- Signal strength: **many** for "how do I document a gift/set" (accounting portals are full of it),
  **few** first-person merchant complaints about the printer itself.

### Theme F - Gift promotion mechanics: OOS gift, threshold, express checkout, misleading offers

- OOS gift is the #1 failure per a gift-app vendor (MonkCommerce): eligible customers can't claim.
  Its help article lists gift skipped on express checkout, removed by customer, broken by other
  cart apps, ~1-2% slow loads.
  https://help.monkcommerce.com/en/article/why-did-some-customers-not-receive-free-gift-with-their-order-i0ung6/
- Reviews: inventory fed from POS made a gift look OOS when it wasn't; a gift app charged customers
  for the gift when a discount code was used; reviewer advice "ask what happens when gift is OOS".
  (search snippets of https://apps.shopify.com/reviews/811311, https://apps.shopify.com/sales-motivator-free-gifts/reviews?rating=4) (weak - snippets)
- Allegro: buyer demanded promised gifts (case + speaker) after promotion ended 30 May; moderator
  said gift conditions were unclear and "could mislead customers"; offer violated rules.
  https://spolecznosc.allegro.pl/t5/zaawansowani-sprzedawcy/gratisy-do-oferty/td-p/1050074
- BaseLinker: threshold gift automation exists ("powyżej 500 zł"), plus a new "Wartość zamówienia
  (tylko produkty)" condition (2024) - i.e. merchants needed threshold to exclude shipping.
  https://base.com/pl-PL/blog/?p=19326, https://base.com/pl-PL/blog/?p=18909
- Per-customer gift limits / buyer-chosen gift: no direct merchant quotes found. (weak)
- Signal strength: **some**.

### Theme G - Reporting: bundle margin, cost of gifts

- Gift orders done as 100% discounts distort financial figures; missing cost => "the whole sale
  counts as profit"; a Shopify app exists just to audit missing cost-per-item; advice to keep gift
  cost at $0 vs real cost conflicts.
  https://community.shopify.com/t/cpi-for-gifted-inventory/645288, https://apps.shopify.com/missing-cost-audit
- Simple Bundles default "breaks out the individual products into separate line items and
  discounts them 100%, which can distort inventory reporting" (review/vendor snippet).
- Polish signal on reporting gifts given / bundle margin: none found beyond the bezprawnik record-
  keeping obligation (which is itself a reporting need: who got how much in gifts this year).
- Signal strength: **few** (weak), but structurally implied by Themes E/F.

## Conflicts / open questions

- Gift return on partial return: Allegro forum split ("buyer must return it" vs "seller's risk");
  depends on offer wording. Cannot resolve without legal input.
- Gift on paragon: Allegro forces 0,01 zł; accounting advice says gifts "do not require a receipt
  or invoice; only the main product does" (bezprawnik) - yet forum advice says list the gift at zero
  on the document as evidence it was shipped. Merchants want the gift on the document for dispute
  evidence; fiscal devices reportedly refuse zero lines. Unresolved: what the e-paragon/printer
  stack actually accepts (needs channel researcher / device docs).
- Single rate vs per-component VAT for sets: dominant = split, minority = one rate if functional
  link; the merchant needs to decide per set, which a system must let them express.
- Shopify packing-slip reviews disagree: some want components (picking), others want bundle name
  (customer-facing). Both audiences read the same document.

## Confidence assessment

- High: component-sharing overselling / drift (A); partial return of a set and what to refund (D,
  PL); Allegro 0,01 zł gift mechanic (E).
- Medium: packing-slip/pick-list mismatch (B); OOS gift failure (F, vendor-led); mixed-VAT
  allocation as a real accounting pain (E).
- Low / weak: gift forgotten at pack bench (few first-person); fiscal printer refusing 0 zł lines
  (vendor docs, no merchant quote); per-customer gift limits; buyer-chosen gift; reporting gift
  cost / bundle margin in PL; KSeF-specific gift handling; variant-choice sets in PL.
- Unverified: exact behaviour of e-paragon providers / Novitus/Posnet with 0 zł or 0,01 zł gift lines.

## What the caller might do with this

- Is "one source of truth for component stock across every channel, with no polling window" the
  headline value, given that hourly/daily sync is what PL tools (Shoper app, manual Allegro
  updates) offer today?
- Which audience does each document serve: packer (components, scan each), buyer (bundle name +
  gift listed), accountant (per-component rate and allocated price)? Can one order carry all three
  views without the merchant maintaining three products?
- For gifts, should the gift be an explicit, scannable order line (evidence for "not in parcel"
  disputes, decrements stock, shows on packing list) even when its price is 0 / 0,01 zł?
- What does the merchant expect when one set component is returned: prorated refund, loss of set
  discount, correction invoice on which line? Should the rule be declared on the set up-front?
- Is gift-tax record keeping (per-customer annual gift value, >200 zł) something PL merchants would
  pay for, or is it noise? (Weak signal - worth asking real merchants.)
