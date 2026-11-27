# R3 phase 1 / 5 - Merchant and warehouse voice: bundles (zestawy) and free gifts (gratisy)

Round 3, blind replication. Written from scratch on 2026-11-04 without reading earlier rounds.
Method: web search and page fetches only. Every quote below was returned by a fetch of the cited page
unless marked "(search snippet)", which means the text came from a search-result summary and was not
re-read on the page. Forum posts are opinions of individual users, not authority; I mark moderators
and vendors where the page does.

## Source types used

| Kind | Sources | Weight |
|---|---|---|
| Merchant forum (primary voice) | spolecznosc.allegro.pl (10 threads), community.shopify.com (9 threads), wordpress.org support (3 threads), ukbusinessforums.co.uk (1) | High for "what hurts", low for "what is legal" |
| App store reviews (merchant voice, per-app) | apps.shopify.com, appnavigator.io (mirror of Shopify reviews) | Medium - one app at a time, mixed dates |
| Reddit | r/shopify via reddit.sentinel-team.org snapshots (third-party mirror; reddit.com itself not fetched) | Medium-low - mirror, thread content partly captured |
| Official product docs | base.com help, shoper.pl learn, Comarch Optima help, Allegro moderator answers | High for behaviour of that product |
| Tax/legal commentary | amavat.pl (VAT service vendor), pro.rp.pl (Rzeczpospolita, 2017), bezprawnik.pl (2020), poradnikprzedsiebiorcy.pl, podatki.biz | Medium - secondary, some dated |
| Vendor blogs (pitch) | sumtracker, webgility, fitgap, MasonHub, Recharge | Low - used only to confirm a mechanism, never as evidence of frequency |

## Pain register

Frequency: many = same pain from 3+ independent posters/platforms; some = 2-3; few = 1 or only expert/vendor text.

### PAIN-01 | bundles: stock | merchant | Shared components drift; a bundle or a single product oversells
- Frequency: **many** (Shopify community x4, Reddit x2, WooCommerce plugin forum, Shoper needing a paid app).
- https://community.shopify.com/t/bundle-sold-but-components-didnt-decrement-how-are-you-catching-oversells/658245 (jamnay, 2026-07-28): "everything looks fine until a component in the bundle also sells on its own, or sits inside a second bundle." / "The stock math quietly drifts, and the first sign of trouble is a customer order you can’t actually fulfill."
- Same thread, murtazazaidi (builds bundle tooling): "If the bundle number is ever higher, you’re already oversold and just don’t know it yet."
- r/shopify "Another Bundling Question - new to Shopify" (~Nov 2025, mirror https://reddit.sentinel-team.org/posts/1tdy7qk/snapshots/2026-05-16T11%3A02%3A30.645758Z), u/filmhamster: "inventory does not sync to the items, leading to overselling." Bundle is mix-and-match: "choose any two of these seven different products."
- r/shopify "ShipHero + Shopify SKU Sync Issues" (~Nov 2025, https://reddit.sentinel-team.org/posts/1tdnlgu/snapshots/2026-05-16T11%3A02%3A30.645758Z), u/kibuikacodes: "so essentially we are having to manage inventory twice." Reply u/InTheManVan: keep base units, make bundles "act like kits/BOMs", otherwise "your counts will drift."
- https://wordpress.org/support/topic/reduce-product-stock-individually-in-a-bundle/ (WPC Product Bundles, ~2019, biskootz): "It doesn’t decrease the stock for the product individually in that bundle."
- Counter-evidence (it can work): base.com help https://base.com/pl-PL/pomoc/wiedza/zestawy/ (search snippet): "Stan magazynowy zestawu jest równy najniższemu stanowi produktu wchodzącego w skład zestawu." Shoper https://www.shoper.pl/learn/artykul/zestawy-produktow (search snippet): component stock "zostają automatycznie zaktualizowane po sprzedaży zestawu".

### PAIN-02 | bundles: stock | merchant | Sync lag or batch refresh leaves an oversell window
- Frequency: **some**.
- Shopify thread above, jamnay: "a bundle sells during a busy hour, the component count updates minutes later". Easify-Jennifer (vendor): "Even a small synchronization delay can create problems during busy periods".
- Shoper paid app "Stany magazynowe zestawów" https://www.shoper.pl/aplikacje/stany-magazynowe-zestawow (search snippet): "Aplikacja co godzinę aktualizuje automatycznie wszystkie zestawy w sklepie." - i.e. up to an hour of staleness on the shop's set stock (official app text).
- Cin7 Core G2 (not bundle-specific, search snippet, https://www.g2.com/products/cin7-core/reviews): "When integrating with Shopify, there is some lag unfortunately and so with high heat products, we can encounter oversells."

### PAIN-03 | bundles: pre-built kits | merchant/warehouse | Sealed, pre-assembled kits are still counted as loose components (or not counted at all)
- Frequency: **some**.
- Shopify thread 658245, BadMatter (Assemblified - vendor): "the solo product and every other bundle that uses them can sell units that are sealed in a gift box."
- https://community.shopify.com/t/item-inventory-tracking-for-kits/361071 (mando2931, 2024-09-24): "i am selling kits, and each kit has 5 items that are not sold separately." / "i am wanting to track the inventory of the individual kit items as well as the kits themselves." Non-vendor reply (Bhoomisingh29, 2026): Shopify cannot track kits and components together on its own.
- Mechanism (vendor, low weight): MasonHub describes assembled kits where components "were already decremented from inventory when the Work Order was completed" (search snippet, support.masonhub.co).

### PAIN-04 | bundles: stock / routing | merchant | A set is "in stock" overall but its parts sit in different warehouses
- Frequency: **few** (one merchant-side post + one official rule).
- Shopify thread 658245, kubs (builds a bundle-stock app): "Shopify checks bundle availability against total stock across all locations." Example: shampoo in one warehouse, conditioner in another, set ships in two boxes.
- Shoper (official, search snippet https://www.shoper.pl/learn/?p=950): "Zestaw produktów będzie możliwy do zakupu jeżeli wszystkie jego składowe będą znajdować się w całości na dowolnym, jednym magazynie."

### PAIN-05 | bundles: picking/packing | warehouse | Pick list / packing slip does not tell the packer which lines form one set
- Frequency: **some** (two Shopify threads, opposite wishes).
- https://community.shopify.com/t/how-can-i-indicate-a-line-item-is-a-bundle-component-in-the-packing-slip/273458 (jam_chan, 2023-12-01): "It can only show the product titles, quantities, and SKUs." / "once this packing slip hits the warehouse they have no idea that these line items are gift sets." Shopify staff reply: "it's not possible at the moment to display the grouped view".
- Opposite need (search snippet, https://community.shopify.com/t/shopify-bundles-packing-slip-formatting/373956): merchants who want only the bundle name, not components, on the slip.
- Vendor guide (low weight, fitgap, search snippet): "the kit you think you sell and the kit you actually ship drift apart" when kits are built from memory.

### PAIN-06 | gifts: picking/packing | merchant/warehouse | Gift missing from the parcel (not on the order, not in the WMS, or not packed) and no proof either way
- Frequency: **many** (Shopify app reviews x3, Allegro, 3PL/app review).
- https://appnavigator.io/app/freegifts/reviews/?rating=2 - Vallerret Photography Gloves US Store (2023-09-15): "So orders were flying out the door without the gift in the package."
- https://apps.shopify.com/gifter-cart-auto-include/reviews?rating=1 - No Face Skincare (2023-09-11): "Their glitches often result in not adding a gift or not removing the gift when customers remove products."
- 3PL did not know the gift SKU (search snippet, appnavigator review 1177640): the app creates a "duplicate Gift-product 100% discount off" and "the 3PL didn't integrate because it didn't recognize this "new item"".
- https://spolecznosc.allegro.pl/t5/zaawansowani-sprzedawcy/kupuj%C4%85cy-nie-chce-odda%C4%87-gratis%C3%B3w/td-p/75425 (seller regimda, 2020-08-26): "Od pewnej sumy dodajemy do przesyłki dość cenny gratis (wartość to ok. 70 zł)." / buyer: "Napisała że nic takiego w paczce nie było." Reply AGD-SERVICE (seller): "Zawsze doadjemy gratisy do paragonu albo wpisujemy na fakture za zero." - i.e. sellers put the gift on the document precisely to have proof it was shipped.

### PAIN-07 | gifts: stock | merchant | Gift is not deducted from stock, then runs out silently (or an out-of-stock gift is still offered)
- Frequency: **some**.
- ADU Automatic Discounts review (2019, quoted via search snippet, https://apps.shopify.com/reviews/483850): the app "doesn't minus the freebies given to customers out of the inventory on hand"; discovered when "the freebies my customers were requesting, I no longer had in stock."
- https://appnavigator.io/app/freegifts/reviews/?rating=2 - edZOOcation (2025-08-21): "We also have to do the strangest hack in our product catalog with duplicated products that don't sync inventory".
- r/shopify (~May 2025, mirror https://reddit.sentinel-team.org/posts/1qy0pp7/snapshots/2026-02-07T04%3A52%3A33.223137Z), Mysterious-Swan-2593: "just make sure that the gift is set to $0 and inventory is tracked so you don't oversell it."
- https://wordpress.org/support/topic/out-of-stock-product-not-hide-from-list/ (Free Gift Product for WooCommerce, ~2023, unresolved): ""Out of Stock" Product still show in List."
- Allegro thread "gratisy do oferty" https://spolecznosc.allegro.pl/t5/zaawansowani-sprzedawcy/gratisy-do-oferty/td-p/1050074 (2025-07-15): a seller still advertised a promo gift after the promotion ended: "nie jesteśmy strona promocji i ich po prostu nie posiadamy"; moderator found the gift terms misleading.

### PAIN-08 | gifts: eligibility | merchant | Gift reaches customers who no longer qualify (cart shrank, order cancelled, code stacking, expired offer)
- Frequency: **many**.
- https://community.shopify.com/t/free-gift-with-purchase-after-order-cancellation/582597 (thisismyshopusername, 2026-01-08): "customers that are canceling those orders are still getting the free gift." Reply ericjackson11k: "any free gift that was added is treated like a regular line item". Merchant: "we have just been managing it manually".
- appnavigator freegifts 2-star - Seeds of Wonder (2023-02-28): "the app does NOT remove the free gift from the customer's checkout." Stitchsoup 2 (2015): "they got it for free instead of paying full price even though their cart did not total $16."
- https://appnavigator.io/app/gift-box/reviews/?rating=1 - MUMIT (2025-04-10): "gifts can be selected even if the conditions are not met."
- Search snippet (Shopify review, $2,500 loss): Shop Pay customers "got our high-priced items for free after the offer had expired" (not re-fetched).

### PAIN-09 | gifts: per-customer limits | merchant | One-per-customer gift or sample is redeemed repeatedly; fulfilment does not catch it
- Frequency: **some**.
- https://community.shopify.com/t/limit-free-samples-per-customer-automatically/380280 (CandiGraves13, 2024-12-11): "We also want to limit the amount of times a customer can redeem the free sample" / "some customers are purchasing multiple times and our fulfillment doesn't catch it." (all three replies are vendors)
- App documentation (search snippet, help.aov.ai): restriction applies "if the customer is logged into their member account, but if the customer checks out as a guest, this restriction may not apply." - identity matching is the weak point.

### PAIN-10 | gifts: returns | merchant | Buyer returns the paid goods but keeps the gift; is the gift deductible, must it come back, can it be complained about?
- Frequency: **many** (Allegro 2020 thread with 47 replies, second Allegro thread, UK forum 2010, Shopify 2026) - recurring across a decade and two countries, and opinions conflict.
- Allegro 75425 (2020): "Mamy jej to po prostu podarować i zwrócić pieniądze za towar?"; replies split: "Uważam że niestety musisz zagryźć wargi i oddać hajs." vs glenmoranghie: "warunkiem otrzymania gratisu w tym wypadku jest dokonanie zakupu za określoną kwotę."; LEW433: "Może należy zaznaczyć w opisie, że w razie zwrotu należy także zwrócić "gratis"."
- https://spolecznosc.allegro.pl/t5/zaawansowani-sprzedawcy/reklamacja-a-gratis/td-p/47930 (2020-06-25): seller asks "Czy jeżeli jest reklamowany podstawowy produkt, to Kupujący musi też zwrócić Gratis?". Moderator nat_not: "Nie, kupujący nie musi zwracać gratisu w przypadku reklamacji" and "Klient nie może reklamować gratisu."; kostas11 (user) contradicts: "Gratis też może reklamować".
- https://www.ukbusinessforums.co.uk/threads/dsr-free-gifts.161810/ (deniser, 2010-06-29): "if you sent out a free gift with an internet purchase, and the buyer returned the purchase" / "but kept the free gift". Alicatt: "If you are going to do this, make sure it's VERY clear in the t&cs."
- Same pain in PAIN-08 Shopify cancellation thread.

### PAIN-11 | bundles: partial returns and refunds | merchant + buyer | Returning one item of a discounted set: how much to refund, how the set discount is split back
- Frequency: **many** (Allegro x3 threads 2021-2026, Shopify returns apps).
- https://spolecznosc.allegro.pl/t5/pocz%C4%85tkuj%C4%85cy-sprzedawcy/zwrot-towaru-obj%C4%99te-promocj%C4%85-2gi-50/m-p/214058 (seller, 2021-05-30): "Ile pieniędzy mam mu zwrócić?" Five users give four different answers. Moderator: "w naszej ocenie sprzedający ma prawo potrącić mu przyznany rabat"; second moderator: the proportional split is about computing the discount at purchase, "a nie o kwestię zwrotu."
- https://spolecznosc.allegro.pl/t5/pocz%C4%85tkuj%C4%85cy-sprzedawcy/zestaw-10-produkt%C3%B3w/td-p/727363 (moderator, 2024-02-27): "kwota rabatu, jaki udzielasz na zestaw, jest rozkładana proporcjonalnie na wszystkie przedmioty w zestawie" and return terms text: "Kwota zwrotu zostanie pomniejszona o różnicę pomiędzy ceną produktu w zestawie a ceną produktu bez zestawu". Question by elemino: "jak wygląda rozliczenie zwrotu w przypadku zastawu z rabatem?" sat unanswered a week.
- https://spolecznosc.allegro.pl/t5/dyskusje-kupuj%C4%85cych/jaka-kwota-do-zwortu/td-p/1166508 (buyer, 2026-03-18): "Sprzedający co prawda zwrócił mi pieniądze za noże, ale jedynie 89 zł." - the buyer side of the same ambiguity.
- Shopify ecosystem (vendor docs, search snippets): AfterShip "Partial bundle returns don't support the restock function"; a bundles app requires customers "must send back every item in the bundle to get a refund".

### PAIN-12 | bundles: returns -> stock | merchant | Refund/cancel restocks the bundle parent (or nothing) instead of the components
- Frequency: **few/some** (low-quality evidence).
- Search snippet only (source not located on a trustworthy host; one hit redirected to an unrelated domain, so not used as a page): "if the order is cancelled or revoked, an attempt is made to increase the stock of the bundled (main) product, which of course does not work." - (unverified).
- AfterShip doc (vendor, snippet): partial bundle returns do not restock.
- Treat as hypothesis; plausible from PAIN-01 mechanism.

### PAIN-13 | bundles: complaints (reklamacja) | buyer vs seller | One component is defective; seller demands the whole kit back
- Frequency: **few**.
- https://spolecznosc.allegro.pl/t5/dyskusje-kupuj%C4%85cych/reklamacja-cz%C4%99%C5%9Bci-zestawu/td-p/937503 (2024-12-27): "Mam problem z reklamacją jednego elementu  zestawu rozrządu do samochodu"; replies: "kupiłeś komplet i jak reklamujesz to musisz odesłać komplet" vs "Nie ma potrzeby odsyłania rolek i påska który nie mógł w żaden sposób uszkodzić pompy".

### PAIN-14 | bundles: partial availability / substitution | merchant | One component out of stock kills the whole set; no way to offer or ship a substitute
- Frequency: **some**.
- https://community.shopify.com/t/product-bundle-alternative-when-out-of-stock/238678 (AdriaticTime, 2023-08-05): "Currently, if one of the products is out of stock, the whole bundle becomes out of stock." / "Is there a way to still allow the customer to buy the bundle but select an alternative like product".
- https://community.shopify.com/t/managing-out-of-stock-items-connected-to-product-bundles/39090 (2021-03-10): bundles "(not using an app)" need hiding when a component is out of stock; Shopify Plus, no flow found.
- Recharge doc (vendor, snippet): contact the customer and "edit the order on Shopify to adjust the contents before fulfillment".
- Polish legal angle (bezprawnik, snippet): seller cannot unilaterally withdraw; partial fulfilment needs a ToS clause and notice - so substitution is a customer-consent workflow, not just stock.

### PAIN-15 | gifts: fiscal documents | merchant/accountant | 0 zł lines are refused by fiscal printers/POS; marketplaces turn "free" into 0,01 zł
- Frequency: **some** (official product docs + one merchant + 2013 tax Q&A).
- Comarch Optima help (official) https://pomoc.comarch.pl/optima/pl/2026/?p=3850: "Nie można dokonać zapłaty ponieważ na Paragonie znajdują się pozycje z ceną zerową." (applies also when an item or receipt discount results in zero price).
- Comarch OPT048 https://pomoc.comarch.pl/optima/pl/2026/?p=15129: "Cena poza zakresem lub programowano cenę zerową, a nie ustawiono flagi „cena otwarta”."
- podatki.biz (2013-06-06) https://www.podatki.biz/i461023/rejestracja-sprzedazy-przez-kasy-rejestrujace/rejestracja-sprzedazy-przez-kasy-rejestrujace.htm?page=6: "Jak rejestrować nieodpłatne usługi, jeśli kasa fiskalna nie akceptuje kwoty 0 zł?" (no answer on the page).
- https://spolecznosc.allegro.pl/t5/pocz%C4%85tkuj%C4%85cy-sprzedawcy/allegro-pobiera-prowizj%C4%99-od-gratis%C3%B3w/m-p/49695 (2020): seller "6 gratisowy liczony jest za również za 1 grosz" and "od gratisu została pobrana minimalna prowizja"; user Kasiulki2: "Gratis to ZERO GROSZY, a nie JEDEN GROSZ."; moderator: "Jeśli udzielisz 100% rabatu, obniżymy cenę przedmiotu do 0,01 zł i naliczymy minimalną prowizję w wysokości 0,25 zł".
- Counterpoint (accounting): bezprawnik 2020 https://bezprawnik.pl/jak-rozliczac-gratisy-w-sklepie-internetowym: for a low-value gift the seller "nie jest również zobowiązany do wystawienia paragonu czy faktury" - "robi to tylko dla głównego towaru." Conflicts with sellers who put the gift on the receipt as proof (PAIN-06). Both are true for different goals.

### PAIN-16 | bundles: tax documents | merchant/accountant | Mixed-VAT set: one price must be split across rates; disproportionate split is a tax risk; fiscal printer locks a name to a rate
- Frequency: **some** (expert/vendor/press, no direct merchant post found).
- amavat.pl (VAT service provider, undated) https://amavat.pl/zestawy-i-pakiety-produktow-z-roznymi-stawkami-vat-jak-je-prawidlowo-fakturowac/: "Jedna cena dla klienta nie oznacza jednej podstawy opodatkowania"; "Ryzykowny jest zwłaszcza model, w którym niemal cała cena zestawu zostaje przypisana do produktu ze stawką obniżoną"; "Brak takiego podziału oznacza, że system sprzedażowy może nie być w stanie prawidłowo ustalić podstawy opodatkowania".
- pro.rp.pl 2017-10-09 https://pro.rp.pl/podatki/art10173261-skarbowka-ostrzega-przed-manipulowaniem-cenami-towarow: "Takie manipulowanie podstawą opodatkowania jest niedopuszczalne"; "nieproporcjonalne obniżenie ceny naraża sprzedawcę na ryzyko sporu ze skarbówką".
- Comarch OPT048 (fiscal printer): "Towar kiedyś został sprzedany w innej stawce podatkowej, drukarka fiskalna to pamięta i nie pozwala wysłać takiego towaru z nową stawką." - a set line named once at 23% cannot later go out at 8% under the same name.
- Receipt naming (interpretation via search snippet): a group name allowed only if all goods share one VAT rate - so a mixed-rate set needs one receipt line per rate (unverified page text).

### PAIN-17 | gifts + bundles: KSeF / invoices | accountant | How a gift or a 0 zł line belongs on a structured invoice
- Frequency: **few** - **Unknown** evidence.
- poradnikprzedsiebiorcy (snippet) https://poradnikprzedsiebiorcy.pl/-nieodplatna-dostawa-towarow-a-wymogi-ksef: free delivery is not a sale and is documented outside KSeF (internal document, "WEW" in JPK). No source found on whether a 0 zł line on an FA(3) sales invoice is accepted or rejected. Do not conclude.
- Allegro seller AGD-SERVICE (PAIN-06) "wpisujemy na fakture za zero" - practice exists; legality/KSeF behaviour unverified.

### PAIN-18 | bundles + gifts: reporting | merchant | Bundle margin/COGS wrong (one cost per SKU, discounts not allocated); gift cost invisible
- Frequency: **few/some**.
- https://community.shopify.com/t/best-app-to-calculate-the-bundle-cogs-of-the-product/382100 (ALiii3, 2024-12-20): "Is there any app that can give me a cogs report with the bundle dicsount" / "It does not calculate discount from different variations." Non-vendor reply KangJinKim (2026-03-25): "bundle COGS is tricky because most tools just use a single cost field per variant." Also warns about whether cost changes rewrite history.
- Vendor (webgility, snippet): bundles mapped to one item record so "the other components' costs never reach COGS".
- Gift cost: only the accounting view (bezprawnik: gift purchase cost is a tax-deductible cost). No merchant post found asking for a gift-cost report.

### PAIN-19 | bundles: marketplace listing | merchant | Marketplace sets are fragile: identifiers, disappearing sets, labels, manual work, new Amazon rules
- Frequency: **some** (Allegro x4 threads, Amazon). Mostly catalogue-side, relevant to an OMS only where the set arrives on the order.
- https://spolecznosc.allegro.pl/t5/zaawansowani-sprzedawcy/znikaj%C4%85ce-zestawy/m-p/396394 (2022-07-06): "Z mojego sklepu co jakiś czas znikają dodane zestawy, a ostatnio zniknęły wszystkie." Ambassador: "Jeżeli w między czasie jakaś aukcja się zakończyła (choćby na minutę) to zestaw znika"; poster disputes it.
- https://spolecznosc.allegro.pl/t5/zaawansowani-sprzedawcy/kody-ean-w-zestawach/m-p/659050 (2023-10): "Każda rolka ma swój GTIN/EAN"; moderator: "zestaw powinien posiadać odrębny numer EAN, który należy identyfikuje cały zestaw"; manufacturer refuses to assign one.
- https://spolecznosc.allegro.pl/t5/zaawansowani-sprzedawcy/zestaw-produkt%C3%B3w/td-p/1152004 (2026-02-06): "Wystawiłam jako zestaw a potem pojawia się pojedynczo".
- https://spolecznosc.allegro.pl/t5/zaawansowani-sprzedawcy/zestaw-przedmiot%C3%B3w/m-p/266802 (2021): 500 listings, adding one product as a set to each: moderator "niestety nie zrobisz tego automatycznie. Musisz to zrobić ręcznie."
- https://spolecznosc.allegro.pl/t5/zaawansowani-sprzedawcy/baselinker-rezygnacja/td-p/1146074 (2026-02-13): "Problem z wystawianiem "w zestawach" - znaczy można ale w sposób tak dziwny, że tylko Base rozumie jego sens."
- Amazon (press, https://www.selfemployed.com/news/amazon-product-bundle-brand-packaging-rule-2027/, updated 2026-09-15): from 2027-01-11 most single-ASIN bundles "must be packaged by the original manufacturer or brand". No seller quote.

## Jobs to be done (merchant/warehouse phrasing)

1. When a set or a single item sells on any channel, I want every other set and listing that shares a component to drop at the same moment, so that I never sell stock I do not have.
2. When I assemble kits in advance, I want the built kits counted as their own stock and their parts taken out of loose stock, so that loose sales and kit sales cannot both claim the same unit.
3. When a packer opens an order, I want to see which lines are one set and which line is a gift (and be blocked from closing the parcel without it), so that no box leaves without the set complete or the gift inside.
4. When a gift promotion runs, I want the gift deducted from stock, removed automatically when the order stops qualifying or is cancelled, and stopped when the pool runs out or the customer already got it, so that I do not give away stock or money by accident.
5. When a buyer returns part of a set or keeps the gift, I want the refund amount computed from the documented price split and my return terms, so that I refund the right amount without a forum argument.
6. When one component of a set is out of stock, I want to choose: hold, ship partially with consent, or substitute, and record it on the order, so that the set can still be sold and the customer is told.
7. When I issue a receipt or invoice for a set or a gift, I want each component at its own VAT rate with a defensible price split and the gift handled the way my printer and accountant accept (not a rejected 0 zł line), so that the document prints and survives an audit.
8. When I review profit, I want bundle margin from component costs and the cost of gifts given per campaign, so that I know whether a set or a promotion actually earns money.

## Top 5 by frequency (many-rated, cross-platform)

1. PAIN-01 shared-component stock drift / oversell (Shopify x4, Reddit x2, WooCommerce, Shoper needing an app).
2. PAIN-08 gift reaches unqualified orders (cancelled, cart shrank, expired) - Shopify community + 4 app reviews.
3. PAIN-06 gift missing from the parcel / not on the order / unknown to the 3PL - app reviews, Allegro, 3PL integration.
4. PAIN-10 buyer returns goods, keeps gift; complaint about gift - Allegro (2 threads, 2020), UK (2010), Shopify (2026); opinions conflict.
5. PAIN-11 partial return of a discounted set: refund amount ambiguous - Allegro (2021, 2024, 2026) plus Shopify returns-app limits.

## Sources that returned nothing useful

- IdoSell community / help: no forum thread on sets or gifts found; only changelog and terms.
- Shoper community: no merchant forum threads; only official help and app pages (no reviews of the gift app).
- base.com blog comments: none found; base.com only via its own help pages and one Allegro forum post.
- Subiekt GT "komplety" (kits) in e-commerce: no forum discussion found.
- KSeF + 0 zł line or gift on a structured invoice: no source either way.
- wFirma / inFakt blogs on gift on an invoice: nothing specific.
- Allegro: no thread on a gift running out ("do wyczerpania zapasów") from the seller side.
- Polish per-customer gift limits: nothing.
- Polish bundle-margin or gift-cost reporting from merchants: nothing.
- Amazon seller forums: nothing bundle-specific about partial returns or component stock-outs; only policy/press items.
- G2 / Capterra: no bundle-specific complaints for Cin7 or Linnworks (Linnworks: generic "didn't always sync stock", search snippet).
- 3PL communities (r/ShipBob, ShipStation community): nothing on kit mispicks; ShipStation bundles thread returned 404. Only vendor guides.
- WooCommerce Product Bundles (official plugin) reviews: not located.
- reddit.com directly: not fetched; only third-party snapshot mirrors.

## Conflicts / open questions

- Must a buyer return the gift? Allegro moderator (2020): not on a complaint (reklamacja), yes on withdrawal; users disagree on both. UK posters say it depends on whether the gift is "part of the contract of sale". Cannot resolve without a lawyer; product implication is that the gift's link to the order must be recorded, not decided by the software.
- Is the set discount reversed on a partial return? Allegro moderators (2021, 2024) say the seller may deduct it per return terms; a 2026 moderator reply refunds the line price paid. Both coexist because they depend on the selected "Warunki zwrotów". Trust the 2024 text that quotes the official terms.
- Gift on the receipt: accounting commentary says not required for a low-value gift; sellers put it on the receipt/invoice at 0 zł as proof of shipment, and POS software refuses 0 zł lines. Unresolved; KSeF behaviour Unknown.
- "Bundles just work": base.com and Shoper official docs say component stock updates automatically, while merchant posts on other platforms say it drifts. These are different products; do not generalise either way.

## Confidence

- High: PAIN-01, PAIN-06, PAIN-08, PAIN-10, PAIN-11 exist and recur (multiple independent dated posts).
- Medium: PAIN-05, PAIN-07, PAIN-09, PAIN-14, PAIN-15, PAIN-16 (fewer posts or official docs rather than merchant voice).
- Low / unverified: PAIN-12 (snippet only), PAIN-17 (no source), PAIN-18 gift-cost half, PAIN-04 frequency.
- Bias note: Shopify sources dominate because its community is large and indexed; Polish shop-platform communities (Shoper, IdoSell) are barely visible on the open web, so absence there is not evidence of absence.
