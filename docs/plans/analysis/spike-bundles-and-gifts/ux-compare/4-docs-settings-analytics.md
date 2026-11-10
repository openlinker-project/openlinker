# UX: dokumenty, ustawienia, analityka vs konkurencja

Zakres: ekrany "Paragon i faktura", "Ustawienia połączeń", "Koszt gratisów i zestawy" w prototypie
(https://claude.ai/artifact/BW7nwWCTFJokJTtTkkSkFJ). Źródła: zrzuty settings/prestashop,
analytics/gifts-overview, analytics/bundles-margin oraz raporty r2, r3, rules-check.

## Ile decyzji przed pierwszym dokumentem

| Narzędzie | Decyzje operatora o gratisie i zestawie na dokumencie |
|---|---|
| Shoper | 0. Faktura ma nazwę zestawu, WZ składniki (r3 S3, shoper.pl/learn/?p=1108) |
| IdoSell | 1 przełącznik "Pokazuj zestaw jako jedną pozycję na dokumentach sprzedaży" (r3 S13) |
| Sellasist | 1 wybór w akcji automatyzacji: gratis + linia "Rabat" w każdej stawce albo "Ukryj na dokumentach" (rules-check/3) |
| BaseLinker | 1 przełącznik per integracja: rozbijać zestawy czy nie (r2 1-baselinker) |
| Apilo | 0. Rabat rozbijany sam na pozycje, zestaw przeliczany proporcjonalnie (rules-check/2) |
| OpenLinker (prototyp) | 0 wymaganych (domyślnie "pomiń"), ale ekran pokazuje 3 sekcje, 5 form gratisu z oceną ryzyka, nadpisanie deklaracji adaptera, macierz 4 dostawców x 4 możliwości i podgląd |

Wniosek: logika już nie wymaga decyzji, ale ekran wygląda, jakby wymagał pięciu. To problem prezentacji, nie modelu.

## Problemy, od najważniejszego

1. **"Gratis na dokumencie": 4 formy + 5. wyłączona + plakietki ryzyka + akapit prawny.**
   Konkurencja daje 0-2 opcje bez oceny ryzyka. Operator nie umie wybrać między "udział w cenie"
   a "ewidencja art. 7 ust. 2", to pytanie do księgowej. Ryzyko "niskie do średniego" przy groszu
   brzmi jak ostrzeżenie, którego nikt nie rozumie.
   Prościej: domyślnie "Pomiń gratis na dokumencie" bez wyboru. Jedna linia "Zmień formę
   (dla księgowej)" rozwija 2 alternatywy: "w zapłaconej kwocie" i "ewidencja nieodpłatnych".
   Grosz nie jest opcją, tylko automatem tam, gdzie dostawca odrzuca 0 i stawka się różni.
   Wyłączony "rabat 100%" usunąć z ekranu, zostawić w notatce dla księgowej.

2. **Macierz "Co deklaruje dostawca dokumentów" (4 x 4, "nie deklaruje, traktujemy jak nie").**
   To informacja dla programisty. Żaden konkurent nie pokazuje możliwości API dostawcy.
   Prościej: usunąć tabelę. Gdy deklaracja coś zmienia, jedno zdanie przy formie gratisu, np.
   "Subiekt GT nie przyjmuje pozycji za 0,00 zł, więc gratis w innej stawce dostanie 0,01 zł".

3. **"Jak kanał wysyła zestawy": deklaracja adaptera + "Gdzie jest cena i VAT" + nadpisanie.**
   BaseLinker ma to jako jeden przełącznik w integracji, Shoper i Apilo nie pytają wcale.
   Prościej: sekcja ukryta, gdy adapter deklaruje kształt. Widoczna tylko w stanie "Shoper:
   nieznane", jako pytanie "Jak Twój sklep wysyła zestawy?" z 2 odpowiedziami.

4. **Wstrzymania dokumentów zamiast automatów.** Stany "Gratis w innej stawce, wstrzymany",
   "Grosz bez pozycji w tej stawce", "Brak klucza podziału" kończą się kolejką ręczną.
   Sellasist i Apilo nie wstrzymują: dają linię rabatu albo dzielą proporcjonalnie.
   Prościej: przy "pomiń" i innej stawce przejść automatycznie na "udział w zapłaconej kwocie"
   (suma się zgadza, VAT nie przeskakuje między stawkami) i zapisać to na osi czasu.
   Wstrzymanie tylko przy "Brak klucza podziału" (brak ceny i kosztu składnika).

5. **Ekran "Paragon i faktura" jako osobna strona z 3 listami wyboru.** To laboratorium do
   prototypu, nie ekran produktu. U konkurencji podgląd dokumentu jest w zamówieniu.
   Prościej: w produkcie podgląd tylko w szczegółach zamówienia i w panelu obok ustawień.
   W prototypie zostawić jako przewodnik, ale opisać "tylko do demo".

6. **Analityka: 3 zakładki, 6 kart KPI, wykres, tabela z paskami limitu, podzakładki
   (promocje / kanał / eksport), plus marża zestawów i popyt na składniki.**
   BaseLinker i Apilo nie mają raportu gratisów wcale (r3 G-12: "No gift report found;
   only generic product stats"). Shopify ma ogólny raport rabatów.
   Prościej na v1: jedna tabela "Gratisy według promocji" (szt., zamówienia, koszt netto,
   limit) + "Klient zapłacił 0,00 zł, kosztowało Cię X" + eksport CSV per klient.
   Kanał jako kolumna, nie podzakładka. Ruchy magazynowe jako filtr powodu "gratis"
   w istniejącej historii ruchów, nie nowa zakładka.

7. **Karty KPI "Udział w marży", "Koszt na zamówienie z gratisem", trend vs 35 dni.**
   Brzmią jak raport finansowy, wymagają kosztów zakupu na wszystkich wariantach.
   Odłożyć do etapu z kosztami (#3588). Zostawić: wydane szt., koszt netto, koszt nieznany.

8. **Zakładka "Zestawy": marża i popyt na składniki.** BaseLinker ma tylko tag kosztu zestawu
   do wydruków (r2 B-16), bez raportu marży. Na v1 wystarczy marża zestawu w istniejącej
   analityce produktów jako zwykły produkt. Popyt na składniki odłożyć.

## Minimalny v1

- Ustawienia połączenia: jedna sekcja "Dokumenty" z dwiema linijkami:
  - "Gratis: pomijany na dokumencie" [Zmień, dla księgowej],
  - "Zestaw: jedna pozycja" [Pokaż składniki] (jak przełącznik IdoSell).
  - Obok mały podgląd paragonu.
- Kształt zestawu z kanału: tylko gdy adapter nie deklaruje.
- Dokument: zero wstrzymań poza brakiem klucza podziału; grosz i "udział w kwocie" jako automaty.
- Analityka: jedna strona, tabela promocji, pasek "kosztowało Cię X", eksport CSV.

## Co zostawić bez zmian

- Pasek "Klient zapłacił 0,00 zł · Kosztowało Cię X". Nikt tego nie ma, a to najjaśniejszy przekaz.
- Podgląd paragonu obok ustawienia: od razu widać skutek wyboru.
- Domyślne "pomiń" bez obowiązkowej decyzji (już jest).
- Eksport per klient zamiast rejestru (zgodne z rynkiem).
- "Netto, bez VAT" i "koszt zakupu z dnia wydania" przy kosztach.
