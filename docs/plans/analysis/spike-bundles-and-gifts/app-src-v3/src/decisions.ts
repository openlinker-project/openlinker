/**
 * Decision records: each open question answered from the evidence of rounds 1-5,
 * live tests and verification. Claim ids refer to claims.ts.
 */

export type Confidence = 'wysoka' | 'średnia' | 'niska';

export interface Decision {
  id: string;
  question: string;
  options: string[];
  verdict: string;
  why: string;
  counter: string;
  response: string;
  confidence: Confidence;
  wouldChange: string;
  claims: string[];
}

export const DECISIONS: Decision[] = [
  {
    id: 'Q1',
    question: 'Czy kanały mają deklarować kształt zestawu (reporter źródła), czy wystarczą pola trzystanowe na linii?',
    options: ['Same pola trzystanowe na linii', 'Deklaracja źródła jako capability', 'Ustawienie operatora per połączenie plus wartość w manifeście'],
    verdict: 'Pola trzystanowe na fakty o konkretnym zamówieniu. Fakt "ten kanał wysyła dzieci zestawu jako osobne linie" jako wartość w manifeście adaptera albo ustawienie operatora per połączenie, nigdy jako nazwa capability.',
    why: 'Dla kształtu "rodzic plus dzieci" brak informacji nie jest bezpieczny: dzieci wyglądają jak zwykłe linie i OL zarezerwuje i spakuje je drugi raz. To fakt o platformie, nie o zamówieniu.',
    counter: 'R5-6: pola trzystanowe nie wystarczą dla kształtu rodzic plus dzieci. Stress-test: capability w manifeście trafia do enabledCapabilities przy tworzeniu połączenia, a #2085 mówi, żeby nie ogłaszać nazw, po których ktoś może bramkować.',
    response: 'Przyjęte. Dlatego wartość w manifeście (wzór variantGrouping z najbardziej restrykcyjnym domyślnym) albo ustawienie operatora, a w pilocie definicja zestawu jest odrzucana na takich kanałach.',
    confidence: 'wysoka',
    wouldChange: 'Gdyby żaden kanał z pilota nie wysyłał dzieci (WooCommerce poza pilotem, Shoper potwierdzony jako zagnieżdżony).',
    claims: ['C-015', 'C-016', 'C-018', 'C-058'],
  },
  {
    id: 'Q2',
    question: 'Czy linię za 0,01 zł traktować jako gratis automatycznie?',
    options: ['Tak, z ceny', 'Tylko gdy kanał to deklaruje', 'Tylko z reguły operatora'],
    verdict: 'Nie z samej ceny. Gratis tylko z flagi kanału (IdoSell orderSalesMode, Mirakl offered_quantity), z reguły operatora albo z dodania przez operatora.',
    why: 'Ta sama cena 0,01 zł znaczy multipack Allegro, gratis z aplikacji Shopera, opakowanie albo błąd danych. BaseLinker rozpoznaje gratis po cenie i to jest antywzorzec. Dwie interpretacje KIS z 2026 uznają sprzedaż za 1 gr za odpłatną.',
    counter: 'R1: bez rozpoznania po cenie gratisy z Allegro zostaną niewidoczne.',
    response: 'Na Allegro gratisu i tak zwykle nie ma w zamówieniu (C-008), więc reguła operatora ma największą wartość.',
    confidence: 'wysoka',
    wouldChange: 'Kanał, który publikuje znaczenie 0,01 zł w API.',
    claims: ['C-007', 'C-008', 'C-020', 'C-024', 'C-040', 'C-068'],
  },
  {
    id: 'Q3',
    question: 'Skąd zestaw w pilocie: wariant z mastera z definicją w OL, czy import paków z mastera?',
    options: ['Wariant mastera plus definicja składu w OL (D3)', 'Import paków PrestaShop i kompletów Subiekta', 'Zestaw tylko w OL, bez wariantu'],
    verdict: 'Wariant z mastera plus definicja w OL. Bez importu paków w pilocie. Definicja nad pakiem, który ma własny stan, dostaje ostrzeżenie.',
    why: 'Warianty powstają tylko z synchronizacji mastera (C-061). PrestaShop nie zamraża składu paku (C-013), Subiekt ma stan kompletu dopiero po montażu (C-022), więc import przyniósłby niestabilny skład i drugi model stanu.',
    counter: 'Stress-test: "zdefiniowany w OL" to w praktyce skład OL nad SKU mastera, który może się rozjechać z pakiem w sklepie.',
    response: 'Przyjęte jako ryzyko. Ostrzeżenie przy definicji i rozwinięcie zamrożone per zamówienie ograniczają skutki.',
    confidence: 'średnia',
    wouldChange: 'Klient pilota sprzedaje głównie paki PrestaShop, których skład zmienia się w sklepie.',
    claims: ['C-011', 'C-013', 'C-022', 'C-061'],
  },
  {
    id: 'Q4',
    question: 'Czy obsłużyć komplety Subiekta w pilocie?',
    options: ['Tak, z montażem', 'Nie, ostrzeżenie', 'Nie, odmowa'],
    verdict: 'Nie w pilocie. Gdy master to Subiekt, definicja zestawu nad kompletem dostaje ostrzeżenie, że Subiekt liczy stan kompletu po montażu.',
    why: 'Model Subiekta to "komplet ma własny stan po montażu", przeciwny do "stan = minimum składników". Do tego WZ przy fakturze może zdjąć stan kompletu drugi raz.',
    counter: 'R3: most już czyta tw_Rodzaj, więc rozpoznanie kompletu jest tanie.',
    response: 'Rozpoznanie tak, obsługa stanu nie. Najpierw test na żywo na moście (komputer z Windows, poza zasięgiem tej sesji).',
    confidence: 'średnia',
    wouldChange: 'Klient pilota używa Subiekta jako mastera i sprzedaje komplety.',
    claims: ['C-022', 'C-074'],
  },
  {
    id: 'Q5',
    question: 'Gratis dodany w OL, a sklep docelowy nie ma OMS: czy budować OrderLineAdder?',
    options: ['Tak, w pilocie', 'Później, jako capability guard-only', 'Nigdy'],
    verdict: 'Później. W pilocie gratis to notatka dla pakowacza plus ręczna korekta stanu.',
    why: 'W OL nie ma wewnętrznego dodawania linii: edycja tylko zmniejsza ilości, a zapis edycji siedzi w apps/api, poza zasięgiem workera. Capability bez implementacji łamie ADR-048 decyzję 1.',
    counter: 'R1: brak gratisu w zamówieniu to jeden z trzech głównych bólów sprzedawców.',
    response: 'Prawda, ale to funkcja wyróżniająca, nie szkoda w pilocie. Notatka dla pakowacza już trafia na stanowisko.',
    confidence: 'wysoka',
    wouldChange: 'Klient pilota dodaje gratisy w większości zamówień.',
    claims: ['C-057', 'C-065'],
  },
  {
    id: 'Q6',
    question: 'Kto nadaje identyfikator linii składnika, gdy kanał przysłał sam zestaw?',
    options: ['Nowa kolumna fulfilmentLineId', 'Identyfikator pochodny {lineId}~c:{wariant} w istniejących kolumnach', 'Rozwinięcie w toDomain (efektywne linie zamówienia)', 'Pozycyjny {lineId}#c{n}'],
    verdict: 'Identyfikator pochodny {lineId}~c:{wariantSkładnika}, liczony z zamrożonego rozwinięcia, tylko na ścieżce realizacji. Rezerwowany segment ~g: na gratis.',
    why: 'Mieści się w kolumnach text, nic go nie parsuje, najdłuższy klucz ma 185 znaków przy limicie 255. Linie zamówienia, dokumenty i zwroty zostają na linii zestawu, więc nie ma potrzeby ceny składnika w pilocie.',
    counter: 'R5-6 proponuje rozwinięcie w toDomain: każdy składnik staje się linią zamówienia, a miejsca kluczowane po linii działają same. R5-7 i weryfikacja: wtedy dokumenty czytają składniki i wymagają ceny składnika w pilocie.',
    response: 'Wybrany wariant pochodny. Weryfikacja pokazała 9 miejsc do zmiany, nie 3. Edycje zamówienia i zwrot zestawu w pilocie są odrzucane (LINE_IS_BUNDLE, ręczny zwrot na stan), a nie budowane.',
    confidence: 'wysoka',
    wouldChange: 'Decyzja doradcy podatkowego, że zestaw o mieszanym VAT musi być na dokumencie jako składniki. Wtedy rozwinięcie w toDomain staje się tańsze.',
    claims: ['C-049', 'C-050', 'C-051', 'C-052', 'C-072'],
  },
  {
    id: 'Q7',
    question: 'Analityka: liczyć linię zestawu, składniki czy oba?',
    options: ['Linia zestawu', 'Składniki', 'Oba widoki'],
    verdict: 'Przychód na linii zestawu, bo tak jest w dokumencie i u kanału. Ilości składników w raportach stanu. Marża zestawu z kosztu wpisanego na wariant zestawu w pilocie.',
    why: 'order_line_items to kanał w języku kanału i jest usuwany i wstawiany od nowa. Migawki kosztu nigdy nie są uzupełniane później, więc bez kosztu na wariancie zamówienia z pilota zostaną bez marży na zawsze.',
    counter: 'Brightpearl: przychód na rodzicu i koszt na składnikach daje raporty 100% zysku i 100% straty.',
    response: 'Dlatego koszt zestawu wpisany na wariant zestawu przed startem pilota (proces, bez kodu).',
    confidence: 'średnia',
    wouldChange: 'Wymóg marży per składnik w pilocie.',
    claims: ['C-045', 'C-064'],
  },
  {
    id: 'Q8',
    question: 'Jaka forma gratisu na paragonie i fakturze?',
    options: ['Cena katalogowa + rabat 100% na linii', 'Pominięcie linii', 'Udział w zapłaconej kwocie (podział proporcjonalny)', '1 grosz', 'Wewnętrzna ewidencja art. 7 ust. 2 bez linii u kupującego'],
    verdict: 'Ustawienie operatora. Bezpieczne domyślne dla gratisu w tej samej stawce co płatna linia: pominięcie na paragonie. Gratis w innej stawce: odmowa z nazwanym powodem, dopóki doradca nie wybierze formy. Forma "rabat 100%" tylko po akceptacji doradcy.',
    why: 'KIS 2026 uznaje towar z rabatem 100% za nieodpłatną dostawę, której nie dokumentuje się fakturą. ADR-082 decyzja 7 już zabrania linii zerowej na paragonie. eparagony odrzuca stawkę, która po rabatach ma 0. Pominięcie jest neutralne podatkowo w tej samej stawce, w niższej stawce zawyża podatek (bezpieczne), w wyższej zaniża (ryzyko).',
    counter: 'Rundy 1-2 rekomendowały rabat 100% (wzór Sellasista). R5-8: to dokładnie forma, którą KIS w 2026 uznał za nieodpłatną dostawę.',
    response: 'Rekomendacja z rund 1-2 wycofana.',
    confidence: 'średnia',
    wouldChange: 'Stanowisko doradcy podatkowego. Pytania 1-4 z R5-8.',
    claims: ['C-028', 'C-030', 'C-033', 'C-068', 'C-076', 'C-031', 'C-034'],
  },
  {
    id: 'Q9',
    question: 'Gotowe zestawy z własnym stanem (B-03) w MVP?',
    options: ['Tak', 'Nie, później'],
    verdict: 'Nie w pilocie. Gotowy zestaw z własnym stanem to w pilocie zwykły produkt.',
    why: 'Wymaga montażu, dokumentu produkcji i zbierania "najpierw gotowe, potem składniki" (wzór Cin7). Żaden z polskich konkurentów tego nie ma.',
    counter: 'Cin7 i Brightpearl to mają, a sprzedawcy prezentów pakują boksy z wyprzedzeniem.',
    response: 'Do potwierdzenia u klienta (pytanie 3 do klienta).',
    confidence: 'wysoka',
    wouldChange: 'Klient ma na półce gotowe boksy prezentowe sprzedawane też jako zestaw.',
    claims: ['C-022', 'C-046'],
  },
  {
    id: 'Q10',
    question: 'Kolejność prac i co naprawić od razu?',
    options: ['Cały zakres przed pilotem', 'Etapy z bramkami'],
    verdict: 'Etap 0 zawsze (3-9 dni): odmowa dekrementacji paku PrestaShop, reszty zaokrągleń poza linią 0, czytelny powód błędu 41 eparagony, proces gratisu i kosztu. Etap 1 tylko gdy klient sprzedaje zestawy pakowane przez OL na kanałach z routingiem (20-30 dni). Etapy 2-3 po pilocie.',
    why: 'Dekrementacja paku PrestaShop pod routingiem OMS to dziś ciche przesprzedanie, potwierdzone na żywo. Zakres ze spike to 55-95 dni wobec 15-25 w zgłoszonym G15.',
    counter: 'Stress-test: etap 1 potrzebuje jeszcze wyzwalacza przeliczenia ATP zestawu i negatywnego faktu per zamówienie, inaczej ciche przesprzedanie i podwójne rezerwacje.',
    response: 'Przyjęte: etap 1 podniesiony z 17-27 do 20-30 dni.',
    confidence: 'wysoka',
    wouldChange: 'Odpowiedzi klienta pilota (etap 0.5).',
    claims: ['C-060', 'C-069', 'C-056', 'C-028'],
  },
  {
    id: 'Q11',
    question: 'Jak dzielić cenę zestawu na składniki (VAT, zwrot części)?',
    options: ['Cena w zestawie wpisana przy definicji (Apilo, Sellasist)', 'Wyliczana przy sprzedaży z cen składników osobno (Shopify)', 'Wyliczana, z opcjonalnym nadpisaniem'],
    verdict: 'Domyślnie wyliczana przy sprzedaży: wagi = cena brutto składnika osobno x ilość, z katalogu mastera, z ceną nabycia jako zapasem. Nadpisanie przez operatora tylko z powodem, sumą równą cenie zestawu i bez składnika powyżej jego ceny osobno. Podział zapisany na zamówieniu, zwrot zmniejsza podstawę o zapisaną wartość.',
    why: 'Komunikat MF z 2017 uznaje podział proporcjonalny za prawidłowy. TSUE wymaga najprostszej metody. BFH wyklucza metody, które dają składnikowi więcej niż jego cena osobno. Nic nie wymaga zamrożenia ceny przy definicji.',
    counter: 'R5-5: cena wpisana ręcznie to dodatkowa praca bez podstawy prawnej. Apilo: ręczne ceny bez limitu to antywzorzec.',
    response: 'Przyjęte. W pilocie dokument zostaje na linii zestawu, więc zamrażamy tylko ceny katalogowe składników w rozwinięciu.',
    confidence: 'średnia',
    wouldChange: 'Zestaw droższy niż suma składników: podział proporcjonalny łamie test BFH dla każdego składnika. Do doradcy.',
    claims: ['C-035', 'C-081', 'C-017', 'C-041'],
  },
  {
    id: 'Q12',
    question: 'Zestaw w zestawie: zakazać?',
    options: ['Zakazać', 'Pozwolić'],
    verdict: 'Zakazać w definicji, ale z uczciwym uzasadnieniem: to wybór OL, nie standard rynku.',
    why: 'Linnworks, Shopify i Sellasist zabraniają, Cin7 pozwala, Brightpearl przeczy sam sobie, BaseLinker: brak danych. Zakaz upraszcza ATP i rozwinięcie.',
    counter: 'Rundy 1-2 twierdziły, że zabraniają wszyscy. Cytat BaseLinkera dotyczył innego pola.',
    response: 'Teza poprawiona, decyzja bez zmian.',
    confidence: 'wysoka',
    wouldChange: 'Klient z zestawami wielopoziomowymi.',
    claims: ['C-039', 'C-073'],
  },
];
