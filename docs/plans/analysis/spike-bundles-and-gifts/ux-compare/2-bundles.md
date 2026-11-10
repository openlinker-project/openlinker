# Porównanie UX: zestawy (lista + edytor)

Zakres: ekran "Zestawy" (8 stanów) i "Edytor zestawu" (5 kroków, 15 stanów) w prototypie.
Źródła: raporty spike'u (r5/4-competitors-pl, r5/5-competitors-global, r5/7-scope-overengineering, rules-check/*) oraz zrzuty prototypu. Bez nowych wyszukiwań w sieci.

## Werdykt w jednym zdaniu

Kreator w 5 krokach ma 2 kroki, które nic nie ustawiają (dostępność, kanały), i 1 krok, którego nikt na rynku nie ma przy tworzeniu (podział ceny). U konkurencji zestaw to jeden formularz: produkt, lista składników z ilością, cena.

## Ile kliknięć do "Zestaw poranny = kawa + kubek"

| Narzędzie | Ekrany | Co wypełniasz |
|---|---|---|
| OpenLinker (prototyp) | 5 kroków, 4 x "Dalej" + "Zapisz i opublikuj" | wariant, 2-3 składniki (ilość, przełącznik gratis), opcjonalnie nadpisanie udziałów z powodem, 5 przełączników kanałów, producent GPSR |
| BaseLinker | 1 formularz w katalogu | produkt-zestaw, składniki + ilość, opcjonalnie własna cena ("Zestaw może mieć oddzielną cenę, inną niż suma produktów"). Rozbijanie zestawów to 1 globalny przełącznik w ustawieniach, nie w zestawie |
| Apilo | 1 akcja na produkcie: "Zmień Produkt na zestaw" | składniki + ilość; cena w zestawie liczy się sama "proporcjonalnie" |
| Sellasist | 1 widok zestawu | składniki + ilość, kolumna "Cena produktu w zestawie" (opcjonalna) |
| Shopify Bundles | 1 strona | tytuł, składniki + ilość, cena/rabat. Podział ceny liczony przy sprzedaży "by weighted price", nie przy definicji |
| Linnworks | 1 zakładka "Composition" | lista child SKU + Quantity |
| PrestaShop pak | 1 zakładka produktu typu "pack" | produkty + ilość, tryb stanu paku |
| Subiekt GT komplet | 1 karta towaru | składniki + ilość |

Nasz kreator: ok. 5 ekranów i ok. 15 kontrolek. Rynek: 1 ekran, 2 pola na składnik.

## Problemy, od najważniejszego

1. **Krok 3 "Podział ceny" przy tworzeniu zestawu.**
   - Rynek: nikt nie każe dzielić ceny przy definicji. Apilo i Shopify liczą proporcjonalnie same, BaseLinker i Sellasist mają co najwyżej opcjonalną kolumnę.
   - Nasz własny raport zakresu (r5/7) mówi "D3a in-set price: defer", bo dokument w pilocie trzyma linię zestawu.
   - Krok ma 6 stanów błędów (ponad cenę osobno, suma inna, brak ceny, różne VAT, podgląd się zmienił). To najbardziej przytłaczająca część edytora.
   - Propozycja: usunąć krok. Podział liczony automatycznie przy zwrocie składnika i pokazany tylko tam. Nadpisanie, jeśli kiedyś, jako zwijana sekcja "Zaawansowane" w formularzu.

2. **Krok 4 "Dostępność" to tylko odczyt.**
   - Nic nie ustawia, a zajmuje osobny ekran z "Dalej".
   - Rynek: dostępność zestawu to liczba w kolumnie listy (BaseLinker: min ze składników; Apilo: przeliczana co 15 min).
   - Propozycja: jedna linia pod listą składników w formularzu: "Dostępne: 1 szt., ogranicza Łyżeczka". Rozbicie zostaje w rozwijanym wierszu listy.

3. **Krok 5 "Kanały" duplikuje istniejące publikowanie.**
   - Zestaw jest wariantem mastera, a oferta to zwykła oferta w istniejących kreatorach ofert OL. Przełączniki kanałów w edytorze zestawu to druga droga publikacji.
   - Rynek: BaseLinker, Apilo i Sellasist publikują zestaw jak każdy produkt, z listingu. Edytor zestawu nie zna kanałów.
   - GPSR i "kanał wysyła składniki" to walidacje oferty, nie zestawu.
   - Propozycja: usunąć krok. Po zapisie link "Wystaw ofertę" do istniejącego kreatora. Odmowę WooCommerce/Shopera pokazać jako ostrzeżenie przy zapisie zestawu, jeśli taki kanał jest podłączony.

4. **Krok 1 "Wariant" jako osobny ekran.**
   - Wybór jednego produktu z listy nie potrzebuje ekranu. Rynek: zestaw zaczyna się od karty produktu (Apilo "Zmień Produkt na zestaw", PrestaShop typ "pack").
   - Propozycja: pole "Produkt zestawu" na górze formularza, plus akcja "Zrób z tego zestaw" na karcie produktu.

5. **Panel boczny z historią wersji przy każdym kroku.**
   - Trzy wersje z liczbą otwartych zamówień obok każdego kroku to szum. Operator nie decyduje tu o wersjach, zamrożenie jest automatyczne.
   - Nikt z konkurencji nie pokazuje wersji zestawu. Sellasist wprost nie aktualizuje pobranych zamówień, BaseLinker też nie.
   - Propozycja: jedno zdanie przy zapisie, gdy są otwarte zamówienia: "12 otwartych zamówień zostaje przy starym składzie". Historia wersji jako zakładka na karcie zestawu, nie w edytorze.

6. **Za dużo informacji w wierszu listy.**
   - Wiersz ma: SKU, znacznik wersji, master, stan, powód stanu, 3 pigułki kanałów, składniki z ilością, dostępność z "ogranicza", cenę, koszt, marżę.
   - Rynek: lista zestawów to nazwa, SKU, stan dostępny, cena. Reszta w szczegółach.
   - Propozycja: kolumny Zestaw (nazwa + SKU), Składniki (skrót "3 składniki"), Dostępne, Cena. Marża i kanały w rozwinięciu albo w analityce. Kafelek "Składniki w kilku zestawach" usunąć, to informacja z panelu składnika.

7. **Przełącznik "Gratis" na każdym składniku.**
   - Dobrze rozwiązuje "gratis w zestawie", ale stoi przy każdym wierszu i konkuruje z ilością i "Usuń".
   - Rynek: BaseLinker i Sellasist robią to ceną 0 w kolumnie ceny w zestawie, bez osobnego pojęcia.
   - Propozycja: zostawić, ale jako opcja w menu wiersza ("Oznacz jako gratis") albo checkbox w kolumnie widocznej dopiero, gdy zestaw ma więcej niż 1 składnik. Pigułka "Gratis" zostaje.

8. **8 stanów listy, część to stany masterów, nie zestawu.**
   - "Pak z własnym stanem", "Komplet Subiekta niezłożony", "Składnik nieaktualny", "Publikacja wstrzymana" to cztery osobne alerty o jednym fakcie: OL nie zna pewnej dostępności.
   - Propozycja: jeden stan "Dostępność nieznana" z powodem w jednym zdaniu i jedną akcją. Dla paków PS i kompletów Subiekta jedno ostrzeżenie przy tworzeniu, a nie stały alert na liście.

## Minimalny formularz v1 (jeden ekran)

```
Nowy zestaw
  Produkt zestawu      [wybierz wariant z mastera]     (SKU i cena z mastera, tylko do odczytu)
  Składniki
    [Kawa Etiopia 250 g]   ilość [1]   [...]  (menu: Oznacz jako gratis, Usuń)
    [Kubek 350 ml]         ilość [1]   [...]
    + Dodaj składnik
  Dostępne: 12 szt. (ogranicza Kubek)
  [Zapisz zestaw]        po zapisie: "Wystaw ofertę" (istniejący kreator)
```

Walidacje inline, bez osobnych ekranów: zestaw w zestawie odrzucony, wybrany produkt jest już składnikiem, pak PS trzymający własny stan (ostrzeżenie), kanał WooCommerce/Shoper wysyłający składniki (ostrzeżenie).

## Co zostawić

- Dostępność = minimum ze składników, z nazwą składnika, który ogranicza. Tak robi BaseLinker i to jest jasne.
- Brak zagnieżdżania (Shopify: "Bundles can't contain other bundles").
- Zamrożenie składu na zamówieniu, ale niewidoczne. Pokazać tylko w zamówieniu, które ma stary skład.
- Pigułka "Gratis" przy składniku i "Część zestawu" w zamówieniu i na stanowisku.
- "Synchronizuj skład z PrestaShop" jako akcja na karcie zestawu.
- Rozwijany wiersz z rozbiciem dostępności na składniki.

## Co przenieść na później albo usunąć z edytora

| Funkcja | Decyzja |
|---|---|
| Krok podziału ceny i 6 jego stanów | usunąć z edytora; liczyć przy zwrocie (r5/7: defer D3a) |
| Krok dostępności | zamienić na 1 linię w formularzu |
| Krok kanałów, GPSR, wynik publikacji | usunąć; publikacja w istniejącym kreatorze ofert |
| Historia wersji w panelu bocznym | zakładka na karcie zestawu, później |
| Koszt i marża w liście | do analityki |
| 4 alerty o nieznanej dostępności | 1 stan z powodem |
