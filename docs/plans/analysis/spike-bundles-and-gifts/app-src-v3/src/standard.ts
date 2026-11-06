/**
 * The proposed standard after rounds 1-5: channel shapes, fields, declarations,
 * code impact, counterarguments and scope. Polish copy for the conclusion tabs.
 */
import type { ChannelExample } from './data';

export const SCENARIO =
  'Kupujący zamawia "Zestaw kuchenny" za 129,00 zł: książka kucharska (cena osobno 69,00 zł, VAT 5%) i fartuch (79,00 zł, VAT 23%). Sklep obiecał zakładkę za 4,99 zł (VAT 23%) gratis.';

const DOCS_PILOT = 'Pilot: paragon i faktura zostają na linii zestawu, 129,00 zł w jednej stawce. Przy mieszanym VAT OL ostrzega już przy definicji.';
const DOCS_LATER = 'Później (po doradcy): podział z cen osobno, książka 60,14 zł (5%), fartuch 68,86 zł (23%), zapisany na zamówieniu.';
const GIFT_DOC = 'Gratis w tej samej stawce co płatna linia: pominięty na paragonie. W innej stawce: odmowa z nazwanym powodem.';

export const CHANNELS: ChannelExample[] = [
  {
    id: 'allegro',
    label: 'Allegro',
    shape: 'Sam zestaw (oferta z productSet)',
    wire: [
      { text: 'lineItems[0].offer.id: "15382947761"   quantity: 1  (liczba zestawów)' },
      { text: 'offer.productSet.products: [ { id: "c1f…", quantity: 1 }, { id: "9ab…", quantity: 1 } ]', tone: 'warn' },
      { text: 'price.amount: "129.00"  (cena jednego zestawu)   tax.rate: "23.00"' },
      { text: 'Dopłata Allegro Ceny tylko w lineItems[].reconciliation', tone: 'muted' },
      { text: 'Gratisu nie ma w zamówieniu, był tylko w opisie oferty', tone: 'muted' },
    ],
    neutral: [
      { key: 'L1', name: 'Zestaw kuchenny', role: 'zestaw', group: 'g1', qty: 1, paid: '129,00', origin: 'kanał' },
      { key: 'L1~c:książka', name: 'Książka kucharska', role: 'składnik', group: 'g1', qty: 1, paid: '-', origin: 'rozwinięcie zamrożone w OL' },
      { key: 'L1~c:fartuch', name: 'Fartuch', role: 'składnik', group: 'g1', qty: 1, paid: '-', origin: 'rozwinięcie zamrożone w OL' },
    ],
    declares: ['Rozpoznanie: oferta zmapowana na wariant, który ma definicję zestawu w OL', 'productSet tylko do kontroli: UUID katalogu Allegro nie mapują się na warianty OL'],
    core: ['Rezerwuje, kieruje i zdejmuje stan składników (id L1~c:wariant)', 'Gratis w pilocie: notatka dla pakowacza i ręczna korekta stanu', DOCS_PILOT],
    gap: 'Od 12.01.2027 multipack to oferta z productSet i ilością > 1. "3 x A" nie ma wariantu w masterze, więc bez definicji OL zdejmie 1 sztukę zamiast 3. Takie zamówienie trzeba zatrzymać.',
  },
  {
    id: 'prestashop',
    label: 'PrestaShop',
    shape: 'Sam zestaw (pak) + gratis z reguły koszyka',
    wire: [
      { text: 'order_detail: { product_id: 21 (pak), quantity: 1, tax: 23% }  jedna stawka, składników brak', tone: 'warn' },
      { text: 'order_detail: { product_id: 8 (zakładka), quantity: 1, unit_price_tax_incl: 4.99 }  pełna cena' },
      { text: 'order_cart_rules: [ { value: 4.99 } ], cart_rules.gift_product = 8' },
      { text: 'Ten sam produkt jako gratis: jeden wiersz z ilością 2', tone: 'muted' },
      { text: 'Skład paku tylko w produkcie, zmiana składu zmienia też stare zamówienia', tone: 'muted' },
    ],
    neutral: [
      { key: 'L1', name: 'Zestaw kuchenny', role: 'zestaw', group: 'g1', qty: 1, paid: '129,00', origin: 'kanał' },
      { key: 'L1~c:książka', name: 'Książka kucharska', role: 'składnik', group: 'g1', qty: 1, paid: '-', origin: 'rozwinięcie zamrożone w OL' },
      { key: 'L1~c:fartuch', name: 'Fartuch', role: 'składnik', group: 'g1', qty: 1, paid: '-', origin: 'rozwinięcie zamrożone w OL' },
      { key: 'L2', name: 'Zakładka', role: 'gratis', qty: 1, paid: '4,99', list: '4,99', reduction: 'w regule koszyka zamówienia', origin: 'kanał' },
    ],
    declares: ['Etap 0: adjustInventory odmawia zapisu dla paku liczonego ze składników (typ 1 i 2)', 'Później: skład i tryb stanu paku jako pole trzystanowe produktu'],
    core: ['Bez definicji w OL pak pod routingiem zdejmuje dziś tylko własny wiersz: ciche przesprzedanie', 'Gratis z innym produktem jest zwykłą linią po pełnej cenie, rabat tylko na poziomie zamówienia', DOCS_PILOT],
    gap: 'Komentarz w mapperze PrestaShop o osobnej linii gratisu jest prawdziwy tylko dla innego produktu.',
  },
  {
    id: 'shoper',
    label: 'Shoper',
    shape: 'Zestaw ze składnikami (wg SDK)',
    wire: [
      { text: 'order-products[0]: { type: "1", price: 129.00, children: [ … ] }', tone: 'warn' },
      { text: 'Dokumentacja REST za logowaniem, kształt niezweryfikowany na żywo', tone: 'muted' },
      { text: 'Gratis z aplikacji: wariant za 0,01-1 zł, bez flagi', tone: 'muted' },
    ],
    neutral: [
      { key: 'L1', name: 'Zestaw kuchenny', role: 'zestaw', group: 'g1', qty: 1, paid: '129,00', origin: 'kanał' },
    ],
    declares: ['Ustawienie lub wartość w manifeście: czy kanał wysyła dzieci jako osobne linie', 'Do sprawdzenia na żywo w sklepie testowym'],
    core: ['Adapter dziś pomija type i children', 'Jeśli dzieci przyjdą też jako płaskie wiersze, grozi podwójna rezerwacja'],
    gap: 'Nie wiadomo, czy dzieci są zagnieżdżone, czy płaskie. Bez testu na żywo nie wolno włączać zestawów na Shoperze.',
  },
  {
    id: 'woocommerce',
    label: 'WooCommerce',
    shape: 'Zestaw i składniki (wtyczki)',
    wire: [
      { text: 'line_items[0]: { name: "Zestaw kuchenny", total: "129.00", bundled_items: [2, 3] }' },
      { text: 'line_items[1]: { name: "Książka kucharska", total: "0.00", bundled_by: 1 }', tone: 'warn' },
      { text: 'line_items[2]: { name: "Fartuch", total: "0.00", bundled_by: 1 }', tone: 'warn' },
    ],
    neutral: [
      { key: 'L1', name: 'Zestaw kuchenny', role: 'zestaw', group: 'g1', qty: 1, paid: '129,00', origin: 'kanał' },
      { key: 'L2', name: 'Książka kucharska', role: 'składnik', group: 'g1', qty: 1, paid: '0,00', origin: 'kanał' },
      { key: 'L3', name: 'Fartuch', role: 'składnik', group: 'g1', qty: 1, paid: '0,00', origin: 'kanał' },
    ],
    declares: ['Wartość w manifeście: wysyła dzieci jako linie', 'Pilot: definicja zestawu w OL na takim kanale odrzucana'],
    core: ['Bez tego OL rozwinie kontener z definicji i dostanie dzieci drugi raz'],
    gap: 'Każda wtyczka zapisuje to inaczej. WPC łączy dzieci po id produktu, co psuje się przy dwóch takich samych zestawach.',
  },
  {
    id: 'marketplace',
    label: 'Erli, Kaufland, Empik',
    shape: 'Zestaw jako zwykły SKU',
    wire: [
      { text: 'Erli items[0]: { unitPrice, unitPriceBeforeRebate }, rabat na zamówieniu bez kwoty', tone: 'warn' },
      { text: 'Kaufland: jedna order_unit na sztukę, promocje Kauflandu niewidoczne', tone: 'muted' },
      { text: 'Empik (Mirakl): promotions[].offered_quantity = darmowe sztuki', tone: 'muted' },
    ],
    neutral: [
      { key: 'L1', name: 'Zestaw kuchenny', role: 'zestaw', group: 'g1', qty: 1, paid: '129,00', origin: 'kanał' },
      { key: 'L1~c:książka', name: 'Książka kucharska', role: 'składnik', group: 'g1', qty: 1, paid: '-', origin: 'rozwinięcie zamrożone w OL' },
      { key: 'L1~c:fartuch', name: 'Fartuch', role: 'składnik', group: 'g1', qty: 1, paid: '-', origin: 'rozwinięcie zamrożone w OL' },
    ],
    declares: ['Rozpoznanie po mapowaniu oferty', 'Mirakl: jedyna flaga darmowych sztuk na linii (nie wiadomo, czy wliczona w quantity)'],
    core: ['Erli: zamówienia w EUR zapisywane dziś jako PLN, do naprawy niezależnie od zestawów', DOCS_PILOT],
  },
];

export const DOC_NOTES = [DOCS_PILOT, DOCS_LATER, GIFT_DOC];

export interface StdItem {
  name: string;
  kind: 'pole' | 'wartość w manifeście' | 'ustawienie operatora' | 'metoda wymagana' | 'capability guard-only' | 'tabela' | 'konwencja';
  where: string;
  what: string;
  absent: string;
  when: 'Etap 0' | 'Etap 1' | 'Później';
}

export const STANDARD: StdItem[] = [
  { name: 'order_line_bundle_expansions', kind: 'tabela', where: 'zamówienie w OL', what: 'zamrożone przy pierwszym "ready": oceniane linie (też te bez zestawu), wariant zestawu, productId i wariant składnika, ilość na sztukę, wersja definicji, cena katalogowa składnika', absent: 'zamówienie sprzed definicji, nigdy nie rozwijane później', when: 'Etap 1' },
  { name: '{lineId}~c:{wariant}', kind: 'konwencja', where: 'rezerwacje, linie pracy, klucze zdjęcia stanu', what: 'identyfikator linii składnika, liczony z rozwinięcia, nigdy parsowany. Segment ~g: zarezerwowany na gratis', absent: 'zwykła linia: id linii zamówienia, bez zmian', when: 'Etap 1' },
  { name: 'emitsBundleChildrenAsLines', kind: 'wartość w manifeście', where: 'adapter źródła zamówień', what: 'czy kanał wysyła dzieci zestawu jako osobne linie (wzór variantGrouping, najbardziej restrykcyjny domyślny)', absent: 'traktowane jak "tak": definicja zestawu odrzucana', when: 'Etap 1' },
  { name: 'compositionHint', kind: 'pole', where: 'linia zamówienia z kanału, trzystanowe', what: 'np. Allegro productSet: liczba produktów i ilości, tylko do kontroli', absent: 'kanał nic nie mówi', when: 'Później' },
  { name: 'listUnitPriceGross', kind: 'pole', where: 'linia zamówienia z kanału, trzystanowe', what: 'cena przed obniżką od kanału. Uwaga: przy Allegro Ceny i CAMPAIGN równa cenie zapłaconej', absent: 'nieznana, nie "bez obniżki"', when: 'Później' },
  { name: 'adjustments', kind: 'pole', where: 'zamówienie', what: 'source, trigger, funder, form (kwota / darmowe sztuki z targetLineId i freeQuantity), qualifyingLineIds, podział na linie', absent: 'kanał nie zgłasza obniżek', when: 'Później' },
  { name: 'Product.composition', kind: 'pole', where: 'produkt z mastera, trzystanowe (wzór gpsr)', what: 'skład paku i tryb stanu (ze składników / własny / oba)', absent: 'master nie mówi', when: 'Później' },
  { name: 'Limity urządzenia dokumentu', kind: 'metoda wymagana', where: 'InvoicingPort i FiscalizationPort (ADR-046)', what: 'linia 0, stawka z wartością 0, rabat na linii, minimalna wartość linii; odczyt z declared i resolvedVia', absent: 'pominięcie i odmowa z powodem, nigdy cicha zmiana dokumentu', when: 'Później' },
  { name: 'Gratis i zestaw na dokumencie', kind: 'ustawienie operatora', where: 'połączenie dokumentów (wzór ADR-082)', what: 'gratis: pomiń / odmów / forma zatwierdzona przez doradcę; zestaw: jedna linia / składniki', absent: 'dzisiejsze zachowanie', when: 'Później' },
  { name: 'OrderLineAdder', kind: 'capability guard-only', where: 'sklep docelowy', what: 'dopisanie linii gratisu dodanej w OL do zamówienia w sklepie', absent: 'gratis tylko w OL', when: 'Później' },
];

export const DROPPED = [
  { name: 'MasterBundleStockReader', why: 'Skład i tryb stanu to dane produktu, więc pole trzystanowe, nie capability.' },
  { name: 'OrderCreateLineStockEffect', why: 'Pilot ma OMS i routing. PrestaShop już odpowiada "nie" dla paku, a WooCommerce nie umie odpowiedzieć per linia.' },
  { name: 'BundleListingSupportDeclarer', why: 'Deklaracja bez ścieżki zapisu niczego nie opisuje. ADR-048: bez interfejsu bez implementacji.' },
  { name: 'Reportery źródła jako capability', why: 'Nazwa capability w manifeście trafia do enabledCapabilities przy tworzeniu połączenia. Fakt o platformie to wartość w manifeście.' },
  { name: '"2-4 deklaracje" jako koszt', why: 'Każda deklaracja guard-only to jeszcze odczyt na serwerze i lustro na froncie (ADR-046).' },
];

export interface CodeSite {
  site: string;
  what: string;
  action: 'zmienić' | 'zablokować' | 'bez zmian' | 'spec';
}

export const CODE_SITES: CodeSite[] = [
  { site: 'order-ingestion.service.ts:2236-2243', what: 'Rezerwacje z linii zamówienia', action: 'zmienić' },
  { site: 'project-order-for-routing.ts:47-52', what: 'Projekcja do routingu (przyjęcie, route handler, dry run)', action: 'zmienić' },
  { site: 'inventory-sale-decrement.handler.ts:90-117', what: 'Składnik nie trafia w itemsById: log "NOT lowered", job kończy się ok', action: 'zmienić' },
  { site: 'fulfillment-order-edit.service.ts:41-84', what: 'Ocena edycji i obniżenie ilości nie widzą linii składników', action: 'zablokować' },
  { site: 'reservation.service.ts:247-261', what: 'narrowForOrder nie znajduje rezerwacji składników', action: 'zablokować' },
  { site: 'inventory-sale-reversal.service.ts:155-200', what: 'Zwrot stanu po edycji: not-applicable', action: 'zablokować' },
  { site: 'order-sync.service.ts:443, :515', what: 'Odświeżenie stanu po utworzeniu i rezerwacje wchłonięte przez mastera. Bezpieczne przypadkiem', action: 'spec' },
  { site: 'return-custody.service.ts:931-940', what: 'Zwrot zestawu wraca na stan wariantu zestawu', action: 'zablokować' },
  { site: 'offer-stock-restore.service.ts:350', what: 'Anulowanie publikuje stan tylko ofert zestawu', action: 'zmienić' },
  { site: 'IAvailabilityService (publish path)', what: 'ATP zestawu i przeliczenie po zmianie składnika, token = maks. składników, nieaktualny składnik = zestaw nieaktualny', action: 'zmienić' },
  { site: 'shipment-line.service.ts:113-118', what: 'Linie przesyłki zostają na linii zestawu', action: 'bez zmian' },
  { site: 'routing.types.ts:261-296', what: 'Kontrola ilości działa z id składników', action: 'bez zmian' },
];

export const STAGE0 = [
  { title: 'PrestaShop: odmowa zapisu stanu paku liczonego ze składników', size: 'S', why: 'Dziś pak pod routingiem zdejmuje tylko własny wiersz, składniki zostają: ciche przesprzedanie (test na żywo).' },
  { title: 'Reszty z zaokrągleń rabatu i dostawy poza linią 0,00', size: 'S', why: 'Kilka groszy na linii gratisu. Poprawka musi pilnować, żeby stawka nie spadła do 0.' },
  { title: 'eparagony: kontrola przed wysłaniem i czytelny powód błędu 41', size: 'S', why: 'Gratis sam w stawce zatrzymuje paragon z niejasnym błędem.' },
  { title: 'Allegro: zatrzymanie zamówienia multipacku bez definicji', size: 'S', why: 'productSet z ilością > 1 na ofercie zmapowanej na pojedynczy wariant zdejmuje 1 sztukę zamiast N.' },
  { title: 'Erli: waluta EUR i stawki spoza PL', size: 'S', why: 'Zamówienia EUR księgowane jako PLN. Niezależne od zestawów.' },
  { title: 'Allegro: płatne pakowanie na prezent poza liniami', size: 'S', why: 'Opłata jest w totalToPay, a mapper jej nie czyta. Dokument nie sumuje się i zostaje zablokowany albo opłata trafia do dostawy.' },
  { title: 'Shoper: jeden odczyt na żywo kształtu zestawu w sklepie testowym', size: 'S', why: 'Jeśli dzieci przychodzą też jako płaskie wiersze, zestawów na Shoperze nie wolno włączać.' },
  { title: 'Proces: gratis jako notatka dla pakowacza, koszt zestawu na wariancie', size: '0', why: 'Bez kodu. Migawki kosztu nie są uzupełniane później.' },
];

export interface Counter {
  from: string;
  claim: string;
  response: string;
  accepted: 'przyjęte' | 'częściowo' | 'odrzucone';
}

export const COUNTERS: Counter[] = [
  { from: 'R5-7', claim: 'Zakres ze spike jest przeinżynierowany: 55-95 dni wobec 15-25 w G15.', response: 'Etapy z bramkami. Pilot to etap 0 zawsze i etap 1 warunkowo.', accepted: 'przyjęte' },
  { from: 'R5-7', claim: 'Spike pominął prawdziwą wadę pilota: dekrementację paku PrestaShop pod routingiem.', response: 'Potwierdzone na żywo, pierwsza pozycja etapu 0.', accepted: 'przyjęte' },
  { from: 'R5-6', claim: 'Rozwinięcie w toDomain (efektywne linie) jest tańsze niż przewlekanie identyfikatora składnika.', response: 'Wtedy dokumenty czytają składniki i wymagają ceny składnika w pilocie, czyli decyzji doradcy. Zostaje identyfikator pochodny tylko w realizacji.', accepted: 'odrzucone' },
  { from: 'R5-6', claim: 'Pola trzystanowe nie wystarczą dla kształtu rodzic plus dzieci.', response: 'Wartość w manifeście albo ustawienie operatora, w pilocie odmowa definicji.', accepted: 'przyjęte' },
  { from: 'R5-6', claim: 'Deklaracja dokumentu powinna być metodą wymaganą, nie guard-only.', response: 'Przyjęte dla portów faktur i paragonów, wszystkie adaptery są nasze.', accepted: 'przyjęte' },
  { from: 'R5-6', claim: 'Wybór "zestaw jako składniki przy mieszanym VAT" jako domyślny w core łamie ADR-063.', response: 'Ustawienie operatora, nie domyślne w core.', accepted: 'przyjęte' },
  { from: 'R5-8', claim: 'Cena katalogowa + rabat 100% to według KIS 2026 nieodpłatna dostawa.', response: 'Rekomendacja z rund 1-2 wycofana. Forma gratisu to ustawienie operatora po doradcy.', accepted: 'przyjęte' },
  { from: 'R5-8', claim: 'REBATE bez stawki na eparagony nie daje złego VAT, tylko podział proporcjonalny.', response: 'C-029 przeniesione do spornych. Nadal wysyłamy REBATE ze stawką, bo jest jednoznaczne.', accepted: 'częściowo' },
  { from: 'R5-5', claim: 'Nie wszyscy zabraniają zestawów w zestawie (Cin7 pozwala).', response: 'Teza poprawiona, zakaz zostaje jako wybór OL.', accepted: 'częściowo' },
  { from: 'R5-5', claim: 'Podział ceny przy definicji ma tańszą alternatywę: przy sprzedaży z cen składników (Shopify).', response: 'Przyjęte jako domyślne, nadpisanie opcjonalne (Q11).', accepted: 'przyjęte' },
  { from: 'R5-5', claim: 'Teza "nikt nie ma wspólnego standardu" przeczy C-044 (Shopify ma).', response: 'Zawężone: nikt nie normalizuje kształtów innych kanałów przez deklaracje adapterów.', accepted: 'częściowo' },
  { from: 'Stress-test', claim: 'ATP zestawu nie ma wyzwalacza przeliczenia.', response: 'Dodane do etapu 1: odwrotne rozgłoszenie składnik -> zestawy.', accepted: 'przyjęte' },
  { from: 'Stress-test', claim: 'Rozwinięcie wzięte za późno daje podwójne rezerwacje.', response: 'Dodany negatywny fakt per zamówienie w transakcji pierwszego "ready".', accepted: 'przyjęte' },
  { from: 'Stress-test', claim: 'Multipack Allegro po 2027 zdejmie 1 sztukę zamiast N.', response: 'Zatrzymanie takiego zamówienia w etapie 0.', accepted: 'przyjęte' },
  { from: 'Weryfikacja', claim: 'Identyfikator składnika wymaga zmian w 9 miejscach, nie 3.', response: 'Lista w zakładce "Wpływ na kod", 4 miejsca blokowane zamiast budowane.', accepted: 'przyjęte' },
];

export const CLIENT_QUESTIONS = [
  'Na których kanałach są zestawy i gratisy?',
  'Na Allegro: zestaw jako oferta z productSet, multipack czy pakiet ofert?',
  'Czy na półce są gotowe boksy prezentowe ze stanem?',
  'Jak dziś obiecujecie i dokładacie gratisy?',
  'Paragony przez eparagony czy Subiekt? Czy zestawy mają składniki w różnych stawkach VAT?',
  'Czy paki są w PrestaShop, i w jakim trybie stanu (pack_stock_type)?',
];

export const ADVISER_QUESTIONS = [
  'Czy forma pokazania decyduje: 0 zł lub rabat 100% daje nieodpłatną dostawę, a dodatnia cena przydzielona daje odpłatną? KIS 2026 wobec interpretacji z 2015-2016.',
  'Czy podział proporcjonalny według cen katalogowych obroni się jako podstawa w różnych stawkach?',
  'Czy gratis finansowany przez marketplace zmienia klasyfikację?',
  'Gratis w innej stawce niż płatna linia: pominąć, przenieść wartość czy wewnętrzna ewidencja?',
  'Zestaw droższy niż suma składników: jak podzielić, skoro proporcja łamie test BFH?',
];

export interface IssueDraft {
  ref: string;
  title: string;
  change: string;
  stage: 'Etap 0' | 'Etap 1' | 'Etap 2' | 'Etap 3';
}

export const ISSUES: IssueDraft[] = [
  { ref: 'nowe', title: '[BUG] PrestaShop - routed sale decrement of a components-mode pack must not write the pack row', change: 'Odmowa z typowanym błędem, zapis jako blocked, attention stock-decrement-blocked.', stage: 'Etap 0' },
  { ref: 'nowe', title: '[BUG] CORE - discount and delivery remainders must not land on a zero-gross line', change: 'Pominąć linie 0, pilnować stawki z wartością 0.', stage: 'Etap 0' },
  { ref: 'nowe', title: '[BUG] eparagony - pre-check VAT rate value and readable cause for error 41', change: 'Kontrola przed wysłaniem.', stage: 'Etap 0' },
  { ref: 'nowe', title: '[BUG] Allegro - hold a productSet order with quantity > 1 on a single-variant mapping', change: 'Zatrzymanie z powodem do czasu definicji zestawu.', stage: 'Etap 0' },
  { ref: 'nowe', title: '[BUG] Erli - EUR orders booked as PLN, non-PL tax rates labelled PL', change: 'Niezależne od zestawów.', stage: 'Etap 0' },
  { ref: 'nowe', title: '[BUG] Allegro - paid gift wrap (GIFT_WRAP) is not mapped and blocks the sales document', change: 'Linia usługi albo opłata dodatkowa, suma dokumentu równa totalToPay.', stage: 'Etap 0' },
  { ref: '#3606', title: 'Bundle spec', change: 'Dopisać: identyfikator pochodny, tabela rozwinięcia z negatywnym faktem, ATP z wyzwalaczem, blokady edycji i zwrotów, multipack Allegro, kanały wysyłające dzieci.', stage: 'Etap 1' },
  { ref: '#3607', title: 'Bundle definitions and expansion', change: 'Bez ceny w zestawie w pilocie. Zamrozić ceny katalogowe składników w rozwinięciu. Zakaz zagnieżdżania i definicji na kanale z dziećmi.', stage: 'Etap 1' },
  { ref: '#3624', title: 'Bundle frontend', change: 'Panel definicji, linie składników na stanowisku z "Część: zestaw". Podsumowanie na żywo później.', stage: 'Etap 1' },
  { ref: '#3625', title: 'Bundle E2E', change: 'Jedna ścieżka: definicja, zamówienie Allegro, rezerwacja i zbieranie składników, dokument z linią zestawu.', stage: 'Etap 1' },
  { ref: 'nowe', title: '[FEATURE] CORE - bundle documents and component returns from the price split', change: 'Po doradcy. Podział z cen osobno, zapisany na zamówieniu.', stage: 'Etap 2' },
  { ref: 'nowe G20', title: '[EPIC] Free gifts', change: 'Pola obniżek, dodawanie linii w core, reguła gratisu, polityka braku gratisu, forma na dokumencie jako ustawienie, OrderLineAdder.', stage: 'Etap 3' },
];
