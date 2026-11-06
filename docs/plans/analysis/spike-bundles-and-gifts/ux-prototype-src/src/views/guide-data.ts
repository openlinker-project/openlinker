/**
 * Scenario guide content: what each channel can do for each scenario, and the
 * steps an order walks through. Steps link into the real screens by state id.
 */
import type { ChannelId } from '../model/catalog';

export type ScenarioId =
  | 'bundle'
  | 'multipack'
  | 'offer-bundle'
  | 'gift-declared'
  | 'gift-inferred'
  | 'gift-ol-only'
  | 'bundle-gift'
  | 'gift-oos'
  | 'gift-wrap'
  | 'cancel'
  | 'return';

export const SCENARIOS: { id: ScenarioId; label: string; short: string }[] = [
  { id: 'gift-ol-only', label: 'Gratis tylko w OpenLinkerze', short: 'Kanał nie zna gratisu, a gratis i tak schodzi z magazynu.' },
  { id: 'bundle', label: 'Zestaw', short: 'Kanał sprzedaje zestaw, OpenLinker rezerwuje i pakuje składniki.' },
  { id: 'bundle-gift', label: 'Zestaw z gratisem', short: 'Gratis jest częścią definicji zestawu.' },
  { id: 'gift-declared', label: 'Gratis oznaczony przez kanał', short: 'Kanał sam mówi, że pozycja jest gratisem.' },
  { id: 'gift-inferred', label: 'Gratis rozpoznany po cenie', short: 'Kanał przysyła 0,00 zł albo 0,01 zł bez oznaczenia.' },
  { id: 'gift-oos', label: 'Gratisu zabrakło', short: 'Promocja trwa, a gratisu nie ma na stanie.' },
  { id: 'multipack', label: 'Multipack Allegro', short: '3 sztuki jednego produktu w jednej ofercie.' },
  { id: 'offer-bundle', label: 'Pakiet ofert Allegro', short: 'Osobne oferty kupione razem z rabatem pakietu.' },
  { id: 'gift-wrap', label: 'Pakowanie na prezent', short: 'Płatna usługa kanału, nie gratis.' },
  { id: 'cancel', label: 'Anulowanie', short: 'Stan zestawu i gratisu wraca.' },
  { id: 'return', label: 'Zwrot', short: 'Zwrot składnika, całego zestawu albo towaru bez gratisu.' },
];

export const GUIDE_CHANNELS: ChannelId[] = ['allegro', 'prestashop', 'woocommerce', 'shoper', 'erli', 'idosell', 'empik'];

export type Support = 'native' | 'ol' | 'partial' | 'none';

export interface Step {
  title: string;
  body: string;
  visual?: 'payload' | 'order' | 'trail' | 'bench' | 'doc' | 'stock' | 'analytics';
  screen: string;
  state: string;
}

export interface Story {
  support: Support;
  verdict: string;
  payload: { text: string; tone?: 'warn' | 'muted' | 'key' }[];
  steps: Step[];
}

const PAYLOAD: Record<ChannelId, Record<'bundle' | 'gift' | 'plain', { text: string; tone?: 'warn' | 'muted' | 'key' }[]>> = {
  allegro: {
    bundle: [
      { text: 'lineItems[0].offer.id: "15382947761"', tone: 'key' },
      { text: 'offer.productSet.products: [{ id: "c1f2…", quantity: 1 }, { id: "9ab0…", quantity: 1 }]', tone: 'warn' },
      { text: 'quantity: 1   price.amount: "64.99"   tax.rate: "23.00"' },
    ],
    gift: [
      { text: 'lineItems[0]: { offer.name: "Zestaw poranny", quantity: 1, price: "64.99" }', tone: 'key' },
      { text: 'Brak pozycji gratisu. Allegro nie ma gratisów, obietnica jest tylko w opisie oferty.', tone: 'muted' },
    ],
    plain: [{ text: 'lineItems[0]: { offer.id: "15382947761", quantity: 1, price: "34.99" }', tone: 'key' }],
  },
  prestashop: {
    bundle: [
      { text: 'order_detail: { product_id: 21 (pak), quantity: 1, tax: 23% }', tone: 'key' },
      { text: 'Składu paku nie ma w zamówieniu, tylko w produkcie (product_bundle).', tone: 'muted' },
    ],
    gift: [
      { text: 'order_detail: { product_id: 8 (łyżeczka), quantity: 1, unit_price_tax_incl: 14.99 }', tone: 'warn' },
      { text: 'order_cart_rules: [{ name: "Łyżeczka gratis", value: 14.99 }]', tone: 'key' },
      { text: 'Gratis przychodzi jako zwykła pozycja po pełnej cenie. Rabat jest na całym zamówieniu.', tone: 'muted' },
    ],
    plain: [{ text: 'order_detail: { product_id: 3, quantity: 1, unit_price_tax_incl: 34.99 }', tone: 'key' }],
  },
  woocommerce: {
    bundle: [
      { text: 'line_items[0]: { name: "Zestaw do parzenia", total: "139.00", bundled_items: [2, 3] }', tone: 'key' },
      { text: 'line_items[1]: { name: "French press", total: "0.00", bundled_by: 1 }', tone: 'warn' },
      { text: 'line_items[2]: { name: "Kawa Etiopia", quantity: 2, total: "0.00", bundled_by: 1 }', tone: 'warn' },
    ],
    gift: [
      { text: 'line_items[1]: { name: "Próbka kawy", total: "0.00", meta: _free_gift=yes }', tone: 'warn' },
      { text: 'Flaga zależy od wtyczki. Bez znanej wtyczki to po prostu pozycja za 0,00 zł.', tone: 'muted' },
    ],
    plain: [{ text: 'line_items[0]: { sku: "KAW-250-ETI", quantity: 1, total: "34.99" }', tone: 'key' }],
  },
  shoper: {
    bundle: [
      { text: 'order-products[0]: { type: "1", price: 139.00, children: [ … ] }', tone: 'key' },
      { text: 'Nie wiadomo jeszcze, czy dzieci przychodzą też jako płaskie wiersze (do sprawdzenia na żywo).', tone: 'muted' },
    ],
    gift: [
      { text: 'order-products[1]: { name: "Próbka kawy (gratis)", price: 0.01 }', tone: 'warn' },
      { text: 'Aplikacje Shopera dodają gratis jako wariant za grosz, bez oznaczenia.', tone: 'muted' },
    ],
    plain: [{ text: 'order-products[0]: { code: "KAW-250-ETI", quantity: 1, price: 34.99 }', tone: 'key' }],
  },
  erli: {
    bundle: [
      { text: 'items[0]: { externalId: "ZES-PORANNY", quantity: 1, unitPrice: 6499 }', tone: 'key' },
      { text: 'Erli nie wysyła składu zestawu. Rozpoznajemy go po mapowaniu oferty.', tone: 'muted' },
    ],
    gift: [
      { text: 'items[0]: { externalId: "ZES-PORANNY", unitPrice: 6499 }', tone: 'key' },
      { text: 'Erli nie ma gratisów. Gratis istnieje tylko w OpenLinkerze.', tone: 'muted' },
    ],
    plain: [{ text: 'items[0]: { externalId: "KAW-250-ETI", quantity: 1, unitPrice: 3499 }', tone: 'key' }],
  },
  idosell: {
    bundle: [
      { text: 'productResults[1]: { productId: 41, bundleId: 9 }', tone: 'key' },
      { text: 'productResults[2]: { productId: 42, bundleId: 9 }', tone: 'key' },
      { text: 'IdoSell przysyła składniki zgrupowane numerem zestawu.', tone: 'muted' },
    ],
    gift: [
      { text: 'productResults[1]: { productId: 8, orderSalesMode: "gift" }', tone: 'key' },
      { text: 'IdoSell oznacza gratis wprost.', tone: 'muted' },
    ],
    plain: [{ text: 'productResults[0]: { productId: 3, productQuantity: 1 }', tone: 'key' }],
  },
  empik: {
    bundle: [{ text: 'order_lines[0]: { offer_sku: "ZES-PORANNY", quantity: 1 }', tone: 'key' }, { text: 'Empik nie wysyła składu zestawu.', tone: 'muted' }],
    gift: [
      { text: 'order_lines[0]: { offer_sku: "KAW-250-ETI", quantity: 3 }', tone: 'key' },
      { text: 'promotions[0]: { type: "FREE_ITEMS", offered_quantity: 1 }', tone: 'warn' },
    ],
    plain: [{ text: 'order_lines[0]: { offer_sku: "KAW-250-ETI", quantity: 1 }', tone: 'key' }],
  },
};

const NAME: Record<ChannelId, string> = { allegro: 'Allegro', prestashop: 'PrestaShop', woocommerce: 'WooCommerce', shoper: 'Shoper', erli: 'Erli', idosell: 'IdoSell', empik: 'Empik' };

function commonTail(gift: boolean): Step[] {
  return [
    { title: 'Dokument sprzedaży', body: gift ? 'Gratis w tej samej stawce co płatna pozycja nie trafia na paragon. Suma paragonu równa się temu, co zapłacił kupujący.' : 'W pilocie paragon i faktura pokazują zestaw jedną pozycją.', visual: 'doc', screen: 'documents', state: gift ? 'gift-same-rate-omitted' : 'bundle-one-line' },
    { title: 'Ruch w magazynie', body: gift ? 'W PrestaShop schodzi łyżeczka z powodem "Gratis", powiązana z zamówieniem.' : 'W PrestaShop schodzą składniki, nie pak.', visual: 'stock', screen: 'analytics', state: gift ? 'movements-gift' : 'movements-bundle-components' },
    { title: 'Analityka', body: gift ? 'Koszt gratisu wpada do kosztu promocji i marży zamówienia.' : 'Marża zestawu liczona z sumy kosztów składników.', visual: 'analytics', screen: 'analytics', state: gift ? 'gifts-overview' : 'bundles-margin' },
  ];
}

export function story(channel: ChannelId, scenario: ScenarioId): Story {
  const n = NAME[channel];
  const p = PAYLOAD[channel];
  switch (scenario) {
    case 'gift-ol-only': {
      const native = channel === 'idosell' || channel === 'empik' || channel === 'prestashop';
      return {
        support: channel === 'allegro' || channel === 'erli' ? 'ol' : native ? 'native' : 'partial',
        verdict:
          channel === 'allegro' || channel === 'erli'
            ? `${n} nie ma gratisów. Gratis istnieje tylko w OpenLinkerze, ale schodzi z magazynu jak każda pozycja.`
            : native
              ? `${n} umie przekazać gratis sam. Promocja w OpenLinkerze też zadziała, ale lepiej trzymać jedno źródło promocji.`
              : `${n} zna gratisy tylko przez wtyczki lub aplikacje. Promocja w OpenLinkerze działa niezależnie od nich.`,
        payload: p.gift.slice(0, 1).concat([{ text: 'Brak pozycji gratisu w zamówieniu kanału.', tone: 'muted' }]),
        steps: [
          { title: 'Co przysłał kanał', body: `Zamówienie z ${n} ma tylko zestaw poranny. O łyżeczce kanał nic nie wie.`, visual: 'payload', screen: 'order', state: 'gift-ol-only' },
          { title: 'OpenLinker dopisuje gratis', body: 'Promocja "Łyżeczka gratis do zestawu porannego" pasuje. OpenLinker dodaje pozycję gratisu do zamówienia od razu przy przyjęciu i pokazuje, ile to kosztuje.', visual: 'order', screen: 'order', state: 'gift-ol-only' },
          { title: 'Rezerwacja i pakowanie', body: 'Łyżeczka jest zarezerwowana jak zwykła pozycja i trafia na stanowisko pakowania jako "Włóż gratis".', visual: 'bench', screen: 'bench', state: 'in-progress' },
          ...commonTail(true),
        ],
      };
    }
    case 'bundle':
    case 'bundle-gift': {
      const children = channel === 'woocommerce' || channel === 'shoper';
      return {
        support: children ? 'partial' : 'ol',
        verdict: children
          ? `${n} wysyła zestaw razem ze składnikami jako osobnymi pozycjami. OpenLinker liczy je raz: gdy definicja się zgadza, pozycje składników są pomijane.`
          : `${n} wysyła sam zestaw. OpenLinker rozwija go według definicji i rezerwuje składniki.`,
        payload: p.bundle,
        steps: [
          { title: 'Co przysłał kanał', body: `${n} przysłał zestaw. ${channel === 'allegro' ? 'Allegro dołącza productSet, ale numery katalogu Allegro nie wskazują naszych wariantów, więc służą tylko do kontroli.' : 'Rozpoznajemy go po mapowaniu oferty na wariant zestawu.'}`, visual: 'payload', screen: 'order', state: children ? 'shoper-double-children' : scenario === 'bundle-gift' ? 'bundle-plus-gift' : 'bundle-allegro' },
          { title: 'Rozwinięcie i rezerwacja składników', body: 'Pozycja zestawu zostaje do dokumentu i kanału. Składniki dostają własne pozycje realizacji i własne rezerwacje.', visual: 'trail', screen: 'order', state: scenario === 'bundle-gift' ? 'bundle-plus-gift' : 'bundle-allegro' },
          { title: 'Pakowanie składników', body: 'Pakowacz skanuje każdy składnik. Paczki nie da się zamknąć, gdy czegoś brakuje.', visual: 'bench', screen: 'bench', state: 'in-progress' },
          ...commonTail(scenario === 'bundle-gift'),
        ],
      };
    }
    case 'gift-declared': {
      const yes = channel === 'idosell' || channel === 'empik';
      return {
        support: yes ? 'native' : channel === 'prestashop' ? 'partial' : 'none',
        verdict: yes
          ? `${n} oznacza gratis w zamówieniu. OpenLinker pokazuje go jako gratis bez zgadywania.`
          : channel === 'prestashop'
            ? 'PrestaShop przysyła gratis z reguły koszyka jako zwykłą pozycję po pełnej cenie. OpenLinker łączy ją z rabatem zamówienia i oznacza jako gratis.'
            : `${n} nie oznacza gratisów. Zobacz "Gratis tylko w OpenLinkerze".`,
        payload: p.gift,
        steps: [
          { title: 'Co przysłał kanał', body: yes ? 'Kanał oznaczył pozycję jako gratis.' : 'Pozycja przyszła po pełnej cenie, rabat jest na zamówieniu.', visual: 'payload', screen: 'order', state: yes ? 'gift-channel-flag' : 'gift-cart-rule' },
          { title: 'Gratis w zamówieniu', body: 'Pozycja ma oznaczenie Gratis i pasek z kosztem.', visual: 'order', screen: 'order', state: yes ? 'gift-channel-flag' : 'gift-cart-rule' },
          ...commonTail(true),
        ],
      };
    }
    case 'gift-inferred':
      return {
        support: channel === 'shoper' || channel === 'woocommerce' ? 'partial' : 'none',
        verdict:
          channel === 'shoper' || channel === 'woocommerce'
            ? `${n} przysyła gratis jako pozycję za 0,01 zł lub 0,00 zł bez oznaczenia. OpenLinker uzna ją za gratis tylko z Twojej reguły, bo ta sama cena bywa opakowaniem albo błędem.`
            : `W ${n} ten kształt nie występuje.`,
        payload: p.gift,
        steps: [
          { title: 'Co przysłał kanał', body: 'Pozycja za grosz, bez oznaczenia.', visual: 'payload', screen: 'order', state: 'gift-inferred' },
          { title: 'Reguła operatora', body: 'Reguła "Pozycja za 0,01 zł z SKU próbki to gratis" oznacza ją jako gratis rozpoznany po cenie.', visual: 'order', screen: 'order', state: 'gift-inferred' },
          ...commonTail(true),
        ],
      };
    case 'gift-oos':
      return {
        support: 'ol',
        verdict: 'Gratisu zabrakło. OpenLinker robi to, co ustawiłeś w promocji: zamiennik, pominięcie z adnotacją albo wstrzymanie zamówienia. Nigdy nie pomija gratisu po cichu.',
        payload: p.plain,
        steps: [
          { title: 'Promocja pasuje, gratisu brak', body: 'Łyżeczek jest 4, z czego 3 już obiecane. Polityka promocji: zamiennik "Torba prezentowa".', visual: 'order', screen: 'order', state: 'gift-out-of-stock' },
          { title: 'Ustawienie polityki', body: 'Politykę wybierasz w promocji.', visual: 'order', screen: 'promotions', state: 'gift-out-of-stock' },
          { title: 'Na stanowisku', body: 'Gdy gratisu zabraknie dopiero przy pakowaniu, pakowacz dostaje tę samą decyzję.', visual: 'bench', screen: 'bench', state: 'gift-ran-out' },
        ],
      };
    case 'multipack':
      return {
        support: channel === 'allegro' ? 'ol' : 'none',
        verdict:
          channel === 'allegro'
            ? 'Od 12 stycznia 2027 multipack na Allegro to oferta z productSet i ilością większą niż 1. Bez definicji zestawu OpenLinker zdjąłby 1 sztukę zamiast 3, więc wstrzymuje zamówienie.'
            : `${n} nie ma multipacków tego typu.`,
        payload: [{ text: 'offer.productSet.products: [{ id: "c1f2…", quantity: 3 }]', tone: 'warn' }, { text: 'quantity: 1   price.amount: "94.99"' }],
        steps: [
          { title: 'Zamówienie wstrzymane', body: 'Oferta jest zmapowana na pojedynczy wariant, a productSet mówi o 3 sztukach.', visual: 'order', screen: 'order', state: 'multipack-held' },
          { title: 'Zdefiniuj zestaw', body: '"Kawa Etiopia, 3 opakowania" jako zestaw 3 x kawa zwalnia zamówienie.', visual: 'order', screen: 'bundle-editor', state: 'step-components' },
        ],
      };
    case 'offer-bundle':
      return {
        support: channel === 'allegro' ? 'partial' : 'none',
        verdict:
          channel === 'allegro'
            ? 'Pakiet ofert Allegro to osobne pozycje z rabatem typu BUNDLE bez kwoty. Każda pozycja schodzi ze stanu osobno. Rabat liczymy z różnicy cen.'
            : `${n} nie ma pakietów ofert.`,
        payload: [{ text: 'lineItems[0]: { price: "34.99", originalPrice: "39.99", discounts: [{ type: "BUNDLE" }] }', tone: 'warn' }, { text: 'lineItems[1]: { price: "34.99", originalPrice: "34.99" }' }],
        steps: [{ title: 'Pozycje z rabatem pakietu', body: 'Panel cen pokazuje cenę przed rabatem i rabat pakietu na każdej pozycji.', visual: 'order', screen: 'order', state: 'bundle-allegro' }],
      };
    case 'gift-wrap':
      return {
        support: channel === 'allegro' || channel === 'prestashop' ? 'native' : 'none',
        verdict: 'Pakowanie na prezent to płatna usługa, nie gratis. Trafia na dokument jako osobna pozycja i na stanowisko jako instrukcja.',
        payload: channel === 'allegro' ? [{ text: 'lineItems[0].selectedAdditionalServices: [{ definitionId: "GIFT_WRAP", price: "5.00" }]', tone: 'warn' }] : [{ text: 'orders: { gift: 1, gift_message: "Wszystkiego najlepszego", total_wrapping: 2.46 }', tone: 'warn' }],
        steps: [
          { title: 'W zamówieniu', body: 'Pozycja usługi i wiadomość od kupującego.', visual: 'order', screen: 'order', state: 'gift-wrap' },
          { title: 'Na stanowisku', body: 'Instrukcja "Zapakuj na prezent" i treść wiadomości.', visual: 'bench', screen: 'bench', state: 'gift-wrap' },
          { title: 'Na dokumencie', body: 'Pozycja usługi w swojej stawce.', visual: 'doc', screen: 'documents', state: 'gift-wrap-line' },
        ],
      };
    case 'cancel':
      return {
        support: 'ol',
        verdict: 'Anulowanie oddaje stan składników i gratisu. Rezerwacje się zamykają, a zdjęty stan wraca do mastera.',
        payload: p.plain,
        steps: [{ title: 'Zamówienie anulowane', body: 'Oś czasu pokazuje zwrot stanu każdego składnika i gratisu osobno.', visual: 'trail', screen: 'order', state: 'cancelled' }],
      };
    case 'return':
      return {
        support: 'ol',
        verdict: 'Zwrot zestawu w pilocie przyjmujesz ręcznie na stan składników. Zwrot jednego składnika ma wartość z zapisanego podziału ceny. Gratis zostaje u kupującego, wraca albo jest potrącany, zależnie od Twojej polityki.',
        payload: p.plain,
        steps: [
          { title: 'Zwrot składnika', body: 'Wartość z podziału ceny i propozycja potrącenia utraconego rabatu.', visual: 'order', screen: 'returns', state: 'bundle-one-component' },
          { title: 'Gratis zostaje u kupującego', body: 'Kupujący zwraca kubek, a łyżeczkę zatrzymuje.', visual: 'order', screen: 'returns', state: 'gift-kept' },
          { title: 'Faktura korygująca', body: 'Korekta z wartości z zamówienia.', visual: 'doc', screen: 'returns', state: 'correction-invoice' },
        ],
      };
  }
}

export const SUPPORT_LABEL: Record<Support, { label: string; tone: 'success' | 'info' | 'warning' | 'neutral' }> = {
  native: { label: 'Kanał to obsługuje', tone: 'success' },
  ol: { label: 'Robi to OpenLinker', tone: 'info' },
  partial: { label: 'Częściowo', tone: 'warning' },
  none: { label: 'Nie dotyczy', tone: 'neutral' },
};
