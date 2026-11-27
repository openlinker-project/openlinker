# UX: promocje z gratisem vs konkurencja

Zakres: ekran "Promocje z gratisem" (lista, kompozytor, test). Źródło: `app4/src/views/promotions.tsx`, zrzuty `composer-draft`, `dry-run-two-match`, `list`.
Dowody konkurencji: `rules-check/1-baselinker.md`, `3-sellasist.md`, `4-shopify.md` (BOGOS, cytaty z docs.bogos.io), `r1/phase2/6-shopify-admin.md`, PrestaShop `CartRule` (kod, `verify/prestashop-live.md`). Bez nowych wyszukiwań w sieci.

## Ile trzeba zrozumieć, żeby zrobić "gratis X przy zakupie Y"

| Narzędzie | Pola wymagane | Pola widoczne na start | Gdzie |
|---|---|---|---|
| OpenLinker (prototyp) | 5 (nazwa, kanał, warunek SKU, gratis, ilość) | ok. 15 pól + 4 panele informacyjne (kto płaci, droga gratisu, macierz 7 kanałów, test) + wersja | jedna długa strona, ok. 3100 px |
| BOGOS (Shopify) | ok. 4 (typ oferty, produkt kupowany, gratis, daty) | kreator od szablonu typu oferty; reszta w ustawieniach oferty | kreator krokowy |
| Shopify "Buy X get Y" | 3 (kupuje, dostaje, "Free") | ok. 8 sekcji, ale każda z domyślną wartością | jedna strona |
| PrestaShop reguła koszyka | 2-3 (nazwa, warunek, "Wyślij darmowy prezent") | 3 zakładki: Informacje / Warunki / Akcje, gratis to jedno pole w Akcjach | zakładki |
| BaseLinker akcja automatyczna | 3 (zdarzenie, warunek, akcja "dodaj produkt") | ogólny edytor automatyzacji | generyczny |
| Sellasist automatyzacja | 3 (warunek, efekt "Dodaj produkt", produkt) | ogólny edytor automatyzacji | generyczny |

Wniosek: wymaganych pól mamy tyle co inni. Problem jest w tym, co widać od razu: pokazujemy wszystkie opcje i wszystkie wyjaśnienia jednocześnie.

## Problemy, od największego wpływu

1. **Wszystkie opcje widoczne naraz.** Na ekranie są jednocześnie: łączenie, limit sztuk, polityka braku (3 opcje + zamiennik), limit na klienta, "pomiń jeśli jest", tryb "co N", daty. Shopify daje każdej sekcji wartość domyślną, a BOGOS zaczyna od szablonu.
   - Propozycja: jeden blok "Gratis X przy zakupie Y" z 4 polami. Pod spodem zwinięte "Więcej opcji" z jedną linią podsumowania domyślnych, np. "łączy się z innymi, bez limitu sztuk, stop przy braku gratisu".
2. **Macierz "Gdzie to działa" (7 kanałów x 3 kolumny) w środku kompozytora.** Nikt z konkurencji tego nie pokazuje, bo każdy działa w jednym miejscu. Dla operatora to długi blok tekstu, który dotyczy głównie kanałów, których nie wybrał.
   - Propozycja: przy każdym zaznaczonym kanale jeden znacznik ("tylko w OpenLinkerze", "sklep ma regułę koszyka"). Pełny tekst tylko tam, gdzie trzeba działać, czyli przy PrestaShop z regułą koszyka (ryzyko podwójnego gratisu).
3. **"Gdy gratisu zabraknie": 3 opcje plus zamiennik.** BOGOS ma dwie: "Stop the offers" / "Continue selling". Sellasist domyślnie blokuje akcję.
   - Propozycja v1: bez wyboru. Promocja wstrzymuje się sama, zamówienie idzie bez gratisu z widoczną uwagą.
   - "Wstrzymaj zamówienie" i "zamiennik" do usunięcia. Zamiennik da się zrobić drugą promocją niżej na liście.
4. **Warunek jako wolny tekst "SKU albo oferta".** Shopify i BOGOS mają wybór produktu ("Customer buys"), PrestaShop wybór produktu w warunkach. Pole tekstowe każe znać SKU i nie mówi, czy trafiło.
   - Propozycja: "Kupujący kupi: [wybierz produkt lub zestaw]" z wyszukiwarką. "Lub koszyk od X zł" jako drugi typ warunku, nie jako drugie pole obok.
5. **Pole "Wyzwalacz: Zamówienie przyjęte" tylko do odczytu.** Pole, którego nie da się zmienić, dokłada pojęcie bez wyboru. Nikt z konkurencji takiego pola nie pokazuje w ofercie gratisowej.
   - Propozycja: usunąć pole. Zdanie "Gratis dodajemy przy przyjęciu zamówienia" zostaje w opisie strony.
6. **Tryb "Stała ilość / Za każde N" + "Co ile sztuk" + "Maks. na zamówienie".** BOGOS ma jeden checkbox "Multiply gifts with number of products", a Shopify osobno "maximum number of uses per order".
   - Propozycja: checkbox "Gratis za każdą kupioną sztukę", który odsłania tylko "maks. na zamówienie". "1 na N" schować głębiej albo odłożyć; nikt z PL go nie ma (Sellasist 1:1).
7. **Kolejność z przyciskami Wyżej/Niżej w każdym wierszu listy.** BaseLinker, Apilo i Sellasist uruchamiają wszystko, co pasuje; kolejność ma tylko BOGOS i PrestaShop. Przy 1-3 promocjach kolumna "Kolejność" i dwa przyciski na wiersz to szum.
   - Propozycja: domyślnie wszystko się łączy. Kolejność pokazać dopiero, gdy jakaś promocja ma "Nie łącz", np. przeciąganiem w trybie "Zmień kolejność".
8. **Pole "Limit na klienta (po pilocie, opcjonalnie)".** Pokazujemy funkcję, której nie będzie w pilocie.
   - Propozycja: usunąć z UI v1. Wrócić z kluczem po rozpoznanym kliencie.
9. **Trzy panele edukacyjne w kompozytorze.** Kto płaci, droga gratisu i rejestr dla księgowej to nasza przewaga (nikt nie pokazuje kosztu gratisu przy tworzeniu), ale razem dają dużo tekstu.
   - Propozycja: zostawić jedną linię "Klient płaci 0 zł, kosztuje Cię 8,10 zł za sztukę".
   - "Drogę gratisu" przenieść do szczegółów zamówienia, gdzie dotyczy konkretnej paczki.
   - Zdanie o rejestrze przenieść do analityki.
10. **Na liście wersja "v2" i podpis "łączy się z innymi" przy każdej promocji.** BOGOS na liście pokazuje stan, nazwę, daty i statystykę.
    - Propozycja: z listy usunąć wersję (to szczegół wewnętrzny) i podpis łączenia, poza "nie łączy się", które jest wyjątkiem.
    - Dodać kolumnę "Wydano" (sztuki i koszt) zamiast paska limitu, gdy limitu nie ma.
11. **Brak punktu startu.** Pusty formularz każe operatorowi samemu ułożyć typ promocji. BOGOS zaczyna od wyboru typu oferty (Gift with purchase / Buy X Get Y / Spend X get gift).
    - Propozycja: przycisk "Utwórz promocję" otwiera 3 karty: "Gratis do produktu", "Gratis od kwoty zamówienia", "Gratis do każdej sztuki". Każda wypełnia warunek i ustawienia.

## Minimalne v1 (widoczne od razu)

1. Typ (wybór z 3 kart, potem już niewidoczny).
2. Kupujący kupi: produkt lub zestaw (wyszukiwarka) albo "zamówienie od X zł".
3. Gratis: produkt i ilość, plus linia "kosztuje Cię X".
4. Kanały: domyślnie wszystkie, ze znacznikiem przy każdym.
5. Okres: od teraz, "do" opcjonalne.

Nazwa podpowiadana automatycznie ("Łyżeczka gratis do Zestawu porannego"), z możliwością zmiany.

**Więcej opcji (zwinięte, z podsumowaniem):**
- gratis za każdą sztukę + maks. na zamówienie;
- limit sztuk w całej promocji;
- nie łącz z innymi;
- pomiń, jeśli produkt już jest w zamówieniu. Proponuję domyślnie WŁĄCZONE: na Allegro gratis bywa składnikiem zestawu, a podwójny gratis kosztuje więcej niż brak drugiego. BOGOS ma to jako opt-in, więc to nasza decyzja, nie standard rynku.

**Usunąć z v1:** pole wyzwalacza, limit na klienta, politykę braku z 3 opcjami i zamiennikiem, "1 na N", wersję na liście, macierz 7 kanałów.

## Co zostawić (lepsze niż u konkurencji)

- Linia "Klient płaci 0 zł, kosztuje Cię X". Nikt tego nie pokazuje przy tworzeniu, a BOGOS ma koszt dopiero w analityce.
- Test na przykładowym zamówieniu ("nic nie zapisuje"). Wynik z powodem pominięcia jest czytelny. Rozważyć domyślne zamówienie: ostatnie pasujące z wybranego kanału.
- Automatyczne wstrzymanie z widocznym powodem na liście ("Wstrzymana: brak gratisu"). Recenzja BOGOS 2 gwiazdki: oferta zatrzymała się po cichu, "we lost thousands of dollars".
- Promocja zakończona: "Kopiuj" i "Przedłuż i wznów" (BOGOS: duplicate + bulk edit dat).
