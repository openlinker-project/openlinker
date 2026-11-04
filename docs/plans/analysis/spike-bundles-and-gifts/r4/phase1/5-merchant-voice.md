# R4 phase 1 / 5 - Merchant voice on bundles ("zestawy") and free gifts ("gratisy"), from primary-equivalent sources

Researched 2026-11-04. Round 4 rules: no blogs, no vendor marketing, no ordinary forums. Merchants' own words are taken only from **official** venues:
platform issue trackers, official plugin support forums (where the plugin author answers), the platform's own community where an official
moderator/staff role answers, the vendor's own help centre (for vendor-acknowledged limitations), and regulator rulings.

## Sources consulted (and what kind each is)

| Venue | Kind | How read |
|---|---|---|
| github.com/PrestaShop/PrestaShop issues | Official issue tracker; `Verified` / `Ready` labels and maintainer comments = vendor acknowledgement | `gh issue view`, `gh api search/issues` |
| github.com/woocommerce/woocommerce issues | Official issue tracker; Automattic staff comments = acknowledgement | same |
| wordpress.org/support/plugin/woo-product-bundle (WPC Product Bundles), /ithemeland-free-gifts-for-woo | Official WordPress.org plugin support forum; replies tagged "Plugin Support"/"Plugin Author" = vendor | WebFetch (quotes capped at ~120 chars by the tool) |
| community.shopify.com (Discourse) | Official Shopify community. **I found no substantive Shopify-staff answer on bundles or gifts** in ~60 topics checked via the Discourse JSON API (`staff==true` filter): only Community-Manager housekeeping posts. Merchant posts below are therefore labelled "merchant, not staff-answered". | `curl .../t/<id>.json`, `search.json` |
| help.shopify.com, shopify.dev | Vendor primary docs (vendor-acknowledged limitations) | WebFetch |
| help.linnworks.com | Vendor primary docs (limitations) | WebFetch |
| help.core.cin7.com community | Official Cin7 Core community (Zendesk); post read via Zendesk API; no official reply found | `curl /api/v2/community/posts/<id>.json` |
| spolecznosc.allegro.pl | Official Allegro community; replies by role "Moderacja Społeczności" / "Była Moderatorka Społeczności" = **official moderator answers**; other ranks (Demiurg, Ambasador) are users and are quoted only as merchant voice | Khoros LiQL API `api/2.0/search` (author.rank.name returned) |
| asa.org.uk rulings | UK regulator ruling (primary) | WebFetch |
| uokik.gov.pl | Polish regulator press release (primary) | WebFetch |

Dates: GitHub, Discourse, Khoros and Zendesk give exact timestamps. WordPress.org shows only relative ages ("2 weeks, 6 days ago"); I convert them to an approximate month against today (2026-11-04) and mark them `~`.

---

## Pains

Legend for "acknowledged": **Vendor-verified** = maintainer reproduced/labelled; **Vendor-answered** = vendor replied but did not confirm a defect;
**Official rule** = moderator/regulator statement; **Not acknowledged** = only users replied; **Vendor doc** = limitation stated in vendor's own docs.

### PAIN-01 | Stock | Bundle sale does not move component stock correctly (sell, cancel, availability)
- PrestaShop packs: stock wrong after order + cancel with "decrement both". https://github.com/PrestaShop/PrestaShop/issues/28713 (2022-06-09, merchant SebSept): "Stocks must be the same before and after the order has been processed and canceled."
  Maintainer florine2623, 2022-06-10: "I have reproduced your issue in PS 1.7.7.8, 1.7.8.x and 8.0.x. I'll add this to the backlog so it can be fixed." Still **open** in 2026; a merchant contributor (ociohogar, 2026-03-25): "I resolve the issue myself ... I submitted a merge request ... I got requested to rework the merge request ... I don't have time for that".
- Packs can be added to cart beyond available stock: https://github.com/PrestaShop/PrestaShop/issues/26728 (2021-11-24, open, labels `Bug, Verified, Pack, Stocks`): "As a visitor, I should not be able to add to my cart more products than the quantity in stock".
- Back-office order edit lets components go negative: https://github.com/PrestaShop/PrestaShop/issues/24531 (2021-05-17, open, `Major, Verified`): "See error: products in the pack have quantity <0".
- Per-pack "Decrement pack only" silently ignored: https://github.com/PrestaShop/PrestaShop/issues/42079 (2026-07-18, closed): "`STOCK_TYPE_PACK_ONLY === 0` and `empty(0) === true`, so an explicit "Decrement pack only" is indistinguishable from "not set"".
- Vendor tracks this as an EPIC since 2020: https://github.com/PrestaShop/PrestaShop/issues/19846 (2020-06-18): "This EPIC centralizes issues related to problems in stock and quantities for all types of products." (#26728 still unchecked).
- Acknowledged: **Vendor-verified, unfixed for 4+ years.**

### PAIN-02 | Stock / reservation | Component stock decremented at order instead of reserved
- https://github.com/PrestaShop/PrestaShop/issues/23646 (2021-03-15, merchant marekjedrzejewski, open, `Verified, Ready`): "If product is a pack with option to decrement products only, or both, products stock is decremented instead of showing as reserved when order is placed." / "I'd expect to see pack items as reserved on stock page instead of decremented from the total pool."
- Acknowledged: **Vendor-verified.**

### PAIN-03 | Order data | Order does not keep what was actually in the bundle (no content snapshot)
- https://github.com/PrestaShop/PrestaShop/issues/37423 (2024-11-20, open, `Major, Verified`): "if I change the content of it when a customer has already made an order, as a merchant I will send the updated content of the pack, instead of what the customer bought."
  Core maintainer kpodemski, 2024-11-25: "Woah, yes, it's a Major one." Contributor Hlavtox, same day: "It will be an issue all the way from 1.6 or earlier. The order doesn't store information about pack contents."
- Acknowledged: **Vendor-verified (Major).**

### PAIN-04 | Channels / API | Orders that do not come through the storefront do not expand the bundle
- WPC Product Bundles, orders created by a POS through the WooCommerce API: https://wordpress.org/support/topic/reduce-product-stock-individually-in-a-bundle/ (~2019-06; page modified 2019-06-17): "It doesn't decrease the stock for the product individually in that bundle." Plugin author WPClever: "Please contact us via this page with your website info then we can check and fix this problem for you." (no public fix).
- Same plugin, admin-created orders get a wrong bundle price: https://wordpress.org/support/topic/creating-order-in-admin/ (~2026-09): user "updated, but the issue persists. The total is now £29.18" after Plugin Support said a fix was in 8.7.1.
- Vendor doc for the official Woo Product Bundles extension confirms the API caller must supply the expansion itself: https://woocommerce.com/document/bundles/bundles-rest-api-reference/ - `bundle_configuration`: "Must be defined when adding a bundle-type line item to an order, to ensure bundled line items are added to the order."
- Acknowledged: **Vendor-answered (WPC) / Vendor doc (Woo).** Relevance for an OMS that writes orders into shops by API: the bundle is only expanded if the writer sends the configuration.

### PAIN-05 | Fulfilment / downstream | The warehouse, ERP or 3PL gets the wrong representation (components vs. parent)
- WPC Product Bundles + Erply WMS: https://wordpress.org/support/topic/send-bundle-instead-of-individual-products/ (~2026-10, unresolved): bundles are not passed to Erply because "they are not recognized as simple products". Plugin Support offered a snippet; user: it did not fix it.
- Shopify native Bundles + 3PL: https://community.shopify.com/t/bundles-order-splitting-issue/638563 (2026-06-19, merchant slamduncan, not staff-answered): "When someone orders a 12-pack, the order in shopify comes in as 9 cans and 3 cans instead of 12 cans." Quoting the 3PL: "it's going to charge for 12 picks instead of one case pick."
- ShipStation: https://community.shopify.com/t/problem-with-bundles-integrating-with-shipstation/215800 (2023-05-12, merchant): "the bundles and individual products are mixed up with quantites of 0, 1, 2, 3, etc, and some items costing $0.00".
- Vendor's structural answer (doc, not a thread): https://shopify.dev/docs/api/admin-graphql/latest/objects/LineItemGroup: "When a bundle is purchased, each component line item references its LineItemGroup through the lineItemGroup field".
- Vendor doc: https://help.shopify.com/en/manual/products/bundles/shopify-bundles: "SKUs are listed for individual items in orders, not for the bundle SKU".
- Acknowledged: **Not acknowledged by staff in threads; Vendor doc defines the component-lines-plus-group model.**

### PAIN-06 | Marketplace import | A marketplace multi-unit set ("zestaw N sztuk") arrives as one expensive line
- https://spolecznosc.allegro.pl/t5/zaawansowani-sprzedawcy/zestaw-kilku-sztuk-a-rozbijanie-go-w-baselinker/td-p/919655 (2024-11-28, merchant TropicalPL): "Po zaimportowaniu aukcji łączą się od razu z produktem o tym samym EANie i dodaje jako 1 droga aukcja." (After import the offer is matched to the product by EAN and added as one expensive item instead of 5 units.)
- Second Allegro case, a set the seller never created: https://spolecznosc.allegro.pl/t5/zaawansowani-sprzedawcy/quot-zestaw-kilku-sztuk-quot-kt%C3%B3ry-nie-istnieje/td-p/1120033 (2025-11-27, merchant rzeczownik_pl): "Sprzedałem w zestawie 2 sztuki towaru, problem polega na tym, że ja tego zestawu nie tworzyłem." Moderators N_Nitka28 / Syrena_zT took it to verification; user later found two Allegro mechanisms (multi-unit "Wystawiam wiele sztuk produktu jako zestaw" vs. "DODAJ KOLEJNY PRODUKT").
- Acknowledged: **Official moderator engaged (1120033); 919655 user-only.**

### PAIN-07 | Shipping | Bundle weight, dimensions and parcel count are wrong
- https://wordpress.org/support/topic/shipping-weight-and-dimensions/ (~2026-08, unresolved): "As I did it that way, the bundle was double the weight and/or dimension" and "shipping dimensions and weight is doubled when I enter an order manually"; storefront orders got a letter rate for a 3.2 kg bundle. Plugin Support suggested a setting; user said that was not the problem.
- Allegro: a set of 4 rims generates one shipment. https://spolecznosc.allegro.pl/t5/zaawansowani-sprzedawcy/sprzeda%C5%82em-4-felgi-wystawione-jako-zestaw-wygenerowa%C5%82a-si%C4%99-1/td-p/1160122 (2026-03-01). **Official moderator** la_nika, 2026-03-02: "cennik dostaw i maksymalną ilość sztuk w przesyłce ustawia się per oferta ... oferta z czterema felgami będzie liczona jako 1 sztuka." (delivery price list and max units per parcel are set per offer, so a 4-rim offer counts as one unit.)
- Vendor doc: https://help.shopify.com/en/manual/products/bundles/shopify-bundles: "Weight calculation is derived from individual item weights, not the bundle product weight"; https://help.shopify.com/en/manual/products/bundles/eligibility-and-considerations: "Bundles don't have their own shipping profiles."
- Acknowledged: **Official rule (Allegro: by design) / Vendor doc (Shopify).**

### PAIN-08 | Stock model | Shared components across many bundles; availability = scarcest component; no per-location bundle stock
- https://community.shopify.com/t/simple-stock-bundling-unsupported-impossible/399312 (2025-03-08, merchant Pipek, not staff-answered): "Shopify's own Bundles App doesn't effectively cover this use case either, as it seems designed more for simple marketing bundles rather than complex inventory management."
- Vendor doc: https://help.shopify.com/en/manual/products/bundles/shopify-bundles: "Bundles don't track inventory by location, but by overall stock."; https://help.shopify.com/en/manual/products/bundles/eligibility-and-considerations: "The product with the lowest inventory level determines how many bundles can be sold."
- WPC + ATUM multi-inventory: https://wordpress.org/support/topic/dynamic-stock-calculation-based-on-individual-bundled-items-component-inventory/ (~2026-10): "When a customer purchases a bundle, it should deduct 1 unit from Item A and 1 unit from Item B"; follow-up "The bundles I create are not showing on the ATUM Multi inventory plugin" - Plugin Support had replied "By default, the plugin works exactly as you would expect."; user's last post "Are you still there?".
- Acknowledged: **Vendor doc (Shopify); Vendor-answered, unresolved (WPC).**

### PAIN-09 | Model limits | No nested bundles, no bundle in purchase orders/transfers, no substitution of components
- Linnworks vendor doc https://help.linnworks.com/support/solutions/articles/7000044542 (modified 2019-02-06): "Linnworks only supports one-layered compositions." / "It is not possible to add composite parent item to another composite as a child".
- Linnworks vendor doc https://help.linnworks.com/support/solutions/articles/7000024253 (modified 2018-01-29): "It is not possible to add a composite parent item to a purchase order"; "It is not possible to move a composite parent with warehouse transfer".
- Shopify vendor doc (eligibility page): bundles "can't contain other bundles"; "Bundles can't be used in exchanges even when exchanging for an identical bundle."
- Cin7 Core official community, merchant post https://help.core.cin7.com/hc/en-us/community/posts/12048611737359-Anybody-out-there (2025-02-27, no official reply; vote_sum -1): "if the stock of one component isn't available, it prevents auto assembly, requiring our team to manually adjust the order."
- Acknowledged: **Vendor doc (Linnworks, Shopify) / Not acknowledged (Cin7 post).**

### PAIN-10 | Gift presentation | Gift shown at full price then discounted, customers ask for "refund of the gift"
- https://github.com/PrestaShop/PrestaShop/issues/38325 (2025-03-22, Hlavtox; open, `Verified`): "it first adds this product to the product price, then adds a minus value of this product to discounts." and "as our orders grow, so does the over and over repeating calls and emails of customers regarding this." (Example customer email: "I would like to request a refund of 169 CZK for the item ... offered as a "Free Gift"").
  PrestaShop staff ibahloul-ps, 2025-03-31: "I agree with you, and it's definitively something we will address asap since we are currently working on this topic".
- Acknowledged: **Vendor-verified, fix promised.**

### PAIN-11 | Tax / invoicing | Free gift breaks VAT treatment and invoice tax breakdown
- WooCommerce: https://github.com/woocommerce/woocommerce/issues/36196 (2022-12-27, merchant lustek, open): "We don't want to add free gift on the invoice for VAT reasons. If we do so, we need to pay VAT from the full value of the "gift" product." Fixed-cart discounts distributed evenly can zero a line. Woo staff barryhughes, 2024-08-27: "I don't know of any workaround ... we are not currently working on this issue". Another merchant (asansano, 2024-08-28): "shame that we can't use fix amount coupon then in entire Europe for all merchant which declare VAT".
- PrestaShop: https://github.com/PrestaShop/PrestaShop/issues/24122 (2021-04-20, closed as Stale, had `Verified`): gift at 21% VAT next to 4% products gives a wrong breakdown: "The total tax amount is correct, however the breakdown is incorrect." and "As the net price of this product is 0€, taxes should be 0€ also."
- Acknowledged: **Vendor-answered, deprioritised (Woo); Vendor-verified then auto-closed stale (PS).** Note: these are merchants' readings of VAT law, not a tax-authority ruling (see Conflicts).

### PAIN-12 | Gift rules | One gift per rule regardless of quantity; gift line has no quantity
- https://github.com/PrestaShop/PrestaShop/issues/32324 (2023-04-25, vendor EPIC "[EPIC][Pricing] : new rules for gifts", open). Contributor Hlavtox: "One big missing thing - **a gift for every product bought**. "Buy a TV, get a soundbar" - can't do it properly now. Buys two TVs, get's only 1 soundbar." boo-code, 2026-09-07: "A gift is two columns on the rule ... There is no quantity anywhere".
- Gift rule fails when gift equals qualifying product: https://github.com/PrestaShop/PrestaShop/issues/39501 (2025-09-03, open, `Verified`): "You add 4 red shirts to cart, cart rule doesn't work."
- Allegro has no "buy N get 1 free" object; moderator-free answer points to 100% discount on Nth unit (see PAIN-17). https://spolecznosc.allegro.pl/t5/zaawansowani-sprzedawcy/dzie%C5%84-dobry-czy-jest-mo%C5%BCliwo%C5%9B%C4%87-ustawienia-promocji-quot-kup-dwa/td-p/1020390 (2025-05-16, user reply): "ustaw rabat 100% na trzecią sztukę".
- Acknowledged: **Vendor EPIC (PS).**

### PAIN-13 | Gift x discounts | Gift collides with other promotions or thresholds
- https://github.com/PrestaShop/PrestaShop/issues/30532 (2022-12-08, closed Stale): "the discount on the "cheapest product" is applied to the gift product. So in a marketing point of view, we cannot combine having free gift and discount based on the cheap[est]".
- Still present in new engine: https://github.com/PrestaShop/PrestaShop/issues/41671 (2026-06-08, open, `Major, Verified`) "New Discount - Free gift and other discount without beeing compatible"; https://github.com/PrestaShop/PrestaShop/issues/38078 (2025-02-18, open, `Major, Regression, Verified`) "Cart rule of Cheapest product and gift".
- Shopify, gift threshold before vs after discounts: https://community.shopify.com/t/gift-with-purchase-app-that-uses-cart-total-after-rebate-or-coupon/614597 (2026-04-24, Shopify Plus merchant, not staff-answered): the app "uses the threshold of cart subtotal before any automatic discounts and/or coupons are applied".
- Acknowledged: **Vendor-verified (PS).**

### PAIN-14 | Gift fulfilment / compliance | Qualifying order does not actually get the gift (stock or IT fault) - regulatory exposure
- UK ASA ruling, Superdrug Stores plc, 14 Nov 2018, upheld: https://www.asa.org.uk/rulings/superdrug-stores-plc-a18-451479.html - the primary "had not been automatically added as a gift to qualifying orders"; "other consumers who should have received the gift would not have done so due to the IT issue"; breach of CAP Code rule 8.2 "Promoters must avoid causing unnecessary disappointment." Also: "phrases such as 'subject to availability' did not relieve promoters of their obligation".
- PrestaShop, out-of-stock gift still applies the voucher: https://github.com/PrestaShop/PrestaShop/issues/21644 (2020-10-28, closed Stale): "The voucher is added to the cart and the line of the voucher in the checkout is set to 0 euros -> NOK". Vendor spec issue https://github.com/PrestaShop/PrestaShop/issues/38517 (2025-04-22, PS staff ibahloul-ps): "If the product is not available for sale, the discount must not be applied. If the discount has already been applied, it must be removed."
- GIFTiT free-gift plugin: https://wordpress.org/support/topic/out-of-stock-34/ (~2024-01): "if the product out of stock, the user can add this product"; Plugin Author: "in new version we check stock status".
- Acknowledged: **Official regulator ruling; Vendor spec (PS); Vendor-answered (GIFTiT).**

### PAIN-15 | Stock ledger | Gift units are mis-recorded in stock movements
- https://github.com/PrestaShop/PrestaShop/issues/30330 (2022-11-17, open, `Verified`, label `Cart rules`): "The number of a shipped product in the movement section is not correct when the product is added to the order using a cart rule"; expected "The shipped quantity should be -2".
- Acknowledged: **Vendor-verified.**

### PAIN-16 | Returns | Buyer returns the item but keeps the gift; what may the seller deduct?
- https://spolecznosc.allegro.pl/t5/zaawansowani-sprzedawcy/zwrot-towaru-bez-zwrotu-gratisu/td-p/872042 (2024-09-17, merchant kontaktD): "Klient zrobił zwrot całości towaru, jednak gratisy zostawił sobie..." User answers: deduct a stated gift value ("napisać w ofertach, że kupujący otrzymuje gratis np: o wartości 60zł").
- https://spolecznosc.allegro.pl/t5/pocz%C4%85tkuj%C4%85cy-sprzedawcy/zwrot-towaru-z-gratisem/td-p/868973 (2024-09-12). **Official moderator** w_kiwi: "Czy w ofercie miałeś informację zwrocie gratisu w przypadku odstąpienia od umowy?" (Did your offer state the gift must be returned on withdrawal?) Same position in https://spolecznosc.allegro.pl/t5/zaawansowani-sprzedawcy/kupuj%C4%85cy-nie-dosy%C5%82aj%C4%85-gratis%C3%B3w-u%C5%BCywaj%C4%85-rzeczy-i-odsy%C5%82aj%C4%85-po/td-p/794953 (moderator w_kiwi, 2024-05-20): "Tak informacja powinna zostać umieszczona w ofercie, w zakładce "zwroty"".
- Buyer side, the opposite claim: https://spolecznosc.allegro.pl/t5/dyskusje-kupuj%C4%85cych/uznana-reklamacja-i-odliczenie-kwoty-gratisu/td-p/1001457 (2025-04-09): "Na paragonie widniały dwie pozycje Towar i Gratisowy produkt. Sprzedawca postanowił odliczyć wartość tego gratisu" - buyer argues full refund is due on a non-conformity claim.
- Acknowledged: **Official moderator (it depends on what the offer said); unresolved legal question (see Conflicts).**

### PAIN-17 | Returns / pricing | Partial return of a set or multi-buy discount; clawing back the discount
- https://spolecznosc.allegro.pl/t5/zaawansowani-sprzedawcy/aukcja-kup-2-sztuki-a-3-sztuk%C4%99-dostaniesz-gratis-realizacja/td-p/931891 (2024-12-16, merchant AccoEkoBiuro): "Kupujący odesłał 2 sztuki zostawiając sobie trzecią sztukę. Sprzedaż 3 sztuk obniżała cenę produktu." A user quotes the Allegro return text shown on offers: "jeżeli zwrócisz część zestawu, stracisz prawo do zniżki. Kwota zwrotu zostanie pomniejszona o różnicę pomiędzy ceną produktu w zestawie, a ceną produktu bez zestawu" (quoted by a user; I did not find the help page itself - unverified as official wording).
- Shopify vendor doc: "Bundles can't be used in exchanges even when exchanging for an identical bundle." (eligibility page).
- Acknowledged: **Partly (marketplace return text, user-quoted); Vendor doc (Shopify).**

### PAIN-18 | Marketplace data | An Allegro "free" unit is really 0.01 zł with a commission, so the gift arrives as a paid line
- https://spolecznosc.allegro.pl/t5/pocz%C4%85tkuj%C4%85cy-sprzedawcy/allegro-pobiera-prowizj%C4%99-od-gratis%C3%B3w/td-p/49695 (2020-07-01, merchant BURZYNSKID): "6 gratisowy liczony jest za również za 1 grosz". **Official moderator** nat_not, 2020-07-01: "Nie pobieramy prowizji od gratisów rozumianych jako darmowe przedmioty, które oferujesz jako dodatek w swoich ofertach. Natomiast w przypadku zestawów, które tworzysz z różnych ofert, prowizja jest pobierana od wszystkich przedmiotów". nat_not, 2020-07-29: Allegro added to Help: "Jeśli udzielisz 100% rabatu, obniżymy cenę przedmiotu do 0,01 zł i naliczymy minimalną prowizję w wysokości 0,25 zł".
- Implication (my inference): Allegro has two different "gift" shapes - an off-platform extra with no order line, and a 100%-discounted unit that appears as a 0.01 zł line. Whether the 0.01 zł rule is still current: **Unknown** (only the 2020 moderator post; current Help text not found).
- Acknowledged: **Official moderator.**

### PAIN-19 | Marketplace gift choice | No structured way for the buyer to pick a gift; it goes through messages
- Idea board https://spolecznosc.allegro.pl/t5/zg%C5%82o%C5%9B-sw%C3%B3j-pomys%C5%82/zak%C5%82adka-gratis-w-ofercie/idi-p/262841 (2021-10-15, merchant huzarbiz): "Zamiast tworzenia specjalnej grafiki i wpisywania liczby w wiadomości do sprzedającego." **Official moderator** Sa_nova, 2025-06-26: "Przekazałam Twoją propozycję do zespołu, który odpowiada za formularz wystawiania ofert."
- Related rule confusion, gift on thumbnail: https://spolecznosc.allegro.pl/t5/zaawansowani-sprzedawcy/naruszenia-zwi%C4%85zane-z-zamieszczaniem-na-zdj%C4%99ciu-g%C5%82%C3%B3wnym-gratis%C3%B3w/td-p/515014 (2023-01-31). **Moderator** ko_alka: "jeżeli gratis jest dodawany do oferty i otrzymuje go każdy klient, to może być on widoczny na miniaturce." Merchant: "To zupełnie inna informacja niż ta, której mi udzielono wcześniej." In 2026 a user cites the FAQ saying the opposite (thread 1184061, 2026-05-11).
- Acknowledged: **Official moderator (forwarded, no delivery date); contradictory official guidance.**

### PAIN-20 | Compliance (GPSR) | One responsible person per offer, but a set mixes producers
- https://spolecznosc.allegro.pl/t5/zaawansowani-sprzedawcy/rozporz%C4%85dzenie-gpsr-a-zestawy-produkt%C3%B3w/td-p/904344 (2024-11-06, merchant Methrylis): "większość ofert to zestawy produktów kilku różnych producentów". **Official moderator** RaBarbar_ka: "na ten moment można podać tylko jedną osobę odpowiedzialną w ofercie. Aktualnie pracujemy nad tym, aby była możliwość podawania osoby odpowiedzialnej dla każdego produktu w zestawie."
- Acknowledged: **Official moderator (work in progress as of 2024-11).**

### Lower-signal items (kept for completeness, not ranked)
- **Allegro auto-generated "zestawy" of mismatched products** - many merchants ask to switch them off; moderators disable per account. https://spolecznosc.allegro.pl/t5/katalog-produkt%C3%B3w/automatyczne-zestawy-tworzone-przez-allegro/td-p/1037232 (2025-06-18) moderator gdvorek: "tworzymy dla Ciebie automatyczne zestawy, ponieważ chcemy wyświetlać kupującym inne pasujące oferty"; matt_rose: "zgłosiłem Twoje konto do wyłączenia automatycznych zestawów". Merchant marek_s50 (2025-10-02): "WSZYSTKIE SĄ ZŁE". Relevance to an OMS: these are cross-sell sets of separate offers, so the order carries separate lines plus a set discount.
- **Allegro "zestawy elastyczne" migration** - old sets cannot be edited, offers in old sets cannot join new ones: thread 1222038 (2026-09-22), moderator Syrena_zT: "Stworzone zestawy elastyczne zastępują bundle ofertowe na stronie oferty."; thread 1204312 (2026-07-15) idea, moderator forwarded.
- **Gift does not add shipping cost** - GIFTiT https://wordpress.org/support/topic/shipping-cost-issue-4/ (~2025-11): free gift "does not trigger additional shipping costs"; Plugin Author: "Are you using the latest version?"
- **Bundle price range collapses after stock/sales updates** - https://github.com/woocommerce/woocommerce/issues/69970 (2026-10-18), Woo staff jamesckemp: "I'll pass this on to engineering".
- **Bundle margin invisible** - https://community.shopify.com/t/how-to-track-true-profit-on-shopify-product-bundles-component-costs-discount-impact-and-margin/672590 (2026-08-26): "Your reports show bundle revenue as a single line, so you never see the true margin underneath." (Posted by an app account, i.e. vendor-adjacent; weak.)
- **Regulator, Poland** - UOKiK press release 2025-12-04, Biedronka ~105 mln zł: https://uokik.gov.pl/en/gdy-promocja-nie-mowi-tego-co-wazne-blisko-105-mln-zl-kary-dla-biedronki - "Marketing messages should contain the most important information from the consumers' point of view". About a "100% moneyback as a voucher" promotion, not a gift-with-purchase; only an analogy (conditions of a "free" benefit must be clear upfront). I found no UOKiK decision specifically on "gratis" lines in e-commerce orders; a 2004 decision on "2+1 gratis" exists (decyzje.uokik.gov.pl, RLU 39/2004) but I could not extract its text - Unknown.

---

## Conflicts / open questions
1. **Can a seller deduct an unreturned gift?** Allegro moderators say it depends on what the offer stated (868973, 794953). A buyer (1001457) argues that on a non-conformity withdrawal the full price is due even for a "gratis" bundle line. No regulator or court source found here. Treat as **Unknown**; an OMS should record the gift's declared value and the offer terms, not decide.
2. **VAT on free gifts.** Woo 36196 and PS 24122 reflect merchants' beliefs (gift on invoice = VAT on full value; 0 net = 0 tax). These are not tax-authority rulings and they partly contradict each other. Needs a separate primary tax source.
3. **Allegro gift on thumbnail.** Moderator 2023 (allowed if every buyer gets it) vs. Allegro FAQ cited by a user in 2026 (not allowed). Trust the current Help page over a 2023 moderator post; not re-verified here.
4. **Allegro 100% discount = 0.01 zł.** Only a 2020 moderator post; current validity Unknown.
5. **Shopify staff voice.** None found on these topics; Shopify's position comes only from its help centre and API docs.

## Confidence
- High: PrestaShop pack stock/snapshot defects (multiple Verified issues, maintainer quotes); ASA ruling text; Allegro moderator quotes (role returned by the API); Shopify/Linnworks doc limitations.
- Medium: WordPress.org threads (dates approximate; quotes truncated by tool to ~120 chars but verbatim).
- Low: whether pains generalise beyond the platforms quoted; Cin7 (single post, no official reply).

## Jobs to be done (derived)
1. Sell a set as one sellable thing, but reserve, decrement and restore the real components on every channel, including orders created by API, POS or admin.
2. Keep an order-time record of what the set contained, so packing and returns use what the buyer bought, not today's definition.
3. Hand each downstream system the shape it needs: components to pick, a case/parent SKU to bill or invoice, and the link between them.
4. Give a gift that is free to the buyer, while still picking it, moving its stock, and treating its value and tax consistently on the invoice or receipt.
5. Make sure every qualifying order really gets its gift (per qualifying quantity), or visibly fails, because a silent miss is a regulatory breach.
6. On returns, allocate the paid price across set components and gifts, claw back a lost set discount, and record the gift's declared value with the offer's return terms.
7. Ship sets and gifts correctly: weight, dimensions, number of parcels, shipping cost.
8. Stay compliant with marketplace rules for sets and gifts (gift choice, thumbnails, GPSR responsible person per component).
9. See the true margin of a set or a gift promotion.

## Top 5
1. **Component stock correctness** (PAIN-01, 02, 04, 08): the most reproduced, vendor-verified, multi-year pain; breaks especially on non-storefront orders - which is exactly the OMS write path.
2. **Order-time snapshot of set contents** (PAIN-03): vendor calls it Major; the order model simply lacks it.
3. **Downstream representation, parent vs components** (PAIN-05, 06): WMS/3PL/ERP and marketplace imports each expect a different shape; Shopify solves it with component lines plus a group reference.
4. **Gift as a line: price, tax, quantity** (PAIN-10, 11, 12, 18): gift shown as paid-then-discounted, 0.01 zł marketplace lines, VAT confusion, no per-unit quantity.
5. **Returns with sets and gifts** (PAIN-16, 17) plus the regulator angle on missed gifts (PAIN-14).
