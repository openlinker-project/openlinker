/**
 * Spike v2 content: bundles (zestawy) and free gifts (gratisy).
 * Run 1 and run 2 research reports, 2026-11-04 (scratchpad/spike/phase*, run2/*).
 */

export type Cov = 'F' | 'P' | 'N' | 'U';

export const COMPETITORS = ['BaseLinker', 'Apilo', 'Sellasist', 'Linnworks', 'Shopify', 'Cin7', 'Brightpearl'] as const;

export interface MatrixRow {
  id: string;
  label: string;
  /** Run 2 rating per competitor. */
  r2: Cov[];
  /** Run 1 rating per competitor; null when the case did not exist in run 1. */
  r1: Cov[] | null;
  note?: string;
}

export const BUNDLE_MATRIX: MatrixRow[] = [
  { id: 'B-01', label: 'Definicja zestawu', r2: ['F', 'F', 'F', 'F', 'F', 'F', 'F'], r1: ['F', 'F', 'F', 'F', 'F', 'F', 'F'] },
  { id: 'B-02', label: 'Stan zestawu ze składników', r2: ['F', 'P', 'F', 'F', 'F', 'F', 'F'], r1: ['F', 'P', 'F', 'F', 'P', 'F', 'F'], note: 'Shopify: runda 1 obniżyła ocenę za liczenie stanu z sumy magazynów.' },
  { id: 'B-03', label: 'Gotowy zestaw z własnym stanem', r2: ['N', 'P', 'P', 'P', 'P', 'F', 'P'], r1: ['N', 'P', 'P', 'P', 'N', 'F', 'P'] },
  { id: 'B-04', label: 'Rozbicie zestawu z kanału na składniki', r2: ['F', 'F', 'F', 'F', 'N', 'F', 'F'], r1: ['F', 'F', 'F', 'F', 'N', 'F', 'F'] },
  { id: 'B-05', label: 'Kanał przysyła zestaw i składniki', r2: ['N', 'N', 'N', 'P', 'N', 'U', 'U'], r1: ['U', 'U', 'U', 'P', 'N', 'N', 'U'], note: 'Tylko Linnworks, i tylko dla Magento. Pozostali liczą podwójnie albo milczą.' },
  { id: 'B-09', label: 'Zestaw z wyborem wariantu', r2: ['P', 'N', 'F', 'N', 'P', 'P', 'N'], r1: ['P', 'N', 'F', 'P', 'P', 'P', 'N'] },
  { id: 'B-11', label: 'Pakowanie: zestaw i składniki, skan', r2: ['P', 'P', 'P', 'F', 'P', 'P', 'F'], r1: ['P', 'P', 'P', 'P', 'P', 'P', 'F'] },
  { id: 'B-12', label: 'Brakuje składnika', r2: ['P', 'P', 'P', 'P', 'N', 'P', 'P'], r1: ['P', 'P', 'P', 'P', 'P', 'P', 'P'] },
  { id: 'B-14', label: 'Podział ceny na stawki VAT', r2: ['P', 'P', 'P', 'P', 'P', 'N', 'P'], r1: ['P', 'P', 'P', 'P', 'F', 'P', 'P'], note: 'Shopify: wzór podziału nie jest opublikowany. Cin7: zestaw zawsze 1 linia z 1 stawką.' },
  { id: 'B-15', label: 'Zwrot jednego składnika', r2: ['P', 'P', 'N', 'P', 'P', 'P', 'U'], r1: ['P', 'P', 'P', 'P', 'P', 'P', 'P'] },
  { id: 'B-16', label: 'Koszt zestawu = suma składników', r2: ['P', 'U', 'F', 'P', 'N', 'F', 'P'], r1: ['U', 'U', 'F', 'P', 'P', 'F', 'P'] },
  { id: 'B-18', label: 'Import definicji zestawów', r2: ['P', 'N', 'P', 'N', 'N', 'P', 'N'], r1: ['F', 'N', 'P', 'P', 'N', 'P', 'N'] },
  { id: 'B-19', label: 'Która linia niesie cenę i VAT', r2: ['N', 'P', 'N', 'P', 'F', 'P', 'P'], r1: null, note: 'Nowy przypadek z rundy 2.' },
  { id: 'B-21', label: 'Zestaw w kilku paczkach, "wysłano" do kanału', r2: ['P', 'P', 'P', 'P', 'P', 'P', 'P'], r1: null, note: 'Brightpearl zgłasza "wysłano" po pierwszym składniku.' },
];

export const GIFT_MATRIX: MatrixRow[] = [
  { id: 'G-01', label: 'Gratis oznaczony przez kanał', r2: ['P', 'N', 'N', 'N', 'N', 'N', 'N'], r1: ['P', 'U', 'U', 'N', 'N', 'N', 'N'] },
  { id: 'G-05', label: 'Operator dodaje gratis', r2: ['F', 'F', 'F', 'F', 'P', 'P', 'P'], r1: ['F', 'P', 'F', 'F', 'F', 'P', 'F'] },
  { id: 'G-06', label: 'Reguła dodaje gratis', r2: ['P', 'P', 'F', 'P', 'P', 'P', 'F'], r1: ['P', 'P', 'P', 'P', 'P', 'P', 'P'] },
  { id: 'G-07', label: 'Gratis jako składnik zestawu', r2: ['P', 'F', 'P', 'P', 'P', 'P', 'P'], r1: ['U', 'F', 'U', 'U', 'U', 'F', 'P'] },
  { id: 'G-08', label: 'Gratis się skończył', r2: ['N', 'P', 'P', 'N', 'N', 'N', 'N'], r1: ['N', 'N', 'N', 'N', 'P', 'N', 'N'], note: 'W obu rundach nikt nie zamienia gratisu ani nie powiadamia kupującego.' },
  { id: 'G-09', label: 'Gratis na stole pakowania', r2: ['P', 'P', 'F', 'P', 'P', 'P', 'F'], r1: ['P', 'P', 'F', 'P', 'P', 'P', 'P'] },
  { id: 'G-10', label: 'Gratis na paragonie i fakturze', r2: ['P', 'P', 'P', 'P', 'P', 'P', 'P'], r1: ['P', 'U', 'F', 'P', 'P', 'P', 'P'] },
  { id: 'G-11', label: 'Gratis przy zwrocie', r2: ['N', 'N', 'N', 'N', 'P', 'N', 'N'], r1: ['P', 'U', 'U', 'N', 'N', 'N', 'N'] },
  { id: 'G-12', label: 'Raport kosztu gratisów', r2: ['N', 'N', 'N', 'P', 'P', 'P', 'P'], r1: ['N', 'U', 'P', 'N', 'P', 'P', 'P'] },
  { id: 'G-15', label: 'Limit gratisów na klienta', r2: ['P', 'N', 'N', 'N', 'P', 'P', 'P'], r1: null, note: 'Nowy przypadek z rundy 2. Wszędzie da się go obejść nowym e-mailem.' },
];

/* ── Channel mapper: one scenario, six channels ─────────────────────────── */

export interface WireLine {
  text: string;
  tone?: 'muted' | 'warn';
}
export interface NeutralLine {
  key: string;
  name: string;
  role: 'zwykła' | 'zestaw' | 'składnik' | 'gratis';
  group?: string;
  qty: number;
  paid: string;
  list?: string;
  reduction?: string;
  origin: string;
}
export interface ChannelExample {
  id: string;
  label: string;
  shape: string;
  wire: WireLine[];
  neutral: NeutralLine[];
  declares: string[];
  core: string[];
  gap?: string;
}

export const SCENARIO =
  'Kupujący zamawia "Zestaw kuchenny" za 129,00 zł: książka kucharska (cena 69,00 zł, VAT 5%) i fartuch (79,00 zł, VAT 23%). Sklep dokłada zakładkę za 4,99 zł jako gratis.';

const DOC_LINES = [
  'Paragon: Książka kucharska 60,14 zł (5%), Fartuch 68,86 zł (23%), z ceny w zestawie',
  'Zakładka 4,99 zł z rabatem -4,99 zł na linii, jeśli adapter deklaruje rabat na linii',
];

export const CHANNELS: ChannelExample[] = [
  {
    id: 'allegro',
    label: 'Allegro',
    shape: 'Sam zestaw (oferta-zestaw)',
    wire: [
      { text: 'lineItems[0].offer.id: "15382947761"' },
      { text: 'offer.productSet.products: [ { id: "c1f…", quantity: 1 }, { id: "9ab…", quantity: 1 } ]' },
      { text: 'price.amount: "129.00"   tax.rate: "23.00"', tone: 'warn' },
      { text: 'Gratisu nie ma w zamówieniu, był tylko w opisie oferty', tone: 'muted' },
    ],
    neutral: [
      { key: 'L1', name: 'Zestaw kuchenny', role: 'zestaw', group: 'g1', qty: 1, paid: '129,00', origin: 'kanał' },
      { key: 'L1·1', name: 'Książka kucharska', role: 'składnik', group: 'g1', qty: 1, paid: '60,14', origin: 'definicja w OL' },
      { key: 'L1·2', name: 'Fartuch', role: 'składnik', group: 'g1', qty: 1, paid: '68,86', origin: 'definicja w OL' },
      { key: 'R1', name: 'Zakładka', role: 'gratis', qty: 1, paid: '0,00', list: '4,99', reduction: 'gratis · dodany regułą', origin: 'reguła OL' },
    ],
    declares: ['Źródło zamówień: podaje skład zestawu w linii (productSet)', 'Źródło zamówień: nie oznacza gratisów'],
    core: ['Zdejmuje stan: książka 1, fartuch 1, zakładka 1', 'Stół pakowania: nagłówek "Zestaw kuchenny", 2 składniki, gratis', ...DOC_LINES],
    gap: 'Allegro trzyma zestaw w jednej stawce 23%. Dokument z dwiema stawkami różni się od tego, co widzi kupujący w kanale.',
  },
  {
    id: 'shoper',
    label: 'Shoper',
    shape: 'Zestaw ze składnikami',
    wire: [
      { text: 'order-products[0]: { type: "1", price: 129.00, children: [' },
      { text: '  { code: "KS-01", quantity: 1, price: 60.14, tax: "5%" },' },
      { text: '  { code: "FA-02", quantity: 1, price: 68.86, tax: "23%" } ] }' },
      { text: 'order-products[1]: { name: "Zakładka (gratis)", price: 0.01 }', tone: 'warn' },
    ],
    neutral: [
      { key: 'L1', name: 'Zestaw kuchenny', role: 'zestaw', group: 'g1', qty: 1, paid: '129,00', origin: 'kanał' },
      { key: 'L1·1', name: 'Książka kucharska', role: 'składnik', group: 'g1', qty: 1, paid: '60,14', origin: 'kanał' },
      { key: 'L1·2', name: 'Fartuch', role: 'składnik', group: 'g1', qty: 1, paid: '68,86', origin: 'kanał' },
      { key: 'L2', name: 'Zakładka', role: 'gratis', qty: 1, paid: '0,01', list: '4,99', reduction: 'gratis · cena symboliczna', origin: 'reguła operatora 0,01' },
    ],
    declares: ['Źródło zamówień: podaje składniki z ceną i VAT', 'Źródło zamówień: nie oznacza gratisów (aplikacje ustawiają 0,01 zł)'],
    core: ['Składniki z kanału zgadzają się z definicją, więc nie liczymy ich drugi raz', 'Gratis rozpoznany tylko dzięki regule operatora "0,01 zł = gratis"', ...DOC_LINES],
    gap: 'Nasz adapter Shoper dziś pomija "type" i "children". Zestaw rezerwuje się jako 1 sztuka.',
  },
  {
    id: 'prestashop',
    label: 'PrestaShop',
    shape: 'Sam zestaw (pak) + gratis z reguły koszyka',
    wire: [
      { text: 'order_rows: [ { product_id: 501, product_price: 129.00, quantity: 1 },' },
      { text: '  { product_id: 77, unit_price_tax_incl: 4.99, quantity: 1 } ]', tone: 'warn' },
      { text: 'order_cart_rules: [ { name: "Gratis: zakładka", value: 4.99 } ]' },
      { text: 'Skład paku tylko w produkcie (product_bundle), bez zapisu przy zamówieniu', tone: 'muted' },
    ],
    neutral: [
      { key: 'L1', name: 'Zestaw kuchenny', role: 'zestaw', group: 'g1', qty: 1, paid: '129,00', origin: 'kanał' },
      { key: 'L1·1', name: 'Książka kucharska', role: 'składnik', group: 'g1', qty: 1, paid: '60,14', origin: 'migawka przy przyjęciu' },
      { key: 'L1·2', name: 'Fartuch', role: 'składnik', group: 'g1', qty: 1, paid: '68,86', origin: 'migawka przy przyjęciu' },
      { key: 'L2', name: 'Zakładka', role: 'gratis', qty: 1, paid: '0,00', list: '4,99', reduction: 'gratis · reguła koszyka', origin: 'kanał + reguła koszyka' },
    ],
    declares: ['Product master: podaje skład paku i tryb stanu paku', 'Sklep przy tworzeniu zamówienia: czy sam zdejmuje stan składników'],
    core: ['Zapisuje skład paku przy przyjęciu, bo sklep go nie zamraża', 'Nie zdejmuje stanu drugi raz, jeśli sklep już zdjął składniki', ...DOC_LINES],
    gap: 'Gratis jest wtopiony w zwykłą linię w pełnej cenie. Adapter musi połączyć zamówienie z regułą koszyka.',
  },
  {
    id: 'woocommerce',
    label: 'WooCommerce',
    shape: 'Zestaw i składniki po 0 zł',
    wire: [
      { text: 'line_items[0]: { name: "Zestaw kuchenny", total: "129.00", bundled_items: [2, 3] }' },
      { text: 'line_items[1]: { name: "Książka kucharska", total: "0.00", bundled_by: 1 }', tone: 'warn' },
      { text: 'line_items[2]: { name: "Fartuch", total: "0.00", bundled_by: 1 }', tone: 'warn' },
      { text: 'line_items[3]: { name: "Zakładka", total: "0.00", meta: _cfg_free_gift=yes }' },
    ],
    neutral: [
      { key: 'L1', name: 'Zestaw kuchenny', role: 'zestaw', group: 'g1', qty: 1, paid: '129,00', origin: 'kanał' },
      { key: 'L2', name: 'Książka kucharska', role: 'składnik', group: 'g1', qty: 1, paid: '60,14', origin: 'cena w zestawie' },
      { key: 'L3', name: 'Fartuch', role: 'składnik', group: 'g1', qty: 1, paid: '68,86', origin: 'cena w zestawie' },
      { key: 'L4', name: 'Zakładka', role: 'gratis', qty: 1, paid: '0,00', list: '4,99', reduction: 'gratis · flaga wtyczki', origin: 'kanał' },
    ],
    declares: ['Źródło zamówień: podaje rodzica i składniki, cena na rodzicu', 'Źródło zamówień: oznacza gratis flagą wtyczki'],
    core: ['Składniki po 0 zł dostają cenę w zestawie do dokumentów', 'Linie stanu i pakowania tylko dla składników, rodzic tylko do dokumentu i kanału', ...DOC_LINES],
    gap: 'Każda wtyczka zestawów zapisuje to inaczej. Adapter mapuje tylko wtyczki, które zna.',
  },
  {
    id: 'shopify',
    label: 'Shopify',
    shape: 'Same składniki w grupie',
    wire: [
      { text: 'lineItems[0]: { title: "Książka kucharska", price: 69.00, discountAllocations: -8.86,' },
      { text: '  lineItemGroup: { title: "Zestaw kuchenny", quantity: 1 } }' },
      { text: 'lineItems[1]: { title: "Fartuch", price: 79.00, discountAllocations: -10.14, lineItemGroup: … }' },
      { text: 'lineItems[2]: { title: "Zakładka", price: 4.99, discountAllocations: -4.99 (Buy X Get Y) }' },
    ],
    neutral: [
      { key: 'g1', name: 'Zestaw kuchenny', role: 'zestaw', group: 'g1', qty: 1, paid: '129,00', origin: 'zbudowany z grupy' },
      { key: 'L1', name: 'Książka kucharska', role: 'składnik', group: 'g1', qty: 1, paid: '60,14', list: '69,00', reduction: 'rabat zestawu', origin: 'kanał' },
      { key: 'L2', name: 'Fartuch', role: 'składnik', group: 'g1', qty: 1, paid: '68,86', list: '79,00', reduction: 'rabat zestawu', origin: 'kanał' },
      { key: 'L3', name: 'Zakładka', role: 'gratis', qty: 1, paid: '0,00', list: '4,99', reduction: 'gratis · rabat 100%', origin: 'kanał' },
    ],
    declares: ['Źródło zamówień: podaje składniki w grupie, bez linii zestawu', 'Źródło zamówień: podaje cenę katalogową i rabaty'],
    core: ['Linię zestawu buduje z grupy, tylko do widoku i dokumentu', 'Gratis rozpoznany z rabatu 100%, bez zgadywania', ...DOC_LINES],
    gap: 'OpenLinker nie ma dziś integracji Shopify. Przykład pokazuje, że model obejmuje ten kształt.',
  },
  {
    id: 'marketplace',
    label: 'Erli, Amazon, Kaufland',
    shape: 'Zestaw jako zwykły SKU',
    wire: [
      { text: 'items[0]: { externalId: "ZEST-KUCH", quantity: 1, unitPrice: 12900, taxRate: "TAX_23" }', tone: 'warn' },
      { text: 'Brak składu zestawu w zamówieniu', tone: 'muted' },
      { text: 'Gratisu nie ma w zamówieniu', tone: 'muted' },
    ],
    neutral: [
      { key: 'L1', name: 'Zestaw kuchenny', role: 'zestaw', group: 'g1', qty: 1, paid: '129,00', origin: 'kanał' },
      { key: 'L1·1', name: 'Książka kucharska', role: 'składnik', group: 'g1', qty: 1, paid: '60,14', origin: 'definicja w OL' },
      { key: 'L1·2', name: 'Fartuch', role: 'składnik', group: 'g1', qty: 1, paid: '68,86', origin: 'definicja w OL' },
    ],
    declares: ['Źródło zamówień: nie podaje składu (OL rozpoznaje zestaw po SKU)', 'Źródło zamówień: podaje cenę przed rabatem (Erli unitPriceBeforeRebate)'],
    core: ['Rozpoznaje zestaw po SKU powiązanym z definicją w OL', 'Gratis tylko z reguły albo od operatora', ...DOC_LINES.slice(0, 1)],
    gap: 'Kanał ma zestaw w jednej stawce VAT. Nasz dokument może mieć dwie.',
  },
];

/* ── Proposed standard ──────────────────────────────────────────────────── */

export const FIELDS = [
  { name: 'composition', where: 'linia zamówienia z kanału', what: 'rola linii (zestaw / składnik), klucz grupy, ile sztuk składnika w zestawie, czy kanał podał składniki', absent: 'kanał nic nie twierdzi; OL rozpoznaje zestaw po SKU' },
  { name: 'commercial.listUnitPriceGross', where: 'linia zamówienia z kanału', what: 'cena katalogowa przed obniżką', absent: 'nieznana, a nie "bez obniżki"' },
  { name: 'commercial.reduction', where: 'linia zamówienia z kanału', what: 'powód obniżki (gratis, rabat zestawu, promocja, kupon, nieznany) i dowód (flaga kanału, rabat 100%, cena 0, cena symboliczna, dodany przez operatora, dodany regułą)', absent: 'brak obniżki zgłoszonej przez kanał' },
  { name: 'bundle (migawka)', where: 'zamówienie w OL', what: 'skład i ceny w zestawie zamrożone przy przyjęciu', absent: 'linia nie jest zestawem' },
  { name: 'fulfilmentLineId', where: 'linie realizacji', what: 'osobny identyfikator każdego składnika dla rezerwacji, pracy, zdjęcia stanu i przesyłki', absent: 'zwykła linia: równy id linii zamówienia' },
];

export const DECLARATIONS = [
  { name: 'LineAdjustmentRenderingDeclarer', port: 'Faktury i paragony', says: 'czy umie rabat na linii, czy przyjmie linię 0 zł, czy przyjmie stawkę VAT sumującą się do 0, minimalna wartość linii', absent: 'najbezpieczniej: gratis scalony albo pominięty, zanim adapter go zobaczy' },
  { name: 'MasterBundleStockReader', port: 'Master magazynu', says: 'czy produkt to zestaw, skład, jak master liczy jego stan (ze składników / własny / oba)', absent: 'bez ostrzeżeń o rozjeździe i bez podpowiedzi składu' },
  { name: 'OrderCreateLineStockEffect', port: 'Sklep docelowy', says: 'per linia: czy sklep sam zdjął stan składników przy tworzeniu zamówienia', absent: 'zakładamy, że nie zdjął: rezerwacje składników zostają do wysyłki' },
  { name: 'BundleListingSupportDeclarer', port: 'Oferty i publikacja', says: 'czy kanał umie natywną ofertę-zestaw i kto liczy jej stan', absent: 'zestaw idzie jako zwykły SKU, stan liczy OL' },
  { name: 'Reportery źródła (opcjonalnie)', port: 'Źródło zamówień', says: 'czy kanał w ogóle umie powiedzieć o składzie i o gratisach', absent: 'pola trzystanowe na linii wystarczą' },
];

export const COLLISIONS = [
  'Zdjęcie stanu przy sprzedaży: klucz sale:{owner}:{workId}:{orderLineId}. Drugi składnik wygląda jak powtórka i nigdy nie schodzi ze stanu.',
  'Odwrócenie sprzedaży: ten sam klucz, ta sama kolizja.',
  'Zamknięcie rezerwacji: pierwszy rozliczony składnik zamyka rezerwacje pozostałych.',
  'Linie pracy: unikalny indeks (workId, orderLineId) odrzuci drugi składnik.',
  'Linie przesyłki: unikalny indeks (shipmentId, orderId, lineId) jak wyżej.',
  'Routing: kontrola ilości po linii zamówienia przepuszcza plan z pomieszanymi składnikami.',
];

/* ── Run comparison ─────────────────────────────────────────────────────── */

export const CONFIRMED = [
  'Trzy kształty zestawu w zamówieniu, żaden marketplace nie podaje składu.',
  'Allegro i Shoper już dziś rezerwują zestaw jako 1 sztukę.',
  'Gratisu nie poznasz po cenie 0; na Allegro zwykle nie ma go w zamówieniu.',
  'Cena zestawu musi być podzielona na składniki przy definicji (antywzorzec Brightpearl).',
  'Nikt nie ma pełnego modelu gratisu; nikt nie zamienia gratisu, którego zabrakło.',
  'Top bóle sprzedawców: rozjazd stanów, zwrot części zestawu, gratis bez śladu w zamówieniu.',
];

export const CHANGED = [
  { title: 'Gratis z reguły koszyka PrestaShop', r1: 'Komentarz w mapperze: osobna linia gratisu.', r2: 'Kod źródłowy PrestaShop: gratis wtopiony w zwykłą linię w pełnej cenie, wartość w rabacie zamówienia.' },
  { title: 'Fałszywy alarm o złym VAT', r1: 'Rabat zamówienia rozkładany na wszystkie stawki na paragonie.', r2: 'Core odrzuca taki paragon wcześniej. Rozkład dotyczy tylko groszowych różnic.' },
  { title: 'Ile capability potrzeba', r1: 'Nie badane.', r2: 'Dane w polach linii, ograniczenia w 2-4 deklaracjach adapterów. Reszta to logika core.' },
  { title: 'Komplety Subiekta', r1: 'Wzmianka "zestaw jak zwykły towar".', r2: 'Komplet to gotowy towar ze stanem po montażu. Zderza się z modelem "stan = minimum składników".' },
];

export const NEW_IN_R2 = [
  { id: 'B-19', text: 'Która linia niesie cenę i VAT (rodzic czy składniki) zależy od kanału i wtyczki.' },
  { id: 'B-20', text: 'Master sam zdejmuje stan składników (PrestaShop pak), więc OL nie może zdjąć drugi raz.' },
  { id: 'B-21', text: 'Zestaw w kilku paczkach: kanał nie może dostać "wysłano" po pierwszym składniku.' },
  { id: 'G-15', text: 'Limit gratisów na klienta, który przetrwa nowy e-mail.' },
  { id: 'G-16', text: 'Nieudana reguła gratisu ma własny status i nie zatrzymuje zamówienia.' },
  { id: 'X-03', text: 'Ustawienia per połączenie: jak kanał zapisuje zestawy, rabaty i gratisy.' },
  { id: 'X-05', text: 'Linie, które nie są towarem ani rabatem: kaucja, portfel, opakowanie, punkty (IdoSell).' },
  { id: 'K-01', text: 'Allegro wyłącza MULTIPACK dla jednej oferty 12 stycznia 2027 r.; zostaje oferta-wielopak.' },
  { id: 'K-02', text: 'Typ darmowej linii: rabat w towarze czy prezent. Kraje traktują je różnie (IT, DE, UE).' },
];
