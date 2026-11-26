/* ---------- decisions (Polish commentary) ---------- */
function Decisions() {
  const T = ({ head, rows }) => <div className="tbl"><table><thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table></div>;
  return (
    <div className="col">
      <div className="dcard">
        <h3>Wszystkie tabele i co z nimi robimy</h3>
        <p>Jeden wspólny silnik (pasek widoków, panel Filters, panel Columns &amp; sort), konfigurowany osobno dla każdej strony. Pierwsze 10 wierszy to strony z prototypu. Reszta to rekomendacja po rekonesansie kodu i zrzutów (stack v0.19.0).</p>
        <T head={['Strona', 'Typ', 'Co dostaje', 'Widoki systemowe (pasek)', 'Uwagi']} rows={[
          ['Orders', 'A: kolejka', 'Widoki własne i współdzielone, Filters, Columns & sort', 'All, Needs attention, Awaiting mapping, Awaiting dispatch, Source deleted, Synced', 'Failed orders i Dispatch risk to w praktyce widoki Orders: kandydaci na widoki systemowe zamiast osobnych tras'],
          ['Products', 'A', 'j.w.', 'All, Out of stock, Low stock, Oversold, Deleted at source, No tax rate', 'Baner „deleted at source” zostaje. Zaznaczanie do 100 produktów i „Publish products”'],
          ['Listings', 'A', 'j.w.', 'Active, Invalid, Draft, Ended, Unsynced, Price changes', 'Przełącznik „All / Price Changes” staje się widokiem. Dziś brak sortowania: tu nowe'],
          ['Shipments', 'A', 'j.w.', 'All, Failed, Dispatched, In transit, Delivered, Cancelled (+ Draft, Generated w „Views”)', 'Linia „3 to fix · 1 tracking not sent” zostaje. Brak wyszukiwania tekstowego, jak dziś'],
          ['Returns', 'A', 'j.w.', 'All, Needs receiving, Needs disposition, Restock blocked, Money pending, Orphans, All open', 'Siedem kart segmentów staje się paskiem. Baner „needs an order” zostaje'],
          ['Invoices', 'A: kolejka z akcją zbiorczą', 'j.w.', 'All, Failed, Rejected by authority, Awaiting submission, Without tax ID', 'Pasek akcji zbiorczych (Retry, Issue) bez zmian'],
          ['Jobs & Logs', 'B: log', 'Tylko widoki systemowe + Columns & sort (zapamiętane dla użytkownika)', 'All, Failed (dead), Running, Queued, Business failures', 'Bez widoków własnych: otwierane przy incydencie, nie codziennie'],
          ['Webhooks', 'B', 'j.w.', 'All, Failed, Rejected, Deadlettered', ''],
          ['Sales documents', 'B', 'j.w.', 'All, Invoices, Fiscal receipts, Failed', 'Kursorowa paginacja zostaje'],
          ['Customers', 'C+: lista referencyjna', 'Tylko Columns & sort i Filters. Bez paska widoków', '-', 'Granica: 122 rekordy, dwa pola filtra'],
        ]} />
        <h4>Bez zmian (nie tabele robocze)</h4>
        <T head={['Strona', 'Dlaczego']} rows={[
          ['Connections, Adapters, Users, Prompt templates', 'Małe listy referencyjne i ustawienia, 1-2 filtry, bez wolumenu'],
          ['Sync progress (Cursors)', 'Ma własną, niedawną przebudowę (grupy po połączeniu, baner „28 syncs need a look”). Nie ruszać'],
          ['Duplicate stock positions, Automations, Fulfilment, Pack bench', 'Raporty, katalog zdarzeń i narzędzia pracy, nie listy do filtrowania'],
          ['Stock movements', 'Nie tabela, tylko lista kart. Segmenty All / Needs a look / Stock / Holds pasują do paska widoków, ale Columns nie dotyczy'],
          ['Promotions', 'Ma własny pasek (All, Active, Paused, Scheduled, Drafts, Ended, To check). Pasuje do wspólnego paska, ale kolejność reguł jest z góry na dół, więc sortowanie nie dotyczy'],
          ['Insights / Analytics', 'Raporty z zakresem dat, co najwyżej zapamiętany zakres'],
        ]} />
      </div>

      <div className="grid2">
        <div className="dcard">
          <h3>Co jest wspólne, a co różni strony</h3>
          <ul>
            <li><b>Wspólne:</b> pasek widoków, Filters (panel boczny), Columns &amp; sort (panel boczny), chipy filtrów, „Needs a look”, menu użytkownika (gęstość, motyw).</li>
            <li><b>Różne:</b> kolumny-grupy z różnymi polami (np. Money w Orders, „Price / Updated / Created” w Products), własna kolumna główna (Order, Product, Status, Return), filtry, sortowanie, akcje główne w nagłówku.</li>
            <li><b>Zaznaczanie i akcje zbiorcze</b> tylko w Orders, Products i Invoices.</li>
            <li><b>Paginacja:</b> offsetowa prawie wszędzie, kursorowa w Sales documents. Prototyp jej nie pokazuje.</li>
          </ul>
          <h4>Do ujednolicenia w kodzie</h4>
          <ul>
            <li>Nazwy parametrów połączenia: <span className="mono">connectionId</span>, <span className="mono">sourceConnectionId</span>, <span className="mono">lastSourceConnectionId</span>. Zapisany widok potrzebuje mapy per strona.</li>
            <li>Sortowanie: Orders i Products mają osobne <span className="mono">sort</span> i <span className="mono">dir</span>, reszta <span className="mono">?sort=pole:kierunek</span>.</li>
            <li>Zapis widoku to cały query string bez <span className="mono">offset</span>, a każda strona deklaruje własne widoki systemowe.</li>
          </ul>
        </div>
        <div className="dcard">
          <h3>Zasady stojące za wszystkim</h3>
          <ul>
            <li>Jeden pasek widoków zamiast dwóch urządzeń nawigacyjnych. Zakładka systemowa to nawigacja: zmiana filtra pokazuje chipy i „Save as view…”, bez okna odrzucania.</li>
            <li>Widok zapamiętuje filtry, sortowanie i kolumny. Nie zapamiętuje wyszukiwania, numeru strony, gęstości ani motywu.</li>
            <li>Logi i listy referencyjne nie dostają widoków własnych (ryzyko sprawy: rozrost widoków bez korzyści), tylko zapamiętane kolumny i sortowanie.</li>
            <li>Liczniki z serwera tylko przy widokach systemowych. Widoki własne bez liczników (koszt zapytań).</li>
            <li>Kolumna główna (identyfikator wiersza) zawsze widoczna, pozostałe można ukrywać i zmieniać kolejność.</li>
          </ul>
          <h4>Do rozstrzygnięcia</h4>
          <ul>
            <li>Czy Failed orders i Dispatch risk stają się widokami Orders (i znikają jako trasy).</li>
            <li>Czy logi dostają widoki własne (tu: nie).</li>
            <li>Czy kolumny mają być częścią widoku (tu: tak).</li>
            <li>Czy Promotions i Stock movements przechodzą na wspólny pasek.</li>
          </ul>
        </div>
      </div>

      <div className="dcard">
        <h3>Ograniczenia tego prototypu</h3>
        <ul>
          <li>Tabela każdej strony pokazuje 8-12 przykładowych wierszy. Liczniki widoków systemowych to prawdziwe sumy ze zrzutów (poza Returns, Invoices, Jobs, Webhooks i Sales documents, gdzie liczone są z przykładowych wierszy).</li>
          <li>Kolumny i dane Promotions, Fulfilment, Run log i Pack bench nie były widoczne na stacku (puste), więc tych stron nie ma w prototypie.</li>
          <li>Stan nie jest zapamiętywany przy przechodzeniu między stronami. Zapis widoku, usuwanie i pozostałe akcje działają w obrębie jednej strony.</li>
          <li>Niepokryte stany: konflikt zapisu widoku współdzielonego, błąd zapisu, ładowanie, limit liczby widoków, paginacja.</li>
          <li>Interfejs jest po angielsku, bo taki jest stack ze zrzutów. Twoje wcześniejsze zrzuty były po polsku: wersja PL to osobna decyzja.</li>
        </ul>
      </div>
    </div>
  );
}

/* ---------- architecture ---------- */
function Architecture() {
  const T = ({ head, rows }) => <div className="tbl"><table><thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table></div>;
  const M = ({ children }) => <span className="mono">{children}</span>;
  return (
    <div className="col arch">
      <div className="dcard">
        <h3>Stan wyjścia: origin/main, nie pierwszy szkic</h3>
        <p>Ta wersja jest sprawdzona w kodzie <b>origin/main</b> przez ośmiu recenzentów (backend, baza, API, stan frontu, UI, inwentarz stron, i18n i testy, ryzyka). Na main <b>nie ma jeszcze żadnych widoków zapisanych</b>. Jest za to kilka rzeczy, których pierwszy szkic nie znał i które zmieniły projekt:</p>
        <ul>
          <li><b>Presety kolumn zamówień już istnieją</b> (<M>order_column_presets</M>, <M>/orders/column-presets</M>, <M>order-column-visibility-control.tsx</M>, klucz <M>ol.orders-list.visible-columns.v1</M> w localStorage). Orders ma dziś dwa źródła prawdy o kolumnach. Widok ma je zastąpić, nie dołożyć trzeciego.</li>
          <li><b>System filtrów z #4049</b> i <M>shared/ui/side-panel.tsx</M> są na main. Używamy ich, nie budujemy od nowa.</li>
          <li><b>i18n jest obowiązkowe</b>: każdy tekst idzie przez namespace (EN i PL), literały w JSX blokuje ESLint.</li>
          <li><b>Tylko Orders ma deskryptory filtrów i hook.</b> Pozostałe strony parsują parametry inline, a format sortowania jest różny.</li>
        </ul>
      </div>

      <div className="dcard">
        <h3>Jak to wygląda w kodzie</h3>
        <p>Jeden wspólny silnik w <M>features/saved-views</M> i jedna deklaracja listy na stronę, leżąca przy feature tej strony. Backend dostaje jeden nowy kontekst będący liściem. Prototyp pokazuje wygląd i zachowanie, nie strukturę plików.</p>
        <pre>{`apps/web/src/
  shared/ui/
    data-table.tsx            jeden plik; kolejnosc kolumn = kolejnosc
                              tablicy columns; nowe pole ariaSort
    sort-field.tsx            SortArrow, SortField, SortStack (nowe)
    side-panel.tsx            istnieje: panel Kolumny i sortowanie
  features/saved-views/
    api/                      klient + klucze zapytan
    hooks/                    useSavedViews (serwer), useViewDraft (diff)
    lib/                      reconcile, diff, parts, toDataTableColumns
    components/               ViewsBar, EditedBar, SaveViewDialog,
                              ColumnsPanel, RepairBanner, Grip, MoveBtns
  features/<strona>/lib/<strona>.list-config.ts   <- pisze strona:
                              paramKeys, normalize, columns, widoki
                              systemowe (z kluczami i18n, nie literalami)
  pages/<strona>/             uzywa useSavedViews + config

libs/core/src/saved-views/    lisc: zero krawedzi do innych kontekstow
apps/api/src/saved-views/     SavedViewsApiModule + kontroler + rejestr pageKey`}</pre>
        <h4>Podział odpowiedzialności</h4>
        <T head={['Warstwa', 'Odpowiada za', 'Nie robi']} rows={[
          ['Konfiguracja strony', 'paramKeys (klucze URL należące do widoku, bez offset), normalize() do porównania „Edited”, kolumny z polami, widoki systemowe', 'Nie zna zapisanych widoków ani API'],
          ['Silnik widoków (feature)', 'Pasek, panele, stan „Edited”, zapis, Undo, naprawa widoku, adapter toDataTableColumns', 'Nie zna kolumn konkretnej strony i nie pobiera danych'],
          ['DataTable (shared)', 'Renderuje kolumny w kolejności tablicy columns. Kolumna ukryta = brak w tablicy. Pole ariaSort dla nagłówka z własnymi kontrolkami', 'Nie zna widoków, filtrów ani pól wielu wartości. Pola składa adapter'],
          ['URL (useSearchParams)', 'Jedyne źródło bieżących filtrów, sortowania i offsetu. Widok to skrót, który ustawia URL', 'Nie przechowuje kolumn'],
          ['Serwer (TanStack Query)', 'Widoki nazwane (osobiste i współdzielone), domyślny widok użytkownika', 'Nie przechowuje wyszukiwania, strony, gęstości ani motywu'],
          ['i18n', 'Namespace saved-views (en i pl), klucze posortowane, limity długości przycisków i chipów, tłumaczenie błędów po kodzie', 'Żadnych literałów w JSX, żadnego error.message z API'],
          ['Zaznaczenie wierszy', 'Zostaje w stanie lokalnym strony', 'Nie wchodzi do widoku; zmiana widoku je czyści'],
        ]} />
        <h4>Zastosowanie widoku w URL</h4>
        <p>Jedno wywołanie <M>setSearchParams(prev =&gt; ...)</M>: kasuje wszystkie klucze z <M>paramKeys</M> oraz <M>offset</M>, ustawia klucze z zapisanego zapytania, zachowuje klucze spoza widoku (np. <M>tab</M>). Kliknięcie widoku to nowy wpis w historii, auto-zastosowanie domyślnego widoku na wejściu to <M>replace</M>. Domyślny widok stosujemy tylko wtedy, gdy URL nie ma żadnego klucza z <M>paramKeys</M>, więc głęboki link zawsze wygrywa. Pole szukania Orders ma już efekt synchronizujący pole z URL-em, więc debounce nie walczy z widokiem.</p>
        <p>Format sortowania jest dziś różny: Orders i Products używają <M>sort</M> plus <M>dir</M>, tabele z <M>useTableSort</M> używają <M>sort=pole:kierunek</M>. Dlatego silnik traktuje zapytanie jako tekst, a każda strona deklaruje własne <M>paramKeys</M> i <M>normalize</M>. Strony bez hooka filtrów (Products, Listings, Customers) dostają go w ramach migracji tej strony.</p>
      </div>

      <div className="grid2">
        <div className="dcard">
          <h3>Backend: model danych</h3>
          <pre>{`saved_views
  id                 uuid pk
  scope              'personal' | 'shared'
  owner_user_id      uuid null, FK users ON DELETE CASCADE
                     ustawione TYLKO dla personal
  created_by_user_id uuid null, BEZ FK (jak packedByUserId)
  page_key           tekst, format + rejestr w apps/api
  name               unikalne osobno dla personal i shared
  definition         jsonb
    { v, query, sort, columns, parts, pageSize? }
  revision           int, rosnie w waskim UPDATE
  created_at / updated_at
  CHECK (scope='personal' AND owner_user_id IS NOT NULL)
     OR (scope='shared'   AND owner_user_id IS NULL)

  indeks personal: (owner_user_id, page_key, name)
                   WHERE scope='personal'
  indeks shared:   (page_key, name) WHERE scope='shared'

saved_view_defaults
  user_id (FK users CASCADE), page_key, view_id null = systemowy
  unikalne (user_id, page_key)`}</pre>
          <ul>
            <li><b>Jeden FK ma jedną regułę przy usunięciu.</b> CASCADE dla osobistych i SET NULL dla współdzielonych nie da się wyrazić na jednej kolumnie. Rozwiązanie: współdzielony widok ma <M>owner_user_id</M> równe NULL z konstrukcji, więc nie ma czego zerować, a CASCADE dotyczy tylko osobistych. CHECK pilnuje zgodności. Autor współdzielonego widoku leży w kolumnie bez FK, więc widok przeżywa autora.</li>
            <li>Użytkownicy są usuwani <b>twardo</b>. Ich osobiste widoki i domyślne znikają razem z nimi, bez ostrzeżenia.</li>
            <li>FK, CHECK i indeksy częściowe są w migracji; testowy harness buduje schemat przez <M>synchronize</M> i ich nie widzi. Dlatego indeksy są nazwane tak samo w encji ORM i w migracji, a tabele trafiają do <M>fulfillment-work-migration-parity.int-spec.ts</M>.</li>
            <li>Rewizja jak w main: kolumna <M>revision</M> zwiększana w wąskim UPDATE, <M>expectedRevision</M> w body PATCH, zero zmienionych wierszy rozróżnia 404 od 409 drugim odczytem. Na main nie ma precedensu If-Match, to nowy mechanizm.</li>
            <li>Limity: 16 KB zserializowanej definicji, 64 kolumny, 2 KB zapytania, 50 widoków na użytkownika i stronę (sprawdzane w serwisie, więc dwa równoległe zapisy mogą je przekroczyć, akceptujemy albo blokujemy wąskim zapytaniem), GET współdzielonych też ograniczony.</li>
          </ul>
        </div>
        <div className="dcard">
          <h3>Backend: kontekst, API, uprawnienia</h3>
          <ul>
            <li><M>libs/core/src/saved-views</M> jako <b>liść</b>: jedna linia w <M>ZERO_SIBLING_EDGE_LEAVES</M> z pustym allow-setem, poza root barrelem, subpath w <M>package.json</M>. Szkielet pliku jak <M>operational-settings</M>, ale to <b>singleton</b>, a my mamy kolekcję per użytkownik, więc schemat bierzemy z <M>order_column_presets</M> i autoryzację z <M>order-notes</M> (isAdmin jako argument serwisu, nie nazwa roli).</li>
            <li>Osobny <M>SavedViewsApiModule</M> w <M>apps/api</M> (tylko kontroler, importuje moduł core), zgodny z konwencją <M>{'{Domain}ApiModule'}</M>.</li>
            <li>Trasy pod <M>/v1/saved-views</M> (wersjonowanie URI jest globalne): GET ?pageKey, POST, PATCH /:id, DELETE /:id, <M>PUT /default</M> zadeklarowane PRZED trasami z <M>:id</M>. Klon widoku to zwykły POST.</li>
            <li>Błędy: SAVED_VIEW_NOT_FOUND (404, także dla cudzego osobistego), SAVED_VIEW_REVISION_CONFLICT (409), konflikt nazwy (409, inny kod niż rewizja), limity (400 z kodem). Każdy kod to cztery pliki: typy BE, lustro FE, dwa pliki locales; pilnuje <M>check-api-error-code-mirror</M>.</li>
          </ul>
          <T head={['Akcja', 'Kto']} rows={[
            ['Czytać swoje i współdzielone', 'admin, operator, viewer'],
            ['Tworzyć, zmieniać, usuwać własne', 'admin, operator, viewer. To NOWA polityka: presety kolumn zamówień wykluczają viewera. Uzasadnienie: widok to preferencja interfejsu, nie dane'],
            ['Tworzyć, zmieniać, usuwać współdzielone', 'tylko admin, sprawdzane w serwisie'],
            ['Packer', 'brak dostępu: jawne @Roles bez packera, nigdy @AnyRole, wpis w packer-exclusion.spec.ts']]} />
          <p>Front czyta uprawnienia z <M>session.permissions</M>, więc potrzebne jest nowe uprawnienie wyświetlania <M>saved-views:write</M> w dwóch plikach pilnowanych przez <M>check-permission-mirror</M>. W trybie demo zapisy są zablokowane (ReadOnlyLock).</p>
        </div>
      </div>

      <div className="dcard">
        <h3>Co wolno zapisać w zapytaniu widoku (bezpieczeństwo)</h3>
        <T head={['Reguła', 'Dlaczego']} rows={[
          ['Serwer parsuje zapisywany query i usuwa search, offset, cursor, limit', 'Współdzielony widok z search=jan@x.pl ujawniłby e-mail kupującego wszystkim rolom, także przy OL_STORE_PII=false. Reguła „widok nie przechowuje szukania” musi być egzekwowana w serwerze, nie tylko w UI'],
          ['Klucze zapytania sprawdzane względem listy dozwolonych (nie czarnej) dla danej strony, nieznane dają 400', 'Filtry wolnotekstowe typu e-mail lub nazwa na Customers i Returns trzeba sprawdzić stronami'],
          ['Walidacja jawna: plainToInstance + validate z whitelist i forbidNonWhitelisted na DTO listy tej strony', 'Globalny pipe działa tylko na żądaniu HTTP, a zapisany query to goły tekst w jsonb'],
          ['Front nigdy nie wysyła zapisanego query jako surowego tekstu do API listy; stosuje je przez URL i parsery strony', 'Autoryzacja zostaje po stronie endpointu listy, więc podmiana parametrów nie daje dostępu ponad rolę'],
          ['Odczyt tolerancyjny: stary lub uszkodzony widok dostaje flagę stale, nigdy 500', 'Definicja jest nieprzezroczysta, naprawa po stronie frontu'],
          ['Daty tylko bezwzględne', 'createdFrom i createdTo są stałe, więc „ostatnie 7 dni” wymaga osobnego modelu dat i nie wchodzi do tego PR'],
        ]} />
        <p>Rejestr <M>pageKey</M> leży w <M>apps/api</M> (core zna tylko format klucza <M>^[a-z][a-z0-9-]{'{1,63}'}$</M>). Na main nie ma precedensu rejestru, więc to nowy wzorzec i wymaga testu „każda lista z paskiem widoków jest w rejestrze”, inaczej nowa lista cicho nie zapisuje widoków. Audyt: wystarczy logger przy create, update i delete widoku współdzielonego, bo main nie ma tabeli audytu ustawień.</p>
      </div>

      <div className="dcard">
        <h3>Presety kolumn zamówień (#3633): jedno źródło prawdy</h3>
        <T head={['Element', 'Decyzja']} rows={[
          ['Dane', 'Jednorazowa migracja SQL: preset osobisty staje się widokiem personal z pageKey=orders, preset z userId NULL staje się widokiem shared z flagą domyślnego. Kolumny zawężone do identyfikatorów kolumn listy (preset może mieć identyfikatory eksportu, pusty wynik pomijamy). Wiersze bez istniejącego użytkownika pomijamy. ON CONFLICT DO NOTHING, w osobnym commicie'],
          ['Kolumny listy Orders', 'Czytane z aktywnego widoku. Klucz localStorage ol.orders-list.visible-columns.v1 migrujemy jednorazowo albo usuwamy. Edycja kolumn listy idzie wyłącznie przez widoki'],
          ['Endpointy /orders/column-presets', 'Zostają oznaczone jako deprecated, bo dialog eksportu nadal ich używa. Kolumny eksportu to osobna sprawa. Kontrolera nie używamy ponownie: inny model (same kolumny) i bez viewera'],
          ['Relacja kodu', 'Czysty SQL, bez krawędzi orders do saved-views, kontekst zostaje liściem'],
          ['Ryzyko', 'Presety zmieniane po wdrożeniu w starym UI nie synchronizują się z widokami. Dlatego stary UI edycji presetów znika z listy zamówień w tym samym PR'],
          ['Wyłącznik', 'Przełączenie listy Orders na widoki za flagą do czasu testu zgodności, żeby ewentualna regresja nie blokowała całego PR'],
        ]} />
      </div>

      <div className="dcard">
        <h3>UI: co zmienia wspólne komponenty</h3>
        <T head={['Element', 'Co jest naprawdę potrzebne']} rows={[
          ['DataTable', 'Jeden plik. Kolumny z id już istnieją. Nowe jest tylko pole ariaSort (nagłówek z własnymi kontrolkami nie jest sortable) i nowy wskaźnik sortowania. Pola wielu wartości składa adapter w feature, DataTable nie zna widoków'],
          ['Nowy styl aktywnego sortowania', 'Zmienia wygląd KAŻDEJ tabeli w aplikacji: SortArrow zamiast glifu, podkreślenie. Stare reguły .data-table__sort-indicator stają się martwe i są usuwane w tym samym PR. Orders i Products mają własne stosy sortowania (.orders-sortbtn, .sortbtn), więc przechodzą na SortField w tym samym wydaniu albo dostają zapisany wyjątek'],
          ['Pasek widoków, panel, zapis', 'Panel to istniejący SidePanel. Zapis i zmiana nazwy to Dialog. Undo to akcja w ToastProvider. Menu to DropdownMenu lub Popover. Nowe są tylko: ViewsBar, ColumnsPanel, SortField, Grip i przyciski góra/dół'],
          ['Drag and drop', 'Brak biblioteki w repo, natywne HTML5. Przyciski góra/dół są podstawą (WCAG 2.5.7 i reguła style guide: nawet kolejność statusów idzie strzałkami), przeciąganie jest dodatkiem. Przyciski widoczne po hover i fokusie, na dotyku zawsze'],
          ['Widok kart poniżej 768 px', 'Ignoruje kolejność i widoczność kolumn, bo karta ma własny kontrakt. Świadome ograniczenie'],
          ['Klasy CSS', 'Prototypowe .panel, .toast, .chip, .grip, .disc, .icon-btn kolidują z istniejącymi klasami w index.css. Wszystko nowe ma prefiks sv-. Globalne .button:active z prototypu zmieniałoby każdy przycisk, więc decydujemy o nim osobno'],
          ['Tokeny ruchu', 'Czasy i krzywe z --duration-* i --ease-*, nie literały. Wszystko wyłączone pod prefers-reduced-motion'],
          ['Cele dotykowe', 'Co najmniej 44 px, kluczowane SZEROKOŚCIĄ (max-width: 767px), bo globalna reguła pod (hover:none) i (pointer:coarse) nie działa w wąskim oknie desktopowym'],
          ['Gęstość i style guide', 'Nowe wysokości wierszy (panel 28 i 48, grip 24) wpisujemy do tabeli Density and Row Heights, nagłówek z SortStack też. Zmiana DataTable wymaga aktualizacji data-table.test.tsx i wpisu w style guide w tym samym PR'],
          ['Escape i focus', 'Dialog, Popover i SidePanel to Radix, więc focus trap, Escape i zwrot fokusu są wbudowane. Warstwowanie Escape (panel potem dialog zapisu) nigdzie nie jest opisane i wymaga jawnego testu'],
        ]} />
      </div>

      <div className="dcard">
        <h3>Kolumny wielopolowe w modelu</h3>
        <p>Kolumna ma listę <b>pól</b> (<M>parts</M>), np. Total, Payment, Document, Placed, Created. Widok zapisuje tylko odstępstwa od domyślnych: które pola są widoczne i w jakiej kolejności. Nagłówek z przyciskami sortowania jest wyliczany z widocznych pól, więc ukrycie pola ukrywa też jego przycisk. Jeśli sortowanie zapisanego widoku wskazuje ukryte pole, nic się nie psuje.</p>
      </div>

      <div className="dcard">
        <h3>Strony: inwentarz z main i kolejność migracji</h3>
        <T head={['Strona', 'Mechanizm filtrów i sortu', 'Rozmiar', 'Uwagi']} rows={[
          ['Customers', 'search, lastSourceConnectionId, useTableSort', 'S', 'Pilot silnika. Pasek niepotrzebny, same kolumny i sort'],
          ['Webhooks', 'status, provider, connectionId, useTableSort', 'S', ''],
          ['Shipments', 'wiele filtrów, useTableSort ale sort PO STRONIE KLIENTA', 'M', 'Sort zapisanego widoku działa tylko w obrębie jednej strony serwera. Decyzja: sort serwerowy albo zapisane ograniczenie'],
          ['Sales documents', 'kind, status, search, taxId, daty', 'M', 'Paginacja kursorem w stanie lokalnym: widok pomija kursor. Brak sortu'],
          ['Returns', 'segment, bucket, stage, connection', 'M', 'Liczniki segmentów z serwera, baner orphan. Brak sortu w API'],
          ['Invoices', 'status, regulatoryStatus, taxId, daty', 'M', 'Akcje zbiorcze. Brak sortu w API'],
          ['Jobs and logs', 'status, jobType, outcome, useTableSort', 'M', 'Druga tabela strumieni, w makiecie nieobecna'],
          ['Products', 'search, stock, taxRateState, bundles, hideStale, unlistedOn, sort plus dir', 'L', 'Zaznaczenie do 100, dwa parametry sortu, parsowanie inline do wyodrębnienia'],
          ['Listings', 'tab, view, connectionId, platformType, shopBlocked, staleSignal', 'L', 'Brak sortu także w API (zmiana backendu). view=queue to osobna tabela kolejki cen, w makiecie nieobecna'],
          ['Failed orders, Dispatch risk', 'connectionId albo bucket i source', 'S', 'Osobne tabele z własnymi kolumnami. Zostają trasami albo stają się widokami Orders dopiero po Orders'],
          ['Orders', 'useOrderListFilters, sort plus dir, wiele parametrów', 'L', 'OSTATNIA: 2041 linii, zaznaczenie i eksport, migracja presetów i localStorage'],
        ]} />
        <h4>Poza zakresem (małe listy referencyjne lub raporty)</h4>
        <p>Inventory locations, Users, Connections, Prompt templates, Adapters, Duplicate positions, Cursors, Promotions, Insights. Stock movements to jednak DataTable z dwoma filtrami: do osobnej decyzji. To jest decyzja do zapisania, nie założenie.</p>
        <h4>Bez makiety: nie obiecujemy pixel-perfect</h4>
        <p>Failed orders, Dispatch risk, kolejka cen w Listings, druga tabela w Jobs and logs, Stock movements. Dla nich wygląd wynika z istniejących komponentów, a makieta nie istnieje.</p>
      </div>

      <div className="dcard">
        <h3>Kolejność prac w jednym PR (commit na krok)</h3>
        <T head={['#', 'Zakres', 'Zmienia UI?']} rows={[
          ['1', 'Backend: tabele, migracja, API, role, kody błędów, uprawnienie, testy (w tym parity)', 'Nie'],
          ['2', 'Wspólne: ariaSort i nowy styl sortowania w DataTable, SortField, usunięcie starego wskaźnika', 'Tak, WSZYSTKIE tabele'],
          ['3', 'Silnik widoków: lib, hooki, ViewsBar, EditedBar, ColumnsPanel, i18n', 'Tak'],
          ['4', 'Migracja danych presetów Orders (osobny commit)', 'Nie'],
          ['5', 'Strony po kolei: Customers, Webhooks, Shipments, Sales documents, Returns, Invoices, Jobs, Products, Listings', 'Tak'],
          ['6', 'Orders na końcu, za flagą do testu zgodności; Failed orders i Dispatch risk po decyzji', 'Tak'],
          ['7', 'Dokumentacja: frontend-architecture, architecture-overview, style guide (gęstość, DataTable), makieta zaktualizowana', 'Nie'],
        ]} />
        <h4>Bramki CI, które ten PR musi przejść</h4>
        <ul>
          <li><b>lint</b> (eslint plus check:invariants: m.in. check-locales, check-ui-vocabulary, check-css-structure, check-design-tokens, check-permission-mirror, check-api-error-code-mirror, check-migration-timestamps, check-cross-context-imports, check-service-interfaces), <b>type-check</b> (dla apps/web realnie tsc -b), testy jednostkowe BE i FE, testy integracyjne API, migration:assert-clean.</li>
          <li>Nowy tekst w namespace saved-views (en i pl, klucze posortowane, limity długości, słownik check-ui-vocabulary). Widoki systemowe z kodu też mają klucze i18n, bo zwykły plik .ts omija zarówno no-literal-string, jak i test słownika.</li>
          <li>Brak axe i regresji wizualnej w repo: dostępność panelu kolumn sprawdzają jawne testy ról i etykiet. Zrzuty w 360x812, 768x1024 i 1440x900 w opisie PR.</li>
        </ul>
        <h4>Ryzyka otwarte</h4>
        <ul>
          <li>Ten PR jest bardzo duży. Warunek recenzowalności: osobny commit na krok, osobny commit na migrację danych, flaga na przełączenie Orders.</li>
          <li>Liczniki widoków systemowych istnieją z serwera tylko dla Orders i Returns. Reszta pokazuje liczniki dopiero po dodaniu endpointów albo wcale.</li>
          <li>Nazwy parametru połączenia (connectionId, sourceConnectionId, lastSourceConnectionId, source) są różne, więc potrzebna jest konfiguracja per strona.</li>
          <li>Stare aliasy URL (np. bundles=true) i nieznane wartości w zapisanym zapytaniu są cicho ignorowane przez parsery, więc „wymaga naprawy” wykrywa tylko to, co strona potrafi zwalidować.</li>
          <li>Twarde usunięcie użytkownika kasuje jego osobiste widoki bez ostrzeżenia. Widoki współdzielone przeżywają, a autor w interfejsie może być „usuniętym użytkownikiem”.</li>
        </ul>
      </div>
    </div>
  );
}

/* ---------- app ---------- */
function App() {
  const [tab, setTab] = useState('proto');
  const [page, setPage] = useState('orders');
  const [role, setRole] = useState('operator');
  const [theme, setTheme] = useState('system');
  useEffect(() => { const r = document.documentElement; if (theme === 'system') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', theme); }, [theme]);
  const Seg = ({ value, onChange, options }) => <div className="seg" role="radiogroup">{options.map((o) => <button key={o[0]} type="button" role="radio" aria-checked={value === o[0]} onClick={() => onChange(o[0])}>{o[1]}</button>)}</div>;
  return (
    <div className="deck">
      <div className="deckbar">
        <span><b>Zapisane widoki na wszystkich listach.</b> Przełączaj strony w menu bocznym. Motyw i gęstość: menu użytkownika.</span>
        <div className="deck-controls"><div><span className="ctl-label">Role</span><Seg value={role} onChange={setRole} options={[['admin', 'Admin'], ['operator', 'Operator'], ['viewer', 'Viewer']]} /></div></div>
      </div>
      <div className="dtabs" role="group" aria-label="Sekcje"><button type="button" className="dtab" aria-pressed={tab === 'proto'} onClick={() => setTab('proto')}>Prototyp</button><button type="button" className="dtab" aria-pressed={tab === 'decisions'} onClick={() => setTab('decisions')}>Wszystkie tabele i decyzje</button><button type="button" className="dtab" aria-pressed={tab === 'arch'} onClick={() => setTab('arch')}>Architektura kodu</button></div>
      {tab === 'proto' ? <ListScreen key={page + role} cfg={PAGES[page]} role={role} theme={theme} setTheme={setTheme} go={setPage} /> : tab === 'arch' ? <Architecture /> : <Decisions />}
    </div>
  );
}
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
