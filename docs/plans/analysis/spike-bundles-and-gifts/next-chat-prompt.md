Jesteś orkiestratorem. Realizujesz dwa epiki OpenLinkera: zestawy #3520, potem gratisy #3935. Sam planujesz, delegujesz, sprawdzasz i commitujesz. Kod pisze agent `Agent` z `model: "sonnet"`, jeden na zadanie. Odpowiadaj po polsku, krótko, bez em dash.

## Źródła (przeczytaj najpierw)
- `gh issue view` dla #3520, jego dzieci (#3606, #3929, #3930, #3607, #3931, #3934, #3624, #3932, #3933, #3625) oraz #3935 i jego dzieci (#3936-#3941, #3943, #3944, #3945). Kryteria akceptacji w issue są kontraktem.
- Spike jest NIEZACOMMITOWANY, w starym worktree:
  `/home/nor/projekty/blocky/openlinker-pnpm-10/.claude/worktrees/zestawy-gratisy-rekonesans-c15354/docs/plans/spike-bundles-and-gifts.md`
  `/home/nor/projekty/blocky/openlinker-pnpm-10/.claude/worktrees/zestawy-gratisy-rekonesans-c15354/docs/plans/analysis/spike-bundles-and-gifts/`
  Najważniejsze: `ports-v1.md` (projekt portów, 16 miejsc w core), `epics-proposal.md`, `rules-check/0-synthesis.md`, `ux-compare/0-synthesis.md`.
- Prototyp v1 (źródło makiet): https://claude.ai/artifact/Gb8o2EKfpDeEDYu39hipZR. Kopia w spike'u: `prototype-v1/zestawy-i-gratisy-v1.html` (zbudowany plik) i `prototype-v1/src/views/v1-*.tsx` (źródło ekranów; ścieżki w `vite.config.mjs` i `build.sh` wskazują stary scratchpad, popraw je przy przebudowie).
- `CLAUDE.md`, `docs/lessons.md` oraz dokumenty z tabeli w CLAUDE.md dla danego zadania.

## Etap 1: zestawy (#3520)
1. Nowy worktree od świeżego `main`, gałąź `3520-bundles-and-kits`. W worktree uruchom `pnpm install`.
2. Pierwszy commit (część #3606):
   - pliki spike'u skopiowane do `docs/plans/analysis/spike-bundles-and-gifts/` i `docs/plans/spike-bundles-and-gifts.md`;
   - makieta `docs/plans/mockups/oms-mvp/m22-bundles-and-kits.html`, zbudowana ze stanów zestawów z prototypu v1, ze stabilnymi `data-mk-state` i `data-testid`.
3. Zadania w tej kolejności (zadania z jednego punktu mogą iść równolegle, jeśli nie dotykają tych samych plików):
   1. #3606
   2. #3929, #3930
   3. #3607
   4. #3931, #3934
   5. #3624
   6. #3932, #3933
4. Pomiń #3625 (E2E). Robimy je dopiero po obu epikach.

## Etap 2: gratisy (#3935)
- Osobny worktree, gałąź `3935-gifts` oparta na `3520-bundles-and-kits`, bo gratisy potrzebują fundamentu #3929 i #3930.
- Pierwszy commit: makieta `docs/plans/mockups/oms-mvp/m31-gifts.html` (część #3936).
- Kolejność zadań:
  1. #3936
  2. #3937, #3938
  3. #3939, #3941
  4. #3940, #3943
  5. #3945
- Pomiń #3944 (E2E).

## Każde zadanie
- **Brief dla agenta Sonnet zawiera:**
  - numer i pełną treść issue;
  - właściwe sekcje `ports-v1.md`;
  - pliki do przeczytania i wzorce w repo;
  - zakres plików, które wolno mu zmieniać;
  - kryteria akceptacji;
  - zasadę: tylko to zadanie, nic więcej.
- **Agent:**
  - nie commituje;
  - uruchamia `pnpm lint` i `pnpm type-check` tylko dla zmienionych pakietów (dla `apps/web` prawdziwy check to `tsc -b`);
  - uruchamia testy jednostkowe tylko dla plików, które dotknął;
  - NIE uruchamia pełnego `pnpm test` ani integracyjnych, bo maszyna jest słaba.
- **Ty sprawdzasz:**
  - diff wobec kryteriów akceptacji i granic architektury (CORE vs integracje, brak nowych obowiązkowych metod w portach, pola opcjonalne);
  - czy copy UI jest w `en.json` i `pl.json`;
  - czy nie ma em dash.
  Jeśli coś jest nie tak, odeślij poprawki temu samemu agentowi przez SendMessage.
- **Commit:**
  - jeden na zadanie, `git commit -s --no-verify`;
  - pliki dodane jawnie, nigdy `git add -A`;
  - wiadomość w stylu `feat(scope): plain words (#N)`.
  `pnpm lint` w niektórych pakietach poprawia pliki sam, więc przed commitem sprawdź `git status`.
- **Migracje:** sprawdź, czy timestamp nie koliduje z istniejącym; uruchom `migration:show`.
- **Po każdym zadaniu:** jedna linia statusu "zadanie X z Y gotowe, następne Z".

## Koniec epiku
1. Przed PR jeden pełny przebieg `pnpm lint`, `pnpm type-check` i `pnpm test`. Na tę maszynę puść go w tle i poczekaj na wynik.
2. Push z jawnym refspec: `git push -u origin 3520-bundles-and-kits:3520-bundles-and-kits`. Nie polegaj na domyślnym `push.default`, bo w worktree pushuje na `main`.
3. PR do `main` (dla gratisów do `3520-bundles-and-kits`, a po merge zestawów zmiana bazy na `main`):
   - PR gotowy do review, nie draft (draft pomija CI);
   - tytuł `feat(oms): ...` prostymi słowami;
   - treść po angielsku, z `Closes #epic` i jedną linią `Closes #N` na każde dziecko oprócz E2E;
   - zrzuty stanów UI.
4. Dopiero wtedy `/pr-review <numer PR>`, potem poprawki.

## Etap 3: E2E (po obu epikach, najpierw zapytaj mnie)
- #3625 i #3944 na lokalnym stacku z sandboxami.
- Macierz kombinacji:
  - źródło: Allegro, Erli, PrestaShop, WooCommerce, Shoper;
  - katalog i sklep docelowy: PrestaShop, WooCommerce, Shoper;
  - każda kombinacja z OMS włączonym i wyłączonym.
  Przykłady: Allegro+Woo, Erli+Presta, Shoper+Woo, Shoper+Presta.
- Dla każdej kombinacji sprawdź:
  - zestaw z gratisem w składzie;
  - multipak;
  - gratis tylko w OL;
  - gratis z kanału, tam gdzie kanał go ma;
  - anulowanie;
  - zwrot składnika;
  - paragon i fakturę (suma równa zapłacie).
- Testy E2E zawsze lądują na `main`.

## Zasady
- **Na GitHubie:** bez mojej zgody nie zakładasz nowych issue, gałęzi zdalnych ani komentarzy. Wyjątek: push gałęzi i PR na końcu każdego epiku.
- **Testy na żywo** tylko w sandboxach i lokalnie.
- **Gdy coś w issue jest sprzeczne z kodem:** zapisz to krótko w PR i mnie zapytaj, nie zgaduj. Dotyczy to też błędów założeń w `ports-v1.md` (numery linii mogły się przesunąć, sprawdź je w kodzie).
- **Komentarze w PR** po angielsku.

Zacznij od przeczytania #3520, `ports-v1.md` i `docs/lessons.md`. Potem pokaż mi plan etapu 1 w 5 punktach i ruszaj.
