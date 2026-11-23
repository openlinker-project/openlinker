# E2E night log

## 2026-11-22 noc
- Plan zatwierdzony. Health OK (tunel 200, bridge 200, olsub up).
- Agent aa02b0d1 wznowiony: dokonczyc oferte A, screeny, dowod.
- Utworzone w Subiekcie (test): OLE2E-ZESTAW-BIURKO (59,90, EAN, zdjecie), zdjecia dla ZESO20 i ZESTAW-BIURKO.
- Definicje zestawow w OL: OLE2E-ZESTAW-BIURKO = KUBEK x1 + PODKLADKA x1; OLE2E-KAWA-3PAK = KAWA-250 x3; ZESO20 (z Subiekta) = PESO20 + POYAR01.
- Podglad: ZESO20 ok (skladniki new-product, 502 zestawy). BIURKO i 3PAK: skladniki 'missing', PRODUCT_SET_COMPONENT_UNPUBLISHABLE (brak kategorii skladnika). Decyzja: najpierw wlasne oferty skladnikow (A kubek, podkladka, kawa 250), wtedy tryb own-offer (karta z oferty).
- Artefakt v3 opublikowany (zakladka Plan nocny).
- W0: oferta A (kubek) utworzona: Allegro id 7782582010, mapping a25bb8c3. Allegro: activating/INACTIVE ~25 min, bez bledow walidacji (operacja 202). Strona publiczna za ochrona botow (nie da sie zrobic screena z headless), dowod przez Allegro API (cena 39.90, stan 12, kat. 100129, productSet productId 9d357481 qty 1).
- Zmiany ustawien (tutorial): Product catalog connection = Subiekt; seller defaults (safety info tekstem, 'None applies' odrzucone dla Kubki); cennik wysylki 'Cennik test'; taxonomia: dodatkowe destination.taxonomy.sync w sync_jobs.
- Agent aa02b0d1 wznowiony: oferty E (podkladka) i J (kawa 250).
- Kontrola: 141 zamowien z Allegro sandbox w OL maja recordStatus awaiting_mapping i pusty syncStatus, nic nie wypchniete do Subiekta. ZK (typ 16) w bazie test: 6 szt., ostatni 19.11, bez zmian po moich zapisach. Zakup kontrolny uzytkownika pojdzie do ZK w test (zamierzone).
- Artefakt v4 opublikowany: oferta A + 18 screenow (konfiguracja i kreator).
- W4: promocja d8e05757-32f1-48d8-bfc6-931401e4a59f aktywna (containsProduct KAWA-250 -> free-gift OLE2E-GRATIS x1). Dry-run na starym zamowieniu: condition-fact-unknown (linie niezmapowane). Pelny dowod po zakupie kawy 250 g.
- ODKRYCIE (W5): oferty A/E/J wisza w 'activating' >1h na Allegro sandbox. Przyczyna wzorca: karta po EAN nigdy sie nie podpinala. Allegro /sale/products nie wysyla pola ean na wierzchu (EAN siedzi w parametrze 225693 isGTIN), a resolveAllegroProductCardByEan filtrowal po p.ean, wiec kazda oferta szla sciezka 'inline product' (nowy produkt wymaga weryfikacji). Dowod: surowa odpowiedz sandboxa dla 8000070020566 = karta 9a044d51 'Lavazza Qualita Oro 1000 g', brak top-level ean.
- Naprawa: nowy helper allegro-card-gtin.ts (hasExactGtin), uzyty w obu resolverach; 2 nowe testy, 43 testy zielone, tsc i eslint czyste. Commit lokalny (niepodpisany).
- Towar kontrolny OLE2E-KAWA-LAV (EAN prawdziwej karty 8000070020566, stan 20, zdjecie) w Subiekcie i OL. Pierwsza proba oferty bez productCardId: ProductValidationException (inline, brak parametrow).
- Allegro: karta musi miec komplet obowiazkowych parametrow kategorii (inaczej MissingRequiredParameters/aktywacja wisi). Sprawdzone 20 kart demo: kompletne tylko DZFOREVER i absurdalna WOBLACK50; PESO20/POYAR01/DZSO20 itd. nie maja Marki/Pojemnosci. Lavazza ma marke chroniona (ProductHasProtectedBrand blokuje ZESTAWY, pojedyncza oferta ok).
- Skan katalogu sandboxa: kompletne i niechronione karty sa dla kubkow (kat. 100129) i podkladek (4577). Nowe towary: OLE2E-KUBEK-K (EAN 5906660865919), OLE2E-PODKL-K (EAN 5905386992244), OLE2E-3PAK-KUBEK.
- Proba przepiecia kompletu ZESO20 SQL-em w test zablokowana przez klasyfikator (ZESO20 to demo-rekord, nie OLE2E-*). Nie obchodzone. ZESO20 zostaje dowodem odczytu kompletu (BundleReader), bez publikacji (karty skladnikow niekompletne).
- Oferty ACTIVE (karta podpieta): kubek 7782582152 (stan 12), podkladka 7782582153 (stan 12), wielopak kubkow 7782582154 (stan 4). DOWOD wielopaku z Allegro API: productSet = 1 wpis (karta kubka f54ab4ff) quantity 3; oferta zwyklego kubka ma te sama karte z quantity 1. Kawa Lavazza 7782582136 ACTIVE (pojedyncza; marka chroniona blokuje tylko zestawy).
- Luka zestawow: karta skladnika szukana tylko w kategorii oferty (podkladka w 4577 vs zestaw w 100129 -> new-product). Poprawka: fallback na wyszukiwanie GTIN bez kategorii. 339 testow zielone, commit lokalny. Stack api+worker przebudowywany.
- ZESTAW (F) DOWOD z Allegro API: oferta 7782582167 ACTIVE, productSet = 2 wpisy: karta kubka f54ab4ff (qty 1) + karta podkladki e477fe52 (qty 1), cena 59.90, stan 6, 0 bledow walidacji. Skladniki w trybie own-offer (karty z wlasnych ofert, kat. 100129 i 4577).
- Routing: 2 reguly Allegro 'Paczkomaty InPost' (zwykla i pobranie) -> ol_managed_carrier InPost (parcel small). Cennik test zawiera Allegro Paczkomaty InPost i kuriera DPD/DHL.
- Subiekt konektor: invoicing.triggerModel=auto-on-paid, salesDocument.documentKind=invoice (po zakupie ZK + dokument + WZ automatycznie).
- Screeny okna Subiekta (tylko okno programu): SUB-01 lista towarow, SUB-02 koniec listy z kompletem, SUB-03 karta kompletu, SUB-04 skladniki kompletu ZESO20. Karta zamknieta przez Anuluj, komplet bez zmian.
- Proba zalozenia WLASNEGO kompletu w Subiekcie przez GUI (automatyzacja okna): otworzylem karte 'Towar', wpisalem nazwe, wybralem liste Rodzaj; potem okno interaktywne Subiekta (proces uzytkownika) zniknelo z listy procesow. Brak zdarzenia awarii w dzienniku Windows. NIC nie zapisano (karta bez OK). Porzucone: komplet Subiekta nie jest publikowany; zestaw na Allegro to zestaw OL (kubek + podkladka). ZESO20 zostaje dowodem odczytu kompletu przez BundleReader.
- KONTROLA KONCOWA 05:40: wszystkie 8 ofert ACTIVE na Allegro (kubek 7782582152, podkladka 7782582153, wielopak 7782582154 [productSet qty 3], zestaw 7782582167 [2 karty], kawa Lavazza 7782582136, oraz 3 stare inline 7782582010/036/101, ktore aktywowaly sie po kilku godzinach). KOREKTA: wczesniejsze 'wisza bez konca' bylo za mocne, inline potrzebuje godzin, karta sekund.
- Tunel, proxy zdjec, bridge, olsub-*: dzialaja. Artefakt v7.
