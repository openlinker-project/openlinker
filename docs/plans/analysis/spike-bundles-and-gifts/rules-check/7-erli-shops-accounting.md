# Rules check 7 - Erli/Empik sellers, Polish shop sellers, Polish accounting practice

Date: 2026-11-04. Lens: what real sellers on Erli/Empik and Polish shop platforms (PrestaShop,
WooCommerce, Shoper, IdoSell) and their accountants actually do. Research, not legal advice.

**Coverage note (honest):** the web session hit a spend limit after ~15 lookups. Searches that did
not run: PrestaShop PL forum threads, Shoper forum, Gofin / forum księgowych, ifirma/wfirma posts on
grosz rounding. Where a rule depends on them it says "no evidence found", not a guess. Evidence
reused from earlier rounds is cited by file.

## Sources

| id | source | kind |
|---|---|---|
| W1 | https://www.shoper.pl/learn/?p=68759 ("Gratis w sklepie internetowym", 15.10.2026) | official Shoper seller guide |
| W2 | https://pomoc.idosell.com/marketing-i-promocje/rabaty-i-promocje/rabaty-progowe-i-towary-gratisowe | official IdoSell help |
| W3 | https://bezprawnik.pl/zwrot-produktu-z-gratisem/ | consumer-law blog |
| W4 | https://spolecznosc.allegro.pl/t5/dyskusje-kupuj%C4%85cych/czy-zwracac-gratis/m-p/261612 | Allegro community thread (real case) |
| W5 | https://bezprawnik.pl/jak-rozliczac-gratisy-w-sklepie-internetowym | blog (old: still says 10 zł) |
| W6 | https://www.taxenlight.com/vat-oss-faktury-ksef-jpk-kasa-fiskalna/ | tax advisory blog |
| W7 | https://www.shoper.pl/learn/?p=1252 (OSS invoices in Shoper) | official Shoper help |
| W8 | search snippets: poradnikprzedsiebiorcy.pl "ewidencja prezentów o małej wartości - wzór", podatki.biz "NSA: wartość małych prezentów jest kwotą netto" | secondary |
| W9 | PrestaShop 1.6 PL docs "Reguły koszyka" (search snippet only, page not fetched) | official docs |
| W10 | https://media.empik.com/content/regulaminy/Regulamin_Kolekcja-Walentynki_Drugi-50_28012026.pdf (search summary) | Empik promo terms |
| R-* | reuse: r3/phase1/3-pl-saas-and-erp.md, r4/phase1/3-pl-saas-and-erp.md, r3/phase1/4-other-marketplaces.md, r5/3-marketplaces-countries.md, r5/8-tax-fiscal.md, verify/eparagony-gift-forms.md, verify/prestashop-live.md | earlier rounds |

## Per rule

### P1 - skip gift promotion when the bundle already contains the gift
- Practice: no evidence found that any PL shop tool or seller does this. IdoSell forbids the opposite
  direction only: "Towar Gratisowy nie może być zestawem." (R4 3-pl-saas S7). Shoper W1 is silent.
- **DROP.** Edge case nobody models; the operator controls the promotion's product scope instead.

### P2 - per-customer limit by channel buyer id, not e-mail
- Practice: Shoper W1 recommends "Ustal pulę prezentów i limit przypadający na jedno zamówienie lub
  klienta." PrestaShop cart rules have quantity + quantity per user, keyed on the shop customer
  account (R3 2-own-shops line 96). Nobody describes alias e-mails; that is Allegro-specific.
- **SIMPLIFY:** keep a per-order limit and a per-customer limit keyed by OL's already-resolved
  customer id (identity resolution exists), not a new channel-buyer-id key.

### P3 - priority number; "does not combine" loses to higher priority
- Practice: PrestaShop cart rules have a priority field and a "cannot be combined with other rules"
  restriction (W9 snippet: "reguła ta nie może być łączona z innymi"). IdoSell: when two discounts
  meet, "zostanie wybrana bardziej korzystna opcja" (W2). Shoper W1: "Wyjaśnij, czy promocja łączy
  się z innymi rabatami." / "Możesz również wyłączyć możliwość łączenia ofert." Empik own promo:
  "nie łączy się z innymi promocjami" (W10).
- **ADOPT** (PrestaShop's exact shape: priority + non-combinable flag). Proven, sellers know it.

### P4 - budget by purchase cost, auto-pause, no budget without cost
- Practice: sellers cap by **count** ("Możesz ustalić maksymalną pulę prezentów", W1). IdoSell
  requires the gift to have stock and stops when it has none: "musi być widoczny na stronie sklepu i
  posiadać stan magazynowy" (W2). No tool found with a money budget on purchase cost.
- **SIMPLIFY:** gift pool = number of units (and/or "while gift stock lasts"); pause when exhausted.
  Drop the cost-budget and the "no cost, no budget" gate.

### P5 - which date counts; 1 gift per N qualifying units
- Practice: date choice - no evidence. Per-unit gifts: IdoSell sells "2+1 gratis inside a set"
  (R3 3-pl-saas S15); Empik/Mirakl `FREE_ITEMS` with `free_items_quantity` (R3 4-other-marketplaces).
- **SIMPLIFY:** use order placed date only; keep "1 gift per N units" (common, Mirakl has it).

### O1 - gift line id `ol-gift:{ruleId}:{lineId}`
- Practice: not a seller concern; IdoSell flags the line instead ("Towary w zamówieniach zawsze będą
  oznaczone jako gratis", W2; API `orderSalesMode = "gift"`, R4 3-pl-saas).
- **ADOPT** (internal, deterministic id is harmless) - but the visible thing sellers rely on is a
  gift flag on the line.

### O2 - manual gift add, guarded by stage
- Practice: real sellers add gifts by hand at packing ("sprzedawca ... dołożył gratis", W4) - the
  case W4 shows the downside: no trace on the order, then a dispute. No evidence of staged rules.
- **SIMPLIFY:** allow before packing; after packing refuse; after invoice warn. One warn path is
  enough; the "after routing = new pack task" nuance can wait.

### O3 - Allegro multipack held until a bundle "3 x coffee" exists
- Out of this lens (Allegro). Shoper/IdoSell answer the same need natively with sets whose stock is
  derived from components (R4 3-pl-saas PLS-03, PLS-11). No evidence against holding.
- **ADOPT** (hold beats silently selling 1 unit for the price of 3).

### O4 - ended promotion read-only; duplicate to change
- Practice: no evidence found in the PL tools checked. Shoper W1 advises fixing terms before start.
- **ADOPT** cheap and safe (keeps the record of what buyers were promised), but no evidence it is
  needed; could DROP to "edit allowed, history kept".

### D1 - gift at 0,01 zł, grosz taken from a paid line
- Practice: Shoper gift app: "Prezent może być darmowy lub kosztować na przykład 1 grosz, czy też
  symboliczną złotówkę." (R3 3-pl-saas S5) - i.e. sellers ADD the grosz, the buyer pays it. KIS
  accepts 1 gr as a paid supply (R5 8-tax-fiscal S9). eparagony live: moving value between lines at
  different rates is accepted but "Do not use" (verify/eparagony-gift-forms.md, test 2). No evidence
  of any tool silently shifting a grosz from a paid line.
- **SIMPLIFY:** if 1 gr, take it only from a paid line of the SAME VAT rate; otherwise do not use
  1 gr - omit the gift line. Never shift value across rates.

### D2 - split a line whose value does not divide by quantity
- Practice: no evidence found (searches on grosz rounding did not run). Kasa rules require qty, unit
  price and line value (R4 4-marketplaces-and-law L2 par. 26).
- **ADOPT** as a mechanical necessity, no seller-facing option.

### D3 - rounding remainder to the largest paid line, never a gift line
- Practice: Comarch POS spreads a header discount over all lines (search: "rabat nagłówka ...
  naliczanym na wszystkie pozycje"); remainder placement not documented anywhere found.
- **ADOPT** (common "largest line takes the remainder" approach; no counter-evidence).

### D4 - whole-order discount holds the document until operator clicks "spread"
- Practice: Comarch POS spreads automatically. eparagony accepts a `REBATE` line with `taxRate` and
  prints correct VAT (verify/eparagony-gift-forms.md test 4). IdoSell splits set prices with a fixed
  proportional rule automatically (R4 3-pl-saas). No tool found that asks the operator first.
- **SIMPLIFY:** spread proportionally automatically (per-rate, remainder per D3); hold only when it
  cannot be spread (e.g. a rate bucket would hit 0).

### D5 - Erli EUR order with DE VAT: no automatic PLN document, wait for review
- Practice: OSS sales are exempt from the cash register: "Polskie przepisy przewidują zwolnienie z
  obowiązku ewidencjonowania na kasie dla sprzedaży rozliczanej w OSS." (W6). Shoper invoices them
  automatically at the DE rate: "na fakturze będzie widniała stawka VAT 19%(DE)" with prefix "OSS"
  (W7). Invoice may use a different FX rule than the OSS return (W6). OL today books Erli EUR orders
  as PLN and labels TAX_19 as PL (R5 3-marketplaces C-023).
- **ADOPT for now** (holding is the only safe thing while OL ingests EUR as PLN), but the target is
  NOT a review queue: never a receipt for OSS, an OSS invoice only when the buyer asks.

### D6 - returns
- (a) Allegro-specific; no evidence from this lens. ADOPT as proposed.
- (b) Kept gift: practice is that terms usually require returning the gift or its value: "w
  przypadku zwrotu towaru takie produkty trzeba oddać ... sklepy często wymagają uregulowania za nie
  równowartości pieniężnej" (W3). Shoper W1 says the opposite default: "Nie ma automatycznej zasady
  nakazującej zwrot gratisu ..." Real dispute (W4): seller blocks refund over a gift not in the
  offer; moderator: on withdrawal return "wszystko, co otrzymałeś", on rękojmia not needed. **ADOPT**
  (never auto-deduct; operator decides) - matches the split in practice.
- (c) Claw-back proposal for a lost set discount: W3 "Gdy kupujemy takie produkty ... mamy do
  czynienia z nabyciem zestawu" - sellers refuse single returns from 1+1 rather than compute a
  claw-back. IdoSell allows component returns only for sets not printed as one line (R3 3-pl-saas
  S14). **SIMPLIFY:** show the lost discount as information; no editable claw-back proposal.

### C1 - "take composition from PrestaShop" button
- Practice: PrestaShop does not freeze pack composition and moves no component stock per sale
  (R5 2-shops-erp C-013). Sellers treat the shop's pack as the master.
- **ADOPT** (one-click sync from the master is the expected "don't reinvent" move).

### C2 - small-gift register keyed by resolved customer
- Practice: the register must allow "ustalenie tożsamości tych osób" (art. 7 ust. 4); contents per
  advisers: date, item, value, recipient data, no statutory template (W8). Value is net purchase
  price (NSA, W8). Shoper W1 repeats 20/100 zł net. Blogs still circulating 10 zł (W5) are outdated.
  No evidence of any PL shop tool keeping this register automatically; it matters only if the gift is
  treated as gratuitous (R5 8-tax-fiscal C-034).
- **SIMPLIFY:** export a list (date, customer, gift, net purchase price, document) per year for the
  accountant; key by resolved customer. No live 100 zł enforcement in OL.

### C3 - option "hold every document with a gift until a decision"
- Practice: no evidence any tool offers this. IdoSell and Shoper decide gift presentation once, in
  document print settings (W2: "Ustawienia wydruków dokumentów sprzedaży").
- **DROP.** One per-connection gift-document setting (omit / 1 gr same rate / priced-in) is enough;
  hold only the documents that setting cannot produce (D1/D4 fallback).

## Three strongest real cases

1. **Allegro community "czy zwracać gratis"** (W4): seller added a gift by hand, withheld the refund
   until it came back; buyer never knew about it. Shows why manual gifts need a trace (O2) and why
   OL must never auto-deduct (D6b).
2. **Shoper Maxsote gift app** (R3 3-pl-saas S5): "Prezent może być darmowy lub kosztować ... 1
   grosz" - sellers' real 1 gr practice ADDS the grosz; nobody steals it from another line (D1).
3. **Shoper OSS invoices** (W7) + **OSS kasa exemption** (W6): established tools issue DE 19% OSS
   invoices automatically and no receipt - the target for Erli `market: de` orders (D5).
