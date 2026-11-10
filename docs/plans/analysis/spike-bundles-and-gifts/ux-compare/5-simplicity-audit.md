# Audyt prostoty: zestawy i gratisy (prototyp vs BaseLinker, Apilo, Shopify)

Perspektywa: sprzedawca, który dziś używa BaseLinkera albo Apilo i pierwszy raz otwiera OpenLinkera.
Źródło: prototyp `app4/src` (12 ekranów, 155 stanów) oraz raporty r1-r5 i rules-check.

## 1. Ile tego jest

| Miara | Prototyp OL | BaseLinker | Apilo | Shopify + Simple Bundles + BOGOS |
|---|---|---|---|---|
| Ekrany robocze dla funkcji | 10 (zestawy, edytor, promocje, ustawienia, zamówienia, zamówienie, stanowisko, dokumenty, zwroty, analityka) | 2 (produkt typu Zestaw, zadanie automatyczne) | 2 (Zestaw produktów, akcja automatyczna) | 2 aplikacje, po 1-2 ekrany |
| Kroki tworzenia zestawu | 5 (wariant, składniki, podział ceny, dostępność, kanały) | 1 formularz | 1 formularz (z polem "Cena brutto w zestawie") | 1 formularz |
| Sekcje kompozytora gratisu | 6 (Kiedy, Warunki, Gratis, Łączenie, Limit sztuk, Gdy zabraknie) + "Gdzie to działa" + test | 1 akcja: warunki + "Dodaj produkt" | to samo | ok. 4 (warunki, gratis, priorytet, limity) |
| Nowe ustawienia połączenia | 4 grupy (jak kanał wysyła zestawy, gratis na dokumencie, zestaw na dokumencie, deklaracje dostawcy) | 0 dla gratisów | 0 | 0 |
| Znaczniki na liniach | 6 (Gratis + 5 źródeł, Zestaw, Część zestawu, pasek "kto płaci", ścieżka stanu, podgląd dla kanału) | nazwa produktu, ikona zestawu | ikona zestawu | etykieta "Free gift" |

Wniosek: konkurencja zamyka temat w 2 miejscach (produkt-zestaw i reguła automatyczna). My rozkładamy go na 10 ekranów. Część tej różnicy jest uzasadniona, bo robimy rzeczy, których oni nie robią (patrz pkt 6). Większość nie.

## 2. Nowe pojęcia, które sprzedawca musi zrozumieć

Policzone w treści ekranów (pliki z trafieniem / liczba wystąpień):
- "master" 11/102, "OMS" 10/76, "adapter" 1/40, "rezerwacja" 10/36, "ATP / dostępność z rozbiciem" 3/32, "wersja / v1 / v2" 13/41, "zamrożony skład" 5/13, "routing" 4/18, "ewidencja wewnętrzna" 8/17, "ścieżka stanu" 4/5, "forma gratisu", "udział w cenie", "deklaracja dostawcy", "GPSR", "pak".
- Razem około 15 nowych pojęć. BaseLinker i Apilo wymagają 2: "zestaw" i "akcja automatyczna".

Najgorsze dla nowego użytkownika:
1. **"master" / "mastera"**: słowo z architektury. Sprzedawca mówi "sklep" albo "magazyn". Zamienić na nazwę systemu ("w PrestaShop", "w Subiekcie").
2. **"adapter", "Jak adapter", "Czego adapter nie deklaruje"**: żargon programisty. Zamienić na "Ustawienie domyślne dla PrestaShop" i ukryć całą sekcję deklaracji.
3. **"OMS włączony/wyłączony"** w notatkach i ścieżce stanu: sprzedawca widzi tylko skutek ("stan zdejmie PrestaShop" albo "stan zdejmie OpenLinker po spakowaniu"). Przełącznik zostaje w ramie prototypu, nie w produkcie.
4. **"routing"**: zamienić na "przydzielenie do pakowania".
5. **"v1 / v2", "zamrożony skład"**: zostawić jedno zdanie "Przyjęte zamówienia mają skład z dnia zakupu". Wersji nie pokazywać na liście, tylko w historii.
6. **"ATP"**: nie pada w UI wprost, ale "dostępność z rozbiciem" to ten sam koncept. Pokazać jedną liczbę "do sprzedania: 1" i w podpowiedzi "ogranicza łyżeczka".

## 3. Co powinno dziać się samo, bez UI

| Dziś w prototypie | Propozycja | Dlaczego |
|---|---|---|
| Krok 3 edytora "Podział ceny" z 6 stanami (nadpisanie, suma inna, brak ceny, różne VAT, podgląd się zmienił) | Podział liczy się sam z cen osobno. Pokazać go tylko na podglądzie dokumentu i w zwrocie. Ręczna zmiana w "Zaawansowane". Brak ceny: jedno pole "cena osobno" przy składniku. | Apilo ma jedno pole "Cena brutto w zestawie" na składniku, BaseLinker podobnie. Nikt nie ma osobnego kroku. |
| Krok 4 "Dostępność" | Jedna liczba w kroku składników ("do sprzedania: 1, ogranicza łyżeczka"). | Konkurencja pokazuje stan zestawu w stopce formularza. |
| Krok 5 "Kanały" z kontrolą przed publikacją | Zostawić tylko błędy (Shoper/Woo wysyła składniki, GPSR). Gdy wszystko gotowe: brak kroku, zestaw publikuje się jak zwykły produkt. | Sprzedawca nie powinien przechodzić przez krok, który w 90% mówi "Gotowe". |
| "Jak kanał wysyła zestawy" w ustawieniach połączenia | Wykrywać automatycznie z pierwszego zamówienia z zestawem; pytać tylko przy niepewności (Shoper). | Ustawienie, które zna adapter, nie powinno być pytaniem. |
| "Co deklaruje dostawca dokumentów" | Ukryć. Pokazać tylko, gdy dostawca odrzuca wybraną formę (eparagony błąd 41). | To jest wiedza dla nas, nie dla sprzedawcy. |
| Źródło gratisu w znaczniku (5 wariantów) | Znacznik "Gratis" bez podpisu na liście; źródło tylko w szczegółach linii po najechaniu. | BaseLinker i Shopify pokazują tylko "gratis". |

## 4. Co scalić

1. **Ekrany "Zestawy" + "Edytor zestawu"** w jeden: lista z panelem bocznym albo jednym formularzem (jak "Zestaw produktów" w Apilo). Kreator 5-krokowy zbędny.
2. **"Paragon i faktura" + "Gratis na dokumencie" w ustawieniach**: jedno miejsce. Podgląd dokumentu jako część ustawień, nie osobny ekran w menu. W zamówieniu zostaje link "Zobacz dokument".
3. **"Kto płaci" (WhoPaysStrip) + koszt w analityce**: w zamówieniu zostawić jeden wiersz "Gratis: koszt 3,90 zł", bez "Finansujesz Ty" (kanał w pilocie nigdy nie finansuje).
4. **"Ścieżka stanu" + oś czasu zamówienia**: kroki rezerwacji i zdjęcia stanu jako wpisy na osi czasu, nie osobny pasek przy każdej linii.
5. **"Gdzie to działa" w kompozytorze promocji**: zastąpić jednym zdaniem przy kanałach ("Na Allegro i Erli gratis dodaje OpenLinker, w PrestaShop możesz też użyć reguły koszyka"). Macierz to wiedza z badań, nie decyzja sprzedawcy.

## 5. Do sekcji "Zaawansowane"

- Promocja: "Nie łącz z innymi", "1 na N", "maks. na zamówienie", limit na klienta, zamiennik przy braku. Domyślny kompozytor: nazwa, kanały, warunek (wartość koszyka albo produkt), gratis, ilość, okres, limit sztuk.
- Ustawienia dokumentu: forma gratisu inna niż domyślna, zestaw jako składniki.
- Zestaw: ręczny podział ceny, historia wersji.

## 6. Gdzie jesteśmy lepsi i trzeba to zachować

1. **Gratis tylko w OL schodzi z magazynu** (Allegro, Erli): u konkurencji wymaga ręcznie zbudowanej akcji automatycznej; u nas reguła działa w każdym kanale. To główna wartość.
2. **Stan zestawu z najsłabszego składnika i rezerwacje per składnik**: jak w BaseLinker, ale z blokadą, gdy składnik nie ma pewnej dostępności.
3. **Multipak Allegro wstrzymany zamiast wysłany jako 1 sztuka**: w BaseLinkerze sprzedawcy wysyłali 1 zamiast 5 (wątek 919655). Przycisk "Utwórz zestaw 3 x Kawa" jest prostszy niż u nich.
4. **Suma dokumentu zawsze równa zapłacie** i obsługa błędu 41 eparagony. Konkurencja zostawia to sprzedawcy.
5. **Koszt gratisów w analityce**: nikt nie pokazuje "ile kosztowały gratisy" bez eksportu.
6. **Podpowiedź kwoty zwrotu wg wzoru Allegro**: rozwiązuje realny spór, nadal decyduje człowiek.

## 7. Lista cięć na v1 (od największego efektu)

| # | Cięcie | Efekt |
|---|---|---|
| 1 | Kreator zestawu 5 kroków -> jeden formularz (składniki z ilością i ceną osobno, stan do sprzedania, błędy kanałów inline) | -4 kroki, -10 stanów, -3 pojęcia (podział, ATP, kontrola kanałów) |
| 2 | Usunąć sekcje "Deklaracje dostawcy" i "Jak kanał wysyła zestawy" z ustawień (automatycznie + komunikat tylko przy problemie) | -2 grupy ustawień, -pojęcie "adapter" |
| 3 | Ekran "Paragon i faktura" jako podgląd w ustawieniach, nie pozycja menu | -1 ekran w menu |
| 4 | Kompozytor promocji: 7 pól podstawowych + "Zaawansowane"; macierz "Gdzie to działa" -> 1 zdanie | -5 widocznych pól, -1 sekcja |
| 5 | Słownictwo: master -> nazwa systemu, routing -> przydzielenie do pakowania, OMS/adapter znikają z UI, wersje tylko w historii | -6 pojęć |
| 6 | Znaczniki: Gratis bez podpisu źródła na listach; WhoPaysStrip -> jeden wiersz kosztu; ścieżka stanu -> oś czasu | -3 nowe elementy wizualne na linii |
| 7 | Analityka: 3 zakładki (koszt gratisów, zestawy, ruchy) -> 1 raport "Gratisy i zestawy" z filtrem; ruchy magazynowe jako filtr istniejącego raportu ruchów | -2 ekrany |
| 8 | Stanowisko pakowania: bez zmian poza "Gratis do włożenia" (dobrze zrobione, zostawić) | 0 |

Po cięciach: około 5 ekranów zamiast 10 (zestawy, promocje, zamówienie, stanowisko, zwrot) i około 6 nowych pojęć zamiast 15 (zestaw, składnik, gratis, promocja z gratisem, do sprzedania, forma gratisu na dokumencie).

## 8. Uwaga do prototypu

Prototyp ma 155 stanów, bo dokumentuje każdy przypadek z badań. To dobra mapa dla testów i backendu, ale nie wzór interfejsu. Większość stanów powinna być komunikatem w jednym miejscu, a nie osobnym widokiem. Przewodnik scenariuszy i katalog stanów to narzędzia dla zespołu, nie dla sprzedawcy.
