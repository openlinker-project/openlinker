# Research: Merchant and warehouse voice on bundles ("zestawy") and free gifts ("gratisy")

Researcher 5 of 5, PROBLEM phase. Date: 2026-11-04. Read-only web research.

Method note: web search + page fetch. Many results were vendor blogs or app listings; those are
marked as such and weighted lower than first-person forum posts. Where a pain rests on vendor copy
or a single post it is marked (weak).

## Sources consulted

### Polish merchant communities
- https://spolecznosc.allegro.pl/t5/dyskusje-kupuj%C4%85cych/czy-zwracac-gratis/m-p/261624 - 2021-10-12, seller withholds refund until a gift (never on the listing) is returned; buyer never noticed it.
- https://spolecznosc.allegro.pl/t5/pocz%C4%85tkuj%C4%85cy-sprzedawcy/allegro-pobiera-prowizj%C4%99-od-gratis%C3%B3w/m-p/49695 - 2020-07, 100% discount becomes 0.01 zł + 0.25 zł min commission; sellers ask for 0.00.
- https://spolecznosc.allegro.pl/t5/zaawansowani-sprzedawcy/zwrot-niekompletnego-zestawu/m-p/265178 - 2021-10-22, set returned with key component missing; 17 replies.
- https://spolecznosc.allegro.pl/t5/pocz%C4%85tkuj%C4%85cy-sprzedawcy/zestaw-10-produkt%C3%B3w/td-p/727363 - 2024-02, Allegro set limit (10 different products), refund of part of a discounted set.
- Search snippets (Allegro): https://spolecznosc.allegro.pl/t5/dyskusje-kupuj%C4%85cych/jaka-kwota-do-zwortu/td-p/1166508 - buyer/seller disagreement on refund amount for part of a set.
- https://spolecznosc.allegro.pl/t5/smart-dla-sprzedawc%C3%B3w/zestawy-nie-pomog%C4%85/m-p/351591 - 2022-04, seller: sets only suit consumables. (marginal)
- https://spolecznosc.allegro.pl/t5/pocz%C4%85tkuj%C4%85cy-sprzedawcy/ilo%C5%9B%C4%87-sztuk-w-asortymencie/m-p/762655 (snippet) - manual once-a-day stock update, oversell across listings.
- https://spolecznosc.allegro.pl/t5/zaawansowani-sprzedawcy/baselinker-rezygnacja/td-p/1146074 (snippet) - BaseLinker bundles "done in such an odd way only Base understands it". (weak, snippet only)
- https://developer.allegro.pl/news/zamowienia-dodalismy-informacje-o-zestawach-produktow-7GWeDzwWMfv - 2023-12-13, Allegro adds productSet to orders so sellers can see what a set is made of.

### Polish tools / docs
- https://base.com/pl-PL/pomoc/faq/magazyn-bl/ - BaseLinker bundle FAQ: bundle split in store orders only works if products are linked AND stock sync is on; item NAME is not replaced; no returns entry.
- https://base.com/pl-PL/blog/?p=19326 (snippet) - BaseLinker automatic action "add product to order as gift" above order-value threshold.
- https://www.shoper.pl/aplikacje/stany-magazynowe-zestawow - paid add-on (27 zł/mo): bundle stock = min component, refreshed hourly.
- https://www.shoper.pl/help/artykul/stany-magazynowe-zestawow/ (snippet)
- https://www.shoper.pl/aplikacje/produkt-gratisowy-w-koszyku - gift-in-cart app (threshold, choice of gifts).
- https://systim.pl/dokumentacja-fiskalizator-do-sklepu-shoper.pdf (snippet) - fiscal printer refuses a line whose price/VAT changed; workaround: rename product (append a dot).
- Comarch help (snippets): https://pomoc.comarch.pl/optima/pl/2025/?p=10522 (if one component missing, whole set not moved to issue doc), https://pomoc.comarch.pl/wms/pl/altum/dokumentacja/obsluga-kompletow/ (set exploded into component lines for picker), https://pomoc.comarch.pl/mobile/pl/xl/20241/?p=2394 (gift cannot be issued when not in stock).
- https://pomoc.wfirma.pl/-dekompletacja-produktow (snippet) - decompletion of kits into components exists as a separate document.

### Polish tax / legal
- https://bezprawnik.pl/zwrot-produktu-z-gratisem/ - 2026-02-11, gift must be returned; shops demand its value if missing; 1+1 promos block single-unit return.
- https://amavat.pl/zestawy-i-pakiety-produktow-z-roznymi-stawkami-vat-jak-je-prawidlowo-fakturowac/ - 2026-07, mixed-rate sets: split price proportionally, systems repeat errors at scale.
- https://www.podatki.biz/artykuly/mf-ostrzega-przed-manipulowaniem-vat-przy-sprzedazy-zestawow-towarow_4_36060.htm (snippet) - MF warns against loading price onto low-rate component.
- https://www.ifirma.pl/blog/podatki/interpretacje-podatkowe/interpretacje-podatkowe-nazwa-towaru-na-paragonie-fiskalnym/ (snippet) - group name on receipt only if one VAT rate.
- https://www.money.pl/firma/wiadomosci/promocja-typu-2-1-gratis-jakie-stawki-vat-6277456108402817a.html - 2011, "2+1 gratis" classification is hard; minority view: single supply at main rate.
- https://ksiegowosc.infor.pl/podatki/vat/rozliczenia-vat/749718,Rozliczenie-VAT-akcji-promocyjnych-rabaty-skonta-sprzedaz-premiowa.html (snippet) - same-good gift = natural discount; different-good gift = possibly free supply taxed.
- https://akademialtca.pl/blog/rabat-na-zestaw-nie-musi-obejmowac-wszystkich-elementow-fiskus-potwierdza-ale-stawia-wazny-warunek (snippet) - KIS 2026-08-03: no single mandatory way to allocate a set discount.
- https://www.podatki.biz/i416627/jakiej-kwoty-kasy-rejestrujace/jakiej-kwoty-kasy-rejestrujace.htm?page=4 - 2013 Q: "Jak rejestrować nieodpłatne usługi, jeśli kasa fiskalna nie akceptuje kwoty 0 zł?" (answer not in excerpt).
- https://poradnikprzedsiebiorcy.pl/-prezenty-o-malej-wartosci-a-obowiazek-ewidencji-na-kasie-fiskalnej - small-value gifts are not a supply, not on the register.
- https://poradnikprzedsiebiorcy.pl/-ewidencja-prezentow-o-malej-wartosci-wzor-z-omowieniem and https://www.ifirma.pl/blog/prezenty-o-malej-wartosci-zmiany-od-2021-roku/ (snippets) - 20 zł / 20.01-100 zł register / >100 zł taxed thresholds; a gift tied to a sale may not qualify.

### English communities
- https://community.shopify.com/t/bundle-sold-but-components-didnt-decrement-how-are-you-catching-oversells/658245 - 2026-07..10, bundle/component drift, buffer stock, multi-warehouse split, pre-packed gift sets, flavour substitution.
- https://community.shopify.com/t/bundle-individual-products-inventory-quantity-problem/47840 - 2021-05, same product sold alone and in bundle.
- https://community.shopify.com/t/inventory-shortage-errors-not-flagged-when-using-bundle-product-and-regular-product/312878 - 2024-04, Shopify staff confirm bundle+single oversell bug, only partly fixed.
- https://community.shopify.com/t/problem-with-bundles-integrating-with-shipstation/215800 - 2023-05, bundles and components mixed on packing slips.
- https://community.shopify.com/t/how-can-i-indicate-a-line-item-is-a-bundle-component-in-the-packing-slip/273458 (snippet) - cannot show which line belongs to which bundle.
- https://help.shipstation.com/hc/en-us/articles/17398370106779 and https://community.shipstation.com/ideas/show-retail-price-for-bundle-components-on-packing-slip-5121 (snippets) - components show $0 on packing slip when bundle hidden.
- https://community.shopify.com/t/managing-returns-for-set-discounts/221336 - 2023-06, partial return keeps set price.
- https://returns-helpcenter.aftership.com/en/article/how-to-offer-bundle-returns-for-your-shopify-store-r0f7sh (snippet) - restock not supported for partial bundle returns.
- https://community.shopify.com/t/product-bundle-alternative-when-out-of-stock/238678 - 2023-08, whole bundle goes OOS when one item does; wants substitute.
- https://community.oracle.com/Netsuite/english/discussion/4228997/shipping-a-partially-fulfilled-kit (snippet only; fetch timed out) - back-order the missing kit piece.
- https://sellercentral.amazon.com.au/seller-forums/discussions/t/02bb23a9-a52b-44b8-85a4-0525234c3eec (snippet) - no way to cancel one unit when only one in stock.
- https://community.shopify.com/t/stopping-customers-from-abusing-discounted-sample-kits/666701 - 2026-08, five separate orders in 20 min bypass per-cart limit.
- https://community.shopify.com/t/apply-bogo-campaign-limitation-base-on-customers-lifetime-purchase/156488 and https://community.shopify.com/t/how-are-you-enforcing-one-time-per-customer-rules-for-free-samples-and-limited-products-in-shopify/576833 (snippets) - per-cart vs per-customer gift limits, name/email switching.
- https://help.monkcommerce.com/en/article/why-did-some-customers-not-receive-free-gift-with-their-order-i0ung6/ - gift silently missing from orders (Buy Now skips cart, other cart apps, slow network).
- https://apps.shopify.com/sales-motivator-free-gifts/reviews?rating=4 (snippet) - "ask them what happens when a gift gadget is out of stock".
- https://appnavigator.io/app/freegifts/reviews/807974 (snippet) - BOGOS POS conflict told customers gift OOS.
- https://www.retailcoupons.com/?p=23608, https://community.sephora.com/t5/Customer-Support/Gift-with-purchases-lately/m-p/7010020, https://consumerist.com/2010/01/30/beautycom-facebook-revolt-quelled-within-minutes-with-free-stuff/ , https://community.dyson.com/ask-the-community-49/still-chasing-for-promo-gifts-from-order-placed-nov-2023-4707 (snippets) - GWP ran out, shipped without gift, lesser substitutes, still advertised.
- https://apps.shopify.com/simple-bundles/reviews?rating=1 (snippet) - app "wiped our entire inventory and set everything to 0"; ShipStation sync asks.
- https://community.shopify.com/t/best-app-to-calculate-the-bundle-cogs-of-the-product/382100 and https://community.shopify.com/t/how-to-calculate-profit-and-discounts-for-bundled-products/225250 (snippets) - bundle COGS/margin not native.
- https://www.webgility.com/blog/shopify-product-bundle-quickbooks-fix (vendor, snippet) - bundle SKU records zero COGS in accounting.
- Kits vs bundles (vendor): https://docs.sku.io/guides/products/kits-vs-bundles , https://racklify.com/encyclopedia/kit-sku-versus-bundle-sku-inventory-pricing-and-fulfillment-differences/ - pre-built kits lock component stock.
- 3PL kitting (vendor): https://us.fitgap.com/stack-guides/reducing-returns-from-wrong-items-and-missing-components-with-kitting-and-pack-completeness-checks - pick list vs BOM mismatch, scan-to-complete.

## Findings

### Theme A: Bundle stock sync (shared components)
- Shopify forum 2026: "a bundle sells during a busy hour, the component count updates minutes later." Merchant uses "a small buffer on the lowest-stock components". Another reply: "Buffer stock holds until a spike eats the buffer." (658245)
- Shopify forum 2021: "When the customer buys Product A (individual) it should decrease the inventory on Bundle -product also" (47840).
- Shopify staff confirmed in 2024 that a cart holding a bundle with 2x item and 1x the same item alone passes checkout until payment; fix only partial (312878).
- Shoper's own answer is a paid add-on refreshing bundle stock hourly - a built-in oversell window.
- BaseLinker FAQ: bundle explosion only works with product links AND stock sync enabled; the order line NAME is not replaced, so the packer still sees the shop's bundle name over swapped components.
- Allegro sellers updating stock "ręcznie na Allegro raz dziennie" oversell across listings (762655 snippet).
- Frequency: MANY (Shopify forum + app ecosystem of 10+ bundle-sync apps; Polish platforms ship it as add-on).

### Theme B: Multi-location / split shipment of a set
- "still sells, and then ships in two boxes" because components sit in different warehouses (658245, vendor reply). BaseLinker sums bundle stock per warehouse to avoid this.
- Frequency: SOME.

### Theme C: Pre-built kits vs virtual bundles
- Pre-packed gift sets: units packed into boxes still count as loose stock (658245, vendor reply).
- Pre-built kits strand components: 200 pre-built kits cannot serve a single-item order (vendor guides).
- wFirma/Comarch provide explicit kompletacja/dekompletacja documents.
- Frequency: SOME (weak on first-person evidence).

### Theme D: Picking / packing with bundles
- "the bundles and individual products are mixed up with quantites of 0, 1, 2, 3" on ShipStation packing slips; "There is no way to specify between bundles and individual products" (215800, 2023).
- Components print $0 on packing slips when the bundle line is hidden (ShipStation idea + help).
- Comarch WMS explodes the set into component lines for the picker; Comarch Optima will not issue the set if one component is missing.
- 3PL guides: warehouses keep kitting an old part because the pick list did not change with the BOM.
- Frequency: SOME.

### Theme E: Partial availability and substitution
- "if one of the products is out of stock, the whole bundle becomes out of stock" - merchant wants customer to pick a replacement (238678, 2023).
- Candy shop, 3k+ orders/month: "If flavour A is out, B is allowed instead" - recipe-based decrement drifts from what shipped (658245).
- Amazon AU seller: no built-in way to cancel only the missing unit; NetSuite user cannot back-order one kit piece.
- Frequency: SOME.

### Theme F: Returns of part of a set
- Allegro moderator 2024: set discount is spread proportionally; seller should choose return terms saying buyer loses discount on partial return (727363).
- Buyers and sellers argue the refund amount (1166508 snippets).
- Shopify 2023: customers keep remaining items at the set price after returning one (221336).
- AfterShip: restock not supported for partial bundle returns.
- Set returned missing the key component: "Bez niej produkt jest po prostu górą plastiku." Consensus: settle at own loss. (265178)
- Frequency: MANY (recurring on Allegro and Shopify).

### Theme G: Gift on return
- Seller withholds refund until a gift is returned that was never on the listing; buyer did not know it was there (261624, 2021). Moderator: on withdrawal return "wszystko, co otrzymałeś"; on rękojmia not required.
- Bezprawnik 2026: shops demand the gift's monetary value if missing; gift often recorded in sales system but not on receipt.
- The disputes exist because the gift was NOT recorded on the order the seller can show.
- Frequency: MANY in Polish consumer content; SOME in seller forums.

### Theme H: Gift not recorded / not received
- Monk (Shopify gift app) doc: gift missing because "The 'Buy Now' button skips the cart entirely", other cart apps, slow network.
- Polish sellers: Allegro has no zero-price gift; workaround is to slip gifts in the box untold ("lepiej") or price at 1 grosz; Allegro then lowers 100%-discounted item to 0.01 zł and charges 0.25 zł min commission. "Gratis to ZERO GROSZY, a nie JEDEN GROSZ" (49695, 2020).
- BaseLinker automatic action adds a gift line above an order-value threshold - i.e. merchants need an OMS-side rule because channels do not send it.
- Frequency: MANY (structurally: channel-specific).

### Theme I: Gift stock runs out mid-promotion
- GWP sold out early, orders shipped without gift, lesser substitute offered, promo still advertised (Origins/Sephora/Beauty.com/Dyson; UK ASA warned Superdrug for "unnecessary disappointment").
- App reviews: ask what happens when gift is OOS; BOGOS POS conflict.
- Comarch: gift cannot be issued if not in stock.
- Frequency: MANY (retail-wide; consumer side, not OMS-specific).

### Theme J: Gift limits per customer
- Five separate orders in 20 minutes bypass per-cart sample-kit limit (666701, 2026). Limits are per cart or per email; customers switch names/emails. Suggested: match on normalised address or phone; hold before fulfilment.
- Frequency: SOME.

### Theme K: Documents - mixed VAT sets, 0 zł lines, fiscal printers, KSeF
- Mixed-rate set must be split per component with proportional price; MF warns against loading price on low-rate item; automated systems repeat the wrong split across orders (amavat 2026, podatki.biz, ifirma).
- Group name on receipt allowed only if all items share one VAT rate.
- 2013 podatki.biz: "kasa fiskalna nie akceptuje kwoty 0 zł" - how to register free items. (weak - answer not seen)
- Systim fiskalizator: printer refuses a line whose price/VAT changed; workaround append a dot to the name. Relevant when the same product sometimes prints as gift and sometimes at price. (weak, inferred)
- Gift VAT classification is disputed: same good = natural discount (reduce price, no 0 line); different good = possibly free supply taxed, internal invoice. KIS 2026: no single mandatory set-discount allocation.
- KSeF: found no source on a 0 zł gift line in FA(3). (gap)
- Frequency: SOME (accountant portals answer it repeatedly, meaning merchants keep asking).

### Theme L: Reporting - bundle margin, gift cost, small-gift register
- Bundle SKU has no cost so COGS/margin is zero or missing; must sum components (Shopify community + vendor).
- Small-value gifts 20.01-100 zł require a register of recipients (name, value, date); a gift tied to a sale may not qualify at all.
- Frequency: SOME (weak on direct merchant quotes for gift-cost reporting).

### Theme M: Multi-channel differences
- Allegro: sets limited to 10 different products, set discount distributed proportionally, productSet in orders only since Dec 2023; no zero-price gift; min commission on 1-grosz items.
- Shopify: bundle via apps, each app a different order shape (parent SKU at qty 0, or components only).
- Shoper: hourly add-on. BaseLinker: works only when linked + synced.
- Result: the same set arrives in 3 different shapes; manual normalisation.
- Frequency: MANY (inferred from tool fragmentation; first-person quotes few).

## Conflicts / open questions
- Gift return: moderator says return everything on withdrawal; another user says no gift can block the refund; a third says it depends on whether gift was in the offer. Not resolvable without a lawyer; product implication is the same either way: record the gift on the order.
- Gift VAT: natural discount vs taxed free supply; money.pl 2011 single-supply view vs MF/NSA per-component view for sets. Needs tax advisor input.
- 0 zł on fiscal printer: one 2013 question, no current answer found. Needs confirmation with eparagony/Posnet/Novitus behaviour.
- KSeF FA(3) 0-value line: no source found.

## Confidence assessment
- High: bundle/component stock drift and oversell; partial-set return refund disputes; GWP running out; mixed-rate VAT split need.
- Medium: packing-slip confusion with bundles; per-customer gift limits abuse; gift-on-return disputes in PL.
- Low: 0 zł fiscal printer handling; KSeF gift lines; pre-built kit pains (mostly vendor); bundle margin reporting (mostly vendor); gift-cost reporting (no merchant quotes).

## What the caller might do with this
- Is the gift a first-class order line (visible to packer, printed, returnable) or only a pack instruction?
- Which grain does a set live at for stock, picking, documents and returns - and must they agree?
- Does the merchant need substitution inside a set, or only all-or-nothing?
- Who owns partial-return refund maths for a discounted set: channel, OMS, or operator?
