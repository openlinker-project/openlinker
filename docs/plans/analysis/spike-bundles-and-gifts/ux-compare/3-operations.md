# UX w codziennej pracy: zamówienia, stanowisko, zwroty

Zakres: lista zamówień, szczegóły zamówienia (linia gratisu, pasek "Klient płaci / Kosztuje Cię", ścieżka stanu, panel cen, dialog "Dodaj gratis"), stanowisko pakowania, zwroty.

Na czym oparty:
- zrzuty stanów `orders/all`, `order/bundle-plus-gift`, `order/gift-ol-only`, `order/add-gift-before-packing`, `bench/in-progress`, `returns/bundle-one-component`, `returns/gift-kept`;
- wcześniejsze raporty spike'u (r1, r3 merchant voice, rules-check/*);
- bez nowych wyszukiwań w sieci.

## Wniosek w jednym zdaniu

Stanowisko pakowania jest na poziomie rynku albo lepsze. Szczegóły zamówienia i lista mówią to samo 3-5 razy w różnych formach. Konkurencja pokazuje gratis i zestaw raz, w linii, a resztę chowa w szczegółach linii albo w historii.

## Problemy od najważniejszego

### 1. Ten sam gratis pokazany 4-5 razy na jednym ekranie (szczegóły zamówienia)
- W stanie "Zestaw z gratisem w składzie" łyżeczka pojawia się w 5 miejscach:
  1. znacznik "Gratis" w nagłówku;
  2. wiersz w tabeli pozycji;
  3. osobna sekcja "Gratis w tym zamówieniu" z paskiem kosztu i ramką wyjaśnienia;
  4. ścieżka "Gdzie idzie stan";
  5. wiersz w "Ceny i kto płaci", plus "Koszt gratisów dla Ciebie".
- Konkurencja:
  - BaseLinker: gratis to zwykła linia, rozpoznawalna tylko po nazwie (rules-check/1);
  - Apilo: linia zestawu z ikoną (rules-check/2);
  - Sellasist: zwykła pozycja produktu plus linia "Rabat" (rules-check/3);
  - Shopify: linia z przekreśloną ceną i "Free" z kodu rabatowego. Nikt nie ma osobnej sekcji gratisu.
- Propozycja:
  - zostawić znacznik w linii i jedną kwotę kosztu w panelu cen;
  - sekcję "Gratis w tym zamówieniu" usunąć, a jej treść (źródło, kto finansuje) przenieść do podpowiedzi po kliknięciu znacznika "Gratis";
  - znacznik w nagłówku zostawić tylko na liście.

### 2. "Gdzie idzie stan" jako stała sekcja przy każdej pozycji
- Trzy prawie identyczne ścieżki "Zarezerwowano - Spakowano - Zdjęto ze stanu", różniące się tylko słowem "powód: gratis". Przez 99% czasu niosą zero informacji.
- Konkurencja:
  - Linnworks: rezerwacja i zdjęcie stanu żyją w historii stanu produktu;
  - Shopify: status realizacji jest jeden na zamówienie (Unfulfilled / Fulfilled);
  - BaseLinker: jeden status zamówienia i log.
- Propozycja:
  - pokazywać ścieżkę tylko, gdy coś jest nie tak (zdjęcie stanu zablokowane, sklep odrzucił linię 0,00, OMS wyłączony i linia poszła do sklepu);
  - w zwykłym przypadku jedna kolumna "Rezerwacja" w tabeli wystarcza, a ona już jest.

### 3. "Część zestawu: X" powtórzone w każdej linii i w każdej sekcji
- W tabeli pozycji składniki są wcięte pod zestawem, a mimo to każdy ma jeszcze podpis "część zestawu: Zestaw poranny". To samo w ścieżce stanu i na stanowisku.
- Shopify: składniki zgrupowane pod nagłówkiem zestawu, bez powtarzania nazwy. ShipStation ma przeciwny błąd (nazwa zestawu drukowana 5x na liście kompletacyjnej) i kupcy się skarżą (r1 merchant voice).
- Propozycja: wcięcie i nagłówek zestawu wystarczą. Podpis zostawić tylko tam, gdzie składnik stoi poza grupą (lista zwrotów, ruchy magazynowe).

### 4. Techniczne identyfikatory widoczne dla operatora
- Widoczne są `L1~c:mug`, `L1~g:spoon`, `ol_order_...` i "Zestaw - wersja 2" w tabeli pozycji. Operator ich nie potrzebuje; konkurencja pokazuje SKU i EAN, nie klucze linii.
- Propozycja: klucz linii schować (tooltip albo widok deweloperski). Wersję zestawu pokazywać tylko, gdy zamówienie trzyma starszą wersję niż obecna.

### 5. Lista zamówień: do 5 znaczników w kolumnie Status i ramka uwag nad listą
- Wiersz może mieć: zdrowie + faza + Zestaw + Gratis + powód wstrzymania + "Pakowanie: ...". Do tego ramka "Zestawy i gratisy: wymaga uwagi" z 6 kategoriami, która dubluje kafel "Wymaga uwagi" obok.
- Konkurencja:
  - BaseLinker i Apilo: status zamówienia (jeden kolor) i ikony przy produkcie;
  - Linnworks: kolumna stanu plus jedna kolumna "flags";
  - Shopify: 2 znaczniki (płatność, realizacja) i tagi.
- Propozycja:
  - w Status: jeden znacznik stanu i najwyżej jeden powód;
  - Zestaw i Gratis jako małe ikony przy nazwie produktu w kolumnie "Zamówienie", nie w kolumnie Status;
  - ramkę uwag zwinąć w filtr pod kaflem "Wymaga uwagi", z podziałem na powody dopiero po kliknięciu.

### 6. Panel "Ceny i kto płaci" za szczegółowy na co dzień
- 7 wierszy: cena katalogowa, rabat zestawu, gratis w zestawie z wartością katalogową "nie wlicza się do sumy", dostawa, zapłacił, koszt gratisów.
- Wiersz z kwotą, która się nie sumuje, myli: operator liczy kolumnę i nie wychodzi.
- Shopify: subtotal, rabaty (jeden wiersz z kodem), dostawa, total.
- Propozycja: domyślnie "Produkty / Rabaty / Dostawa / Zapłacono" plus jedna linia "Koszt gratisów 3,90 zł". Rozbicie rabatów pod "Pokaż szczegóły".

### 7. Dialog "Dodaj gratis" ma ścieżkę stanu w podglądzie
- Dobre: produkt, ilość, powód, "Klient płaci 0 / Kosztuje Cię 3,90". Zbędne: trzy kroki "Zarezerwowano - Spakowano - Zdjęto ze stanu".
- BaseLinker i Apilo: dodanie produktu do zamówienia to wybór produktu i ilości, cena 0.
- Propozycja:
  - zostawić produkt, ilość, powód i jedną linię kosztu;
  - ścieżkę zastąpić zdaniem "Pakowacz zobaczy go w paczce";
  - powód jako opcjonalny (Sellasist i BaseLinker go nie wymagają), ale przydatny do analityki.

### 8. Zwroty: kwota zwrotu w trzech miejscach naraz
- W "Zwrot jednego składnika" są:
  - wartość kawy na dokumencie;
  - "Skąd ta kwota";
  - "Kubek zostaje u klienta";
  - pole kwoty;
  - podpowiedź 25,00 zł z przyciskiem;
  - "Do zwrotu";
  - notka o korekcie.
- Allegro: panel zwrotu ma jedną kwotę do edycji (rules-check/6, F1). Sellasist: edytowalna kwota zwrotu (rules-check/3).
- Propozycja:
  - jedno pole kwoty z domyślną wartością;
  - pod nim jedna linia "Według wzoru Allegro: 25,00 zł. Użyj";
  - tabelę "Skąd ta kwota" schować pod "Pokaż wyliczenie".

## Co jest dobre i zostaje

- **Stanowisko pakowania.**
  - Duża karta bieżącej pozycji, skan składników zamiast kodu zestawu, gratis jako osobna pozycja "Włóż gratis" ze skanem, licznik "1 z 3", paczka zamyka się sama.
  - To odpowiada na najczęstszą skargę rynku: "orders were flying out the door without the gift" (r3 PAIN-06) oraz "they have no idea that ... is a bundle" (PAIN-05).
  - Jedyna poprawka: usunąć podpis "część zestawu" w liniach, bo nagłówek "Zestaw poranny: 1 z 2" już to mówi.
- **Pasek "Klient płaci 0,00 zł / Kosztuje Cię 3,90 zł".** Krótki i zrozumiały; nikt z konkurencji tego nie ma, a sprzedawcy pytają o koszt gratisów. Zostawić, ale raz: w linii lub w panelu cen.
- **Znaczniki Zestaw / Gratis na liście i filtry "Z gratisem", "Z zestawem".** Zostają, tylko przeniesione bliżej nazwy produktu.
- **Historia zamówienia z wpisem "Promocja pominięta: gratis jest już w składzie zestawu".** To jest właściwe miejsce na wyjaśnienia, zamiast osobnych ramek.

## Czego operator nie potrzebuje na co dzień (zwinąć albo pokazać tylko przy problemie)

| Element | Kiedy pokazywać |
|---|---|
| Ścieżka stanu per pozycja | tylko przy błędzie stanu albo OMS wyłączonym |
| Sekcja "Gratis w tym zamówieniu" | nigdy osobno, zamiast niej podpowiedź na znaczniku |
| Rozbicie rabatów w panelu cen | pod "Pokaż szczegóły" |
| Klucze linii (`L1~g:...`) i id zamówienia OL | tooltip albo widok deweloperski |
| Wersja zestawu | tylko gdy zamówienie ma starszą wersję |
| Wyliczenie kwoty zwrotu | pod "Pokaż wyliczenie" |

## Co pakowacz faktycznie potrzebuje

Konkurencja (Linnworks, ShipStation, Shopify slip) i skargi z r1/r3 sprowadzają się do pięciu rzeczy:
1. co włożyć;
2. ile;
3. skąd wziąć (półka);
4. które pozycje są jednym zestawem;
5. czy jest gratis.

Stanowisko w prototypie ma wszystkie pięć i nic ponad to. Nie dokładać tu kosztów, powodów ani promocji.
