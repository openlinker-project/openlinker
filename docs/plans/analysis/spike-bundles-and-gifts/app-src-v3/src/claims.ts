/**
 * Claim register with final verdicts after rounds 1-5 and live verification (2026-11-04).
 * Source files live in docs/plans/analysis/spike-bundles-and-gifts/ (claims.md, r1-r5, verify/).
 */

export type Verdict = 'potwierdzone' | 'prawdopodobne' | 'sporne' | 'obalone' | 'niepotwierdzone';
export type ClaimArea = 'Allegro' | 'Sklepy i ERP' | 'Marketplace' | 'Podatki i fiskalizacja' | 'Konkurencja' | 'Kod OpenLinkera' | 'Głos sprzedawców';

export interface Claim {
  id: string;
  area: ClaimArea;
  text: string;
  verdict: Verdict;
  /** What changed versus rounds 1-2, if anything. */
  change?: string;
  evidence: string[];
  live?: boolean;
}

export const CLAIMS: Claim[] = [
  // Allegro
  { id: 'C-001', area: 'Allegro', text: 'Oferta z productSet przychodzi jako jedna linia z offer.productSet.products[]{id, quantity}, jedną ceną i jedną stawką.', verdict: 'potwierdzone', evidence: ['verify/allegro-line-price.md', 'r4/phase1/1-allegro.md', 'swagger.yaml:30251-30282'] },
  { id: 'C-002', area: 'Allegro', text: 'Mapper Allegro w OL nie czyta productSet, originalPrice, discounts, reconciliation ani usług dodatkowych.', verdict: 'potwierdzone', evidence: ['verify/allegro-line-price.md', 'allegro-api.types.ts:75-85'] },
  { id: 'C-003', area: 'Allegro', text: 'LineItemDiscount ma tylko pole type, bez kwoty.', verdict: 'potwierdzone', evidence: ['verify/allegro-line-price.md', 'swagger.yaml:31255-31274'] },
  { id: 'C-004', area: 'Allegro', text: 'Typ rabatu BUNDLE pojawia się też przy zestawach tworzonych przez Allegro i bez zmiany ceny.', verdict: 'prawdopodobne', evidence: ['r1/phase1', 'r2/phase1'] },
  { id: 'C-005', area: 'Allegro', text: 'Promocje MULTIPACK na jednej ofercie kończą się 12.01.2027, CROSS_MULTIPACK zostaje.', verdict: 'prawdopodobne', evidence: ['r2/phase1', 'r5/1-allegro-pl.md'] },
  { id: 'C-006', area: 'Allegro', text: 'API /sale/bundles jest wycofane, tworzenie usunięto 10.06.2026.', verdict: 'prawdopodobne', evidence: ['r2/phase1', 'r5/1-allegro-pl.md'] },
  { id: 'C-007', area: 'Allegro', text: 'Darmowa sztuka w multipacku kosztuje 0,01 zł z minimalną prowizją.', verdict: 'prawdopodobne', change: 'Kwota prowizji nadal niepotwierdzona.', evidence: ['r1/phase1', 'r2/phase1'] },
  { id: 'C-008', area: 'Allegro', text: 'Allegro nie ma funkcji gratisu. Gratis jest zwykle tylko obiecany w opisie i nie ma go w zamówieniu.', verdict: 'potwierdzone', evidence: ['r3/phase1/1-allegro.md', 'r4/phase1/1-allegro.md', 'verify/allegro-line-price.md'] },
  { id: 'C-009', area: 'Allegro', text: 'Numer przesyłki podaje się per lineItem, bez ilości i bez składnika.', verdict: 'potwierdzone', evidence: ['r2/phase1', 'r5/1-allegro-pl.md'] },
  { id: 'C-010', area: 'Allegro', text: 'Zwroty klienta są po offerId i ilości, bez poziomu składnika (poza One Fulfillment).', verdict: 'potwierdzone', evidence: ['r1/phase1', 'r2/phase1', 'r5/1-allegro-pl.md'] },
  { id: 'C-070', area: 'Allegro', text: 'price i originalPrice to ceny jednostkowe. Na linii z productSet quantity liczy zestawy, a price to cena jednego zestawu.', verdict: 'potwierdzone', change: 'Nowe. Rozstrzyga pytanie z rundy 4.', evidence: ['verify/allegro-line-price.md', 'tutorial jak-obslugiwac-zamowienia'] },
  { id: 'C-071', area: 'Allegro', text: 'Dopłata Allegro Ceny nie jest w price ani originalPrice, tylko w lineItems[].reconciliation.', verdict: 'potwierdzone', change: 'Nowe.', evidence: ['verify/allegro-line-price.md', 'swagger.yaml:31096-31119'] },

  // Shops and ERP
  { id: 'C-011', area: 'Sklepy i ERP', text: 'PrestaShop wysyła pak jako jeden wiersz zamówienia.', verdict: 'potwierdzone', live: true, evidence: ['verify/prestashop-live.md §Q4'] },
  { id: 'C-012', area: 'Sklepy i ERP', text: 'Gratis z reguły koszyka PrestaShop jest wtopiony w zwykły wiersz po pełnej cenie, a wartość jest w order_cart_rules.', verdict: 'potwierdzone', live: true, change: 'Doprecyzowane: inny produkt dostaje własny wiersz po pełnej cenie, ten sam produkt scala się w jeden wiersz z ilością 2. Komentarz w mapperze OL ma rację tylko dla innego produktu.', evidence: ['verify/prestashop-live.md §Q1-Q2'] },
  { id: 'C-013', area: 'Sklepy i ERP', text: 'PrestaShop nie zamraża składu paku na zamówieniu.', verdict: 'potwierdzone', live: true, evidence: ['verify/prestashop-live.md §Q4'] },
  { id: 'C-014', area: 'Sklepy i ERP', text: 'pack_stock_type=0 jest czytany jak domyślny tryb sklepu (błąd empty()) do 9.1.x, poprawiony w 9.2.0.', verdict: 'prawdopodobne', evidence: ['r2/phase1', 'r4/phase1/2-own-shops.md'] },
  { id: 'C-015', area: 'Sklepy i ERP', text: 'WooCommerce Product Bundles łączy dzieci z kontenerem przez bundled_by.', verdict: 'potwierdzone', evidence: ['r1/phase1', 'r2/phase1', 'r4/phase1/2-own-shops.md'] },
  { id: 'C-016', area: 'Sklepy i ERP', text: 'WPC łączy dzieci tylko przez meta _woosb_parent_id (id produktu), co psuje się, gdy ten sam zestaw jest dwa razy.', verdict: 'prawdopodobne', evidence: ['r2/phase1', 'r4/phase1/2-own-shops.md'] },
  { id: 'C-017', area: 'Sklepy i ERP', text: 'Shopify wysyła same składniki zgrupowane lineItemGroup, a sposób podziału ceny nie jest opublikowany.', verdict: 'obalone', change: 'Pierwsza część prawdziwa. Podział jest opublikowany: waga cena jednostkowa x ilość, podatek liczony na składnikach.', evidence: ['r4/phase2/5-shopify.md', 'r5/5-competitors-global.md', 'shopify.dev cart-transform'] },
  { id: 'C-018', area: 'Sklepy i ERP', text: 'Linia zamówienia Shoper ma type 1 i children[] z ceną i VAT.', verdict: 'prawdopodobne', change: 'Tylko z SDK. Dokumentacja REST za logowaniem, test na żywo niemożliwy bez dostępu.', evidence: ['r2/phase1', 'r3/phase1/3-pl-saas-and-erp.md'] },
  { id: 'C-019', area: 'Sklepy i ERP', text: 'Adapter Shoper w OL ignoruje type i children.', verdict: 'potwierdzone', evidence: ['shoper-incoming-order.mapper.ts:273-300', 'r3/phase1/3-pl-saas-and-erp.md'] },
  { id: 'C-020', area: 'Sklepy i ERP', text: 'IdoSell oznacza tryb sprzedaży linii orderSalesMode: money, gift albo points, a zestaw przez bundleId.', verdict: 'potwierdzone', evidence: ['r3/phase1/3-pl-saas-and-erp.md', 'idosell.readme.io ordersordersget'] },
  { id: 'C-021', area: 'Sklepy i ERP', text: 'Sky-Shop pokazuje gratis na wydruku zamówienia, nie na fakturze, a zestaw fakturuje jedną linią z jedną stawką.', verdict: 'prawdopodobne', evidence: ['r1/phase1', 'r2/phase1'] },
  { id: 'C-022', area: 'Sklepy i ERP', text: 'Komplet Subiekta GT ma stan dopiero po montażu.', verdict: 'potwierdzone', evidence: ['r3/phase1/3-pl-saas-and-erp.md (InsERT e-pomoc 1022)', 'r2/phase1'] },
  { id: 'C-074', area: 'Sklepy i ERP', text: 'Most Subiekt GT nie ustawia PominAsortymentPowiazany, więc cena kupującego może trafić na pozycję powiązaną.', verdict: 'prawdopodobne', change: 'Nowe. Z dokumentacji Sfery i kodu, bez testu na żywo.', evidence: ['r3/phase1/3-pl-saas-and-erp.md', 'bridge-gt/Sfera.cs:335-350'] },
  { id: 'C-079', area: 'Sklepy i ERP', text: 'validateOrder w PrestaShop nie jest atomowe: przerwane wywołanie zostawia zamówienie z liniami, bez reguły koszyka.', verdict: 'prawdopodobne', live: true, change: 'Nowe, jedna obserwacja.', evidence: ['verify/prestashop-live.md'] },

  // Marketplaces
  { id: 'C-023', area: 'Marketplace', text: 'Erli ma productSets na produkcie, a na linii unitPriceBeforeRebate. Rabat jest na poziomie zamówienia, bez kwoty.', verdict: 'potwierdzone', evidence: ['r4/phase1/4-marketplaces-and-law.md', 'r2/code'] },
  { id: 'C-024', area: 'Marketplace', text: 'Mirakl (Empik) jest jedynym marketplace z darmowymi sztukami na linii: promotions[].offered_quantity.', verdict: 'potwierdzone', evidence: ['r4/phase1/4-marketplaces-and-law.md', 'r1/phase1', 'r2/phase1'] },
  { id: 'C-025', area: 'Marketplace', text: 'Kaufland wysyła jedną order_unit na sztukę i nie pokazuje promocji finansowanych przez Kaufland.', verdict: 'potwierdzone', evidence: ['r4/phase1/4-marketplaces-and-law.md'] },
  { id: 'C-026', area: 'Marketplace', text: 'Amazon IsGift oznacza pakowanie na prezent, nie darmowy produkt.', verdict: 'potwierdzone', evidence: ['r4/phase1/4-marketplaces-and-law.md'] },
  { id: 'C-027', area: 'Marketplace', text: 'Żaden marketplace nie wysyła składu zestawu na zamówieniu.', verdict: 'obalone', change: 'Allegro wysyła productSet z UUID produktów katalogowych i ilościami. Nadaje się tylko do kontroli, nie jako źródło składu.', evidence: ['verify/allegro-line-price.md', 'r5/6-design-and-code.md N-4'] },
  { id: 'C-078', area: 'Marketplace', text: 'Zamówienia Erli w EUR są zapisywane jako PLN, a stawki TAX_7/TAX_19 opisane jako polskie.', verdict: 'potwierdzone', change: 'Nowe, z kodu.', evidence: ['erli-order.mapper.ts:238', 'erli-tax-rate.mapper.ts:23,210', 'r5/3-marketplaces-countries.md'] },

  // Tax and fiscal
  { id: 'C-028', area: 'Podatki i fiskalizacja', text: 'eparagony odrzuca paragon, gdy wartość stawki VAT po rabatach wynosi 0 lub mniej (błąd 41). Linia 0,00 sama w sobie przechodzi.', verdict: 'potwierdzone', live: true, change: 'Doprecyzowane w drugim teście.', evidence: ['verify/eparagony-gift-forms.md', 'r5/8-tax-fiscal.md'] },
  { id: 'C-076', area: 'Podatki i fiskalizacja', text: 'Linia REBATE z taxRate zostaje w swojej stawce i daje poprawny VAT. Gratis sam w stawce jest odrzucany w każdej formie.', verdict: 'potwierdzone', live: true, change: 'Nowe.', evidence: ['verify/eparagony-gift-forms.md'] },
  { id: 'C-029', area: 'Podatki i fiskalizacja', text: 'REBATE bez taxRate rozkłada się po stawkach i daje zły VAT.', verdict: 'sporne', change: 'Rozkład jest proporcjonalny do wartości linii, a przepis dopuszcza rabat bez stawki (2024 poz. 1654 par. 22). Jeśli gratis jest sprzedażą odpłatną, taki podział jest do obrony.', evidence: ['r5/8-tax-fiscal.md'] },
  { id: 'C-030', area: 'Podatki i fiskalizacja', text: 'Core OL odrzuca paragon i fakturę, gdy linie nie sumują się do totalu.', verdict: 'potwierdzone', evidence: ['order-to-register-transaction-command.mapper.ts:136,214', 'r5/8-tax-fiscal.md'] },
  { id: 'C-031', area: 'Podatki i fiskalizacja', text: 'Rozporządzenie o kasach z 2019 wymaga pokazania rabatów i sum po stawkach.', verdict: 'obalone', change: 'Rozporządzenie z 2019 uchylone. Te same wymogi są w rozp. z 2025 (par. 26) i, dla kas online, w Dz.U. 2024 poz. 1654 par. 22.', evidence: ['r4/phase1/4-marketplaces-and-law.md', 'r5/8-tax-fiscal.md'] },
  { id: 'C-032', area: 'Podatki i fiskalizacja', text: 'Comarch Optima nie fiskalizuje linii z ceną 0.', verdict: 'prawdopodobne', evidence: ['r1/phase1', 'r5/8-tax-fiscal.md'] },
  { id: 'C-033', area: 'Podatki i fiskalizacja', text: 'Gratis przy płatnej sprzedaży to jedna dostawa z podstawą równą zapłacie.', verdict: 'sporne', change: 'KIS 2026 uznaje gratis z rabatem 100% za nieodpłatną dostawę. Starsze interpretacje mówią o dwóch odpłatnych dostawach, każda w swojej stawce.', evidence: ['r5/8-tax-fiscal.md', 'KIS 0114-KDIP1-1.4012.876.2025.2.IZ'] },
  { id: 'C-068', area: 'Podatki i fiskalizacja', text: 'KIS (23.01.2026): towar z rabatem 100% w koszyku to nieodpłatna dostawa (art. 7 ust. 2), nie rabat. Podstawa to cena nabycia, a takiej dostawy nie dokumentuje się fakturą.', verdict: 'potwierdzone', change: 'Nowe. Odwraca rekomendację z rundy 1 (cena katalogowa + rabat 100%).', evidence: ['r4/phase1/4-marketplaces-and-law.md', 'r5/8-tax-fiscal.md (eureka id 676872)'] },
  { id: 'C-034', area: 'Podatki i fiskalizacja', text: 'Próg małych prezentów: 20 zł ceny nabycia za sztukę albo 100 zł rocznie na osobę z ewidencją.', verdict: 'potwierdzone', change: 'Rozstrzygnięte: 20 zł od 1.01.2021, liczone od ceny nabycia, nie ceny katalogowej.', evidence: ['r5/8-tax-fiscal.md', 'Dz.U. 2020 poz. 2419'] },
  { id: 'C-035', area: 'Podatki i fiskalizacja', text: 'BFH XI R 19/23: cenę zestawu dzieli się według cen sprzedaży składników.', verdict: 'potwierdzone', change: 'To test wykluczający metody, nie samodzielna reguła: wykluczona jest każda metoda, która daje przecenionemu składnikowi więcej niż jego cena osobno. Samo przycinanie jako metoda podziału nie jest uznane (XI R 22/22, źródła wtórne).', evidence: ['verify/bundle-price-split.md', 'r5/8-tax-fiscal.md', 'r4/phase1/4-marketplaces-and-law.md'] },
  { id: 'C-081', area: 'Podatki i fiskalizacja', text: 'Komunikat MF z 29.09.2017: proporcjonalne obniżenie ceny względem cen składników poza zestawem jest prawidłowe. Bez ceny osobno można użyć ceny nabycia. Podział nieproporcjonalny grozi zarzutem nadużycia.', verdict: 'potwierdzone', change: 'Nowe. Podział w chwili sprzedaży z cen katalogowych jest dopuszczalny, nic nie wymaga zamrożenia przy definicji.', evidence: ['verify/bundle-price-split.md', 'TSUE C-349/96 CPP pkt 31'] },
  { id: 'C-036', area: 'Podatki i fiskalizacja', text: 'Włochy odróżniają sconto merce (poza podstawą) od omaggio.', verdict: 'potwierdzone', change: 'Od 2027 przepis przechodzi do art. 29 TU IVA. Gratis w wyższej stawce jest opodatkowany.', evidence: ['r4/phase1/4-marketplaces-and-law.md', 'r5/8-tax-fiscal.md'] },
  { id: 'C-037', area: 'Podatki i fiskalizacja', text: 'Builder FA(3) dla KSeF nigdy nie wysyła P_10.', verdict: 'potwierdzone', evidence: ['fa3-xml.types.ts:290-304', 'r5/8-tax-fiscal.md'] },
  { id: 'C-038', area: 'Podatki i fiskalizacja', text: 'Most Subiekta ma parę cena przed i po rabacie tylko na ścieżce ZK.', verdict: 'prawdopodobne', evidence: ['r1/code', 'r5/8-tax-fiscal.md'] },

  // Competitors
  { id: 'C-039', area: 'Konkurencja', text: 'BaseLinker: stan zestawu to minimum składników, liczony per magazyn i sumowany. Zestaw w zestawie zabroniony.', verdict: 'sporne', change: 'Stan potwierdzony. Cytat o zakazie zagnieżdżania dotyczy pola relations, nie składu zestawu, więc zagnieżdżanie: brak danych.', evidence: ['verify/nested-and-gift-stockout.md', 'r4/phase2/1-baselinker.md'] },
  { id: 'C-040', area: 'Konkurencja', text: 'BaseLinker rozpoznaje gratis tylko po cenie 0, a gratis z IdoSell zamienia na 0,01 zł z przeniesieniem wartości.', verdict: 'potwierdzone', evidence: ['r3/phase2/1-baselinker.md', 'r4/phase2/1-baselinker.md'] },
  { id: 'C-041', area: 'Konkurencja', text: 'Apilo: cena składnika w zestawie, proporcjonalne przeliczenie do ceny z kanału, stan liczony co 15 min.', verdict: 'potwierdzone', evidence: ['r3/phase2/2-apilo.md', 'r4/phase2/2-apilo.md'] },
  { id: 'C-042', area: 'Konkurencja', text: 'Sellasist: gratis po cenie katalogowej plus linia "Rabat" per stawka VAT, ukrywanie w zbieraniu, zestawy dynamiczne.', verdict: 'potwierdzone', evidence: ['r3/phase2/3-sellasist.md', 'r4/phase2/3-sellasist.md'] },
  { id: 'C-043', area: 'Konkurencja', text: 'Linnworks: integracje deklarują flagi po sprzedaży, UI się dopasowuje. Nic o zestawach i gratisach.', verdict: 'potwierdzone', evidence: ['r3/phase2/4-linnworks.md', 'r4/phase2/4-linnworks.md', 'r5/5-competitors-global.md'] },
  { id: 'C-044', area: 'Konkurencja', text: 'Shopify: jeden kształt zamówienia dla wszystkich aplikacji zestawów.', verdict: 'prawdopodobne', change: 'Tylko dla zamówień z koszyka. Zamówienia importowane nie są grupowane i nie da się ich edytować.', evidence: ['r5/5-competitors-global.md', 'r4/phase2/5-shopify.md'] },
  { id: 'C-045', area: 'Konkurencja', text: 'Brightpearl: cena na rodzicu, składniki po 0,00, "wysłano" po pierwszym składniku.', verdict: 'potwierdzone', change: '"Wysłano po pierwszym" dotyczy Amazona. Shopify i BigCommerce dopiero po całości.', evidence: ['r3/phase2/7-brightpearl.md', 'r4/phase2/7-brightpearl.md'] },
  { id: 'C-046', area: 'Konkurencja', text: 'Cin7: jeden BOM z trybami ręcznym, auto i kompletowania przy zbieraniu.', verdict: 'potwierdzone', change: '"Promocje nigdy nie dodają produktu" tylko z forów.', evidence: ['r3/phase2/6-cin7.md', 'r4/phase2/6-cin7.md'] },
  { id: 'C-073', area: 'Konkurencja', text: 'Cin7 Core pozwala na zestawy wielopoziomowe.', verdict: 'potwierdzone', change: 'Nowe. Obala D3e "wszyscy zabraniają zagnieżdżania".', evidence: ['verify/nested-and-gift-stockout.md', 'r4/phase2/6-cin7.md'] },
  { id: 'C-047', area: 'Konkurencja', text: 'Żaden konkurent nie ma polityki na gratis, którego zabrakło.', verdict: 'obalone', change: 'Kilku ma politykę (zatrzymanie oferty, blokada, czekanie, dodanie mimo braku). Prawdziwe w wąskiej formie: nikt nie podmienia gratisu i nie informuje kupującego.', evidence: ['verify/nested-and-gift-stockout.md'] },
  { id: 'C-048', area: 'Konkurencja', text: 'Żaden konkurent nie ma wspólnego standardu zestawów i gratisów deklarowanego przez integracje.', verdict: 'sporne', change: 'Shopify ma wspólny standard dla swoich aplikacji, Mirakl jeden kształt gratisu. Prawdziwe tylko: żaden OMS nie normalizuje kształtów innych kanałów przez deklaracje adapterów.', evidence: ['r5/5-competitors-global.md'] },
  { id: 'C-080', area: 'Konkurencja', text: 'Linnworks ma warunki reguł "scalone / podzielone / ponowione", żeby gratis nie dodał się drugi raz.', verdict: 'potwierdzone', change: 'Nowe.', evidence: ['r3/phase2/4-linnworks.md', 'r4/phase2/4-linnworks.md'] },

  // OL code
  { id: 'C-049', area: 'Kod OpenLinkera', text: 'Klucz dekrementacji sale:{owner}:{workId}:{orderLineId} koliduje dla dwóch składników jednej linii.', verdict: 'potwierdzone', change: 'Dziś nieosiągalne, bo indeks linii pracy odrzuca drugi składnik wcześniej.', evidence: ['r5/6-design-and-code.md', 'inventory-sale-decrement.types.ts:130'] },
  { id: 'C-050', area: 'Kod OpenLinkera', text: 'Unikalne indeksy na liniach pracy i liniach przesyłki kolidują dla składników.', verdict: 'potwierdzone', change: 'Linie przesyłki nie kolidują: zostają na linii zestawu.', evidence: ['r5/6-design-and-code.md', 'verify/component-line-id.md'] },
  { id: 'C-051', area: 'Kod OpenLinkera', text: 'closeForOrder po pierwszym składniku zamyka rezerwacje rodzeństwa.', verdict: 'potwierdzone', change: 'Dochodzi bramka zamkniętych linii (reservation.service.ts:111).', evidence: ['r5/6-design-and-code.md'] },
  { id: 'C-052', area: 'Kod OpenLinkera', text: 'Kontrola zachowania ilości w routingu jest po linii zamówienia.', verdict: 'potwierdzone', change: 'Gorzej: RoutingAssignment nie ma wariantu, więc router nie wskaże składnika.', evidence: ['routing.types.ts:149-155,274-276', 'r5/6-design-and-code.md'] },
  { id: 'C-053', area: 'Kod OpenLinkera', text: 'Rozpoznanie pozycji jest wszystko albo nic: jedna niezmapowana linia blokuje zamówienie.', verdict: 'potwierdzone', evidence: ['order-ingestion.service.ts:616-628'] },
  { id: 'C-054', area: 'Kod OpenLinkera', text: 'IncomingOrderTotals nie ma discountTotal.', verdict: 'potwierdzone', change: 'Luka w typie, dane nie giną w działaniu.', evidence: ['incoming-order.types.ts:237-270', 'r5/6-design-and-code.md'] },
  { id: 'C-055', area: 'Kod OpenLinkera', text: 'Nowe pole linii trzeba dopisać w kilku listach. Pola już ginęły w ten sposób.', verdict: 'potwierdzone', change: 'Co najmniej 6 list i 3 udokumentowane utraty, nie 2.', evidence: ['r5/6-design-and-code.md'] },
  { id: 'C-056', area: 'Kod OpenLinkera', text: 'Reszty z zaokrągleń rabatu i dostawy mogą trafić na linię 0,00.', verdict: 'potwierdzone', change: 'Węższe warunki, kwota kilku groszy.', evidence: ['discount-rounding.types.ts:65-67', 'delivery-line.types.ts:581-587'] },
  { id: 'C-057', area: 'Kod OpenLinkera', text: 'Edycja operatora może tylko zmniejszać ilości, nie dodaje linii.', verdict: 'potwierdzone', evidence: ['order-edits.types.ts:76,288'] },
  { id: 'C-058', area: 'Kod OpenLinkera', text: 'Nowe sub-capability domyślnie guard-only, bo enabledCapabilities nie jest uzupełniane wstecz.', verdict: 'potwierdzone', change: '#2085 mówi, czego nie ogłaszać, a nie że ma być opcjonalne. ADR-046 wybrał metodę wymaganą na porcie.', evidence: ['r5/6-design-and-code.md'] },
  { id: 'C-059', area: 'Kod OpenLinkera', text: 'OrderCreateStockEffect odpowiada per zamówienie, nie per linia.', verdict: 'potwierdzone', evidence: ['order-create-stock-effect.capability.ts'] },
  { id: 'C-060', area: 'Kod OpenLinkera', text: 'adjustInventory w PrestaShop zapisuje tylko własny wiersz stanu paku.', verdict: 'potwierdzone', live: true, change: 'Test: w żadnym typie paku zapis nie dociera do składników. Przy typie 1 nie zmienia nic, co sklep sprzedaje.', evidence: ['verify/prestashop-live.md §Q5', 'prestashop-inventory-master.adapter.ts:909-946'] },
  { id: 'C-069', area: 'Kod OpenLinkera', text: 'Pod routingiem OMS sprzedaż paku PrestaShop obniża tylko wiersz paku. Składniki nie spadają: ciche przesprzedanie.', verdict: 'potwierdzone', live: true, change: 'Nowe. Najważniejsza wada do naprawy przed pilotem.', evidence: ['verify/prestashop-live.md §Q5', 'r5/7-scope-overengineering.md'] },
  { id: 'C-061', area: 'Kod OpenLinkera', text: 'Warianty powstają tylko z synchronizacji mastera.', verdict: 'potwierdzone', evidence: ['master-product-sync.service.ts:290'] },
  { id: 'C-062', area: 'Kod OpenLinkera', text: 'order.received odpala przed rezerwacją i routingiem.', verdict: 'potwierdzone', evidence: ['order-ingestion.service.ts:664-772'] },
  { id: 'C-077', area: 'Kod OpenLinkera', text: 'order.received nigdy nie odpala dla zamówienia, które było kiedyś awaiting_mapping.', verdict: 'prawdopodobne', change: 'Nowe, z czytania kodu.', evidence: ['order-ingestion.service.ts:480,628,670-672', 'r5/6-design-and-code.md N-1'] },
  { id: 'C-072', area: 'Kod OpenLinkera', text: 'Identyfikator składnika {lineId}~c:{wariant} mieści się w obecnych kolumnach, ale wymaga zmian w 9 miejscach.', verdict: 'potwierdzone', change: 'Nowe. Edycje zamówienia i zwrot przyjmujący zestaw cicho pomijają składniki.', evidence: ['verify/component-line-id.md'] },

  // Merchant voice
  { id: 'C-063', area: 'Głos sprzedawców', text: 'Główny ból: rozjazd stanów zestawów i składników, przesprzedanie.', verdict: 'potwierdzone', evidence: ['r1/phase1', 'r2/phase1', 'r3/phase1/5-merchant-voice.md', 'r4/phase1/5-merchant-voice.md'] },
  { id: 'C-064', area: 'Głos sprzedawców', text: 'Główny ból: ile zwrócić za część zestawu sprzedanego z rabatem.', verdict: 'potwierdzone', evidence: ['r1/phase1', 'r2/phase1', 'r3/phase1/5-merchant-voice.md'] },
  { id: 'C-065', area: 'Głos sprzedawców', text: 'Główny ból: gratisu nie ma w zamówieniu, więc nie ma dowodu przy sporze i zwrocie.', verdict: 'potwierdzone', evidence: ['r1/phase1', 'r2/phase1', 'r4/phase1/5-merchant-voice.md'] },
  { id: 'C-066', area: 'Głos sprzedawców', text: 'Gratis kończy się w trakcie promocji, a regulatorzy już to oceniali (UK ASA).', verdict: 'prawdopodobne', evidence: ['r2/phase1'] },
  { id: 'C-067', area: 'Głos sprzedawców', text: 'Limity gratisów na klienta obchodzi się nowym adresem e-mail.', verdict: 'prawdopodobne', change: 'Shopify liczy limit po e-mailu lub telefonie (potwierdzone), sam proceder z forów.', evidence: ['r2/phase1', 'r4/phase2/5-shopify.md'] },
];
