# Rules check 6 - Allegro sellers and Allegro's own rules

Date: 2026-11-04. Read-only. Lens: what real Allegro sellers do today, and what Allegro allows or forbids.
This is not legal advice. "No evidence" means I looked and found nothing; it does not mean "safe".

## Sources

New in this round (read today):

| ID | Source | Kind |
|---|---|---|
| H1 | https://help.allegro.com/pl/sell/a/gratisy-i-rabaty-GRv3MZbPEc0 | Official Allegro seller help |
| H2 | https://help.allegro.com/pl/sell/a/czym-sa-miniaturki-i-jak-je-stosowac-zgodnie-z-naszymi-zasadami-D7aze0AkDh7 (FAQ "Czy na zdjęciu mogę pokazać gratisy?") | Official Allegro seller help |
| H3 | https://help.allegro.com/pl/sell/a/czym-sa-zestawy-produktow-E7kk0kxqaCa ("Jak sprzedawać zestawy produktów") | Official Allegro seller help |
| H4 | https://help.allegro.com/pl/sell/a/jak-tworzyc-zestawy-elastyczne-6MVrBLWnWt0 | Official Allegro seller help |
| F1 | spolecznosc.allegro.pl thread 1207471 (2026-07-28/29), moderators N_Nitka28, w_kiwi | Official moderator answers |
| F2 | thread 931891 (2024-12-16), "kup 2 sztuki a 3 sztukę dostaniesz gratis - realizacja zwrotu" | Sellers quoting Allegro return clauses |
| F3 | thread 1001457 (2025-04-09), "Uznana reklamacja i odliczenie kwoty gratisu" | Buyer + sellers |
| F4 | thread 75425 (2020-08-26), "Kupujący nie chce oddać gratisów" | Sellers |
| F5 | thread 919655 (2024-11-28), "Zestaw kilku sztuk a rozbijanie go w BaseLinker" | Sellers |
| F6 | thread 1120033 (2025-11-27), "Zestaw kilku sztuk, który nie istnieje" | Seller + moderators |
| F7 | thread 1205956 (2026-07), "wielosztuki wielopaki" | Buyer + moderators |
| F8 | thread 755744 (2024-03-14), LEGO "zestaw z prezentem" campaign | Buyer + moderators |
| F9 | thread 500411 (2023-01-05), "Gratis do zakupów" | Former moderator + sellers |
| F10 | thread 1050074 (2025-07-15), gift advertised after the promotion ended | Seller + moderator |
| F11 | thread 1097938 (2025-10-15), hidden allegromail address | Sellers |
| F12 | thread 1206979 (2026-07-26), "Faktury na rynki zagraniczne" | Sellers |
| F13 | thread 43226 (2020-06-12), Allegro invoice VAT rounding | Sellers |
| F14 | thread 1233489 (2026-10-28), buyer returns 1 of 2 | Sellers |
| S1 | Allegro swagger `CheckoutFormBuyerReference` + `allegromail.pl` example (local copy r1/phase1/dl/swagger.yaml l.30520, 39578) | Official API spec |

Read with the Khoros LiQL API (`spolecznosc.allegro.pl/api/2.0/search`), which returns the author's rank, so
"Moderacja Społeczności" answers are told apart from ordinary users. Reused from earlier rounds:
r4/phase1/1-allegro.md, r5/1-allegro-pl.md, verify/allegro-line-price.md, r2-r4 merchant-voice reports
(threads 49695, 727363, 868973, 872042, 794953, 1020390).

Not reachable: allegro.pl offer and listing pages (HTTP 403 to curl), so I could not quote real live offer
pages; the offer cases below come from forum threads that link and describe them. Web search hit a spend
limit midway, so accounting blogs were not re-read; tax facts are taken from r5/8-tax-fiscal.md.

## The finding that matters most

Allegro tells sellers to build a gift **as a product set**, not as a promotion (H1, verbatim):

> "Jeśli samodzielnie dodajesz gratis do produktu, skorzystaj z opcji zestawu produktów. Stwórz zestaw, który
> składa się z produktu głównego i produktu, który będzie gratisem."
> "Jeśli gratis jest częścią oryginalnego zestawu, upewnij się, że w Katalogu Produktów Allegro pod tym numerem
> EAN znajduje się produkt, który również uwzględnia taki gratis. Jeżeli pod tym kodem EAN w Katalogu znajduje
> się wyłącznie produkt główny, czyli bez gratisu, musisz wystawić ofertę jako zestaw produktów."
> "Oferowanie gratisów ... jest na Allegro dozwolone. Pamiętaj jednak, by kupujących, którzy otrzymają gratis lub
> rabat, nie wyłaniać drogą losowania. Możemy usunąć ofertę, jeśli narusza tę zasadę."

H2 repeats it ("Ofertę wystaw jako zestaw produktów") and allows the gift on the thumbnail if every buyer gets it.
Allegro does this itself: its 2024 LEGO campaign "Zestawy Lego z prezentem" was a set "LEGO City 60398 + LEGO
Ptasie gniazdo 40639" at 259,90 zł; a seller replied "to nie jest gratis tylko doliczone" (F8).

So on Allegro a **listed** gift arrives on the order as a `productSet` component with no price of its own
(r4 ALG-01). The other two shapes are a 100%-discounted Nth unit (CROSS_MULTIPACK; single-offer MULTIPACK ends
12-01-2027) and an unlisted extra slipped into the box (F9: "dorzucic gratis z karteczka"; F4). An OL gift
promotion on Allegro orders is therefore the rare case, not the common one.

## Per rule

### P1. Skip a gift promotion when the bundle already contains the gift
- **Allegro rule**: a seller's own gift must be a product set component (H1). It therefore shows up as a
  component of the bundle line, exactly the case P1 guards.
- **Seller practice**: sellers list "Smartfon + fotoetui + głośnik" as one offer (F10); LEGO + gift set (F8).
- **Recommendation: ADOPT.** On Allegro this is the normal shape of a gift, so without P1 the buyer gets two.

### P2. Per-customer limit by channel buyer id, not e-mail
- **Allegro fact**: the buyer e-mail is an alias, `hamu7udk3p+17454c1b6@allegromail.pl` (S1 l.39578); sellers
  confirm the masked address differs per counterpart: "ten "ukryty" e-mail jest inny dla każdego kupującego"
  (F11, KOGIEL_T, 2025). `buyer.id` and `login` are required fields (S1 l.30520). Allegro's own campaigns limit
  "na kupującego" (H4, "kampania z limitem na kupującego lub liczbę sztuk").
- **Seller practice**: no evidence of Allegro sellers running per-customer gift limits at all ("Polish per-customer
  gift limits: nothing", r3 merchant voice).
- **Recommendation: ADOPT** (key by `buyer.id`), but keep the limit itself optional; `buyer.guest` orders have
  unknown id stability (no evidence).

### P3. Several promotions: priority number; "does not combine" loses
- **Allegro rule**: Allegro uses a fixed rule, not a priority: "Jeśli oferta ... bierze udział w kampanii
  obniżającej cenę, to taką ofertę dalej można kupić w zestawie – ale bez rabatu z tego zestawu" (H4).
- **Seller practice**: no evidence of Allegro sellers stacking several gift promotions.
- **Recommendation: SIMPLIFY** to "one gift promotion per order unless marked combinable; ties go to the
  newest/most specific" with an optional priority field later. Allegro gets by without a number.

### P4. Gift budget in purchase cost, auto-pause
- **Allegro rule**: Allegro limits campaigns by units ("limit ... liczbę sztuk", H4), never by money.
- **Seller practice**: sellers phrase gifts by threshold ("Od pewnej sumy dodajemy ... gratis (ok. 70 zł)", F4)
  and by end date ("promocja była do 30 maja", F10). No evidence of cost budgets.
- **Recommendation: SIMPLIFY** to a gift-unit cap (and pause when gift stock is 0). Drop the money budget and
  the "no purchase cost blocks activation" rule.

### P5. Which date counts; gift per qualifying unit
- **Seller practice**: the real failure is the gift still shown after the end date (F10, moderator took it to
  the team). "Kup dwa ... a trzeci gratis" is a common request; the answer is Allegro's own 100% discount on the
  3rd unit (thread 1020390, r4).
- **Recommendation: SIMPLIFY.** Use one date, the order-placed date (`boughtAt`); drop the choice. Keep
  "per qualifying unit" for shops; on Allegro the channel already does it natively.

### O1. Gift line id `ol-gift:{ruleId}:{lineId}`
- **No seller evidence** (internal). Allegro angle: an OL-added line has no Allegro `lineItem.id`, so waybill,
  refund and return writebacks must skip it (r5 3F).
- **Recommendation: ADOPT** (deterministic id, never sent to Allegro).

### O2. Operator adds a gift manually (gates by stage)
- **Seller practice**: manual ad-hoc gifts are common ("Daj mu gratis do paczki cukierka", 1008380; F9); careful
  sellers record them: "Zawsze dodajemy gratisy do paragonu albo wpisujemy na fakturę za zero, oraz wpisujemy go
  do karty gwarancyjnej" (F4, AGD-SERVICE).
- **Recommendation: ADOPT.** The "after invoice: warn" step matches what careful sellers do.

### O3. Hold an Allegro multipack until a bundle "3 x coffee" is defined
- **Allegro rule**: Allegro can turn offers into multipacks without the seller: "Możemy automatycznie oznaczyć
  takie aktywne oferty kup teraz jako zestawy produktowe ... O każdej takiej zmianie damy Ci znać mejlowo" (H3).
  Single-offer MULTIPACK discounts are replaced by `productSet` with `quantity.value > 1` from 12-01-2027 (r4 S2).
- **Seller practice**: "Sprzedałem w zestawie 2 sztuki towaru, problem polega na tym, że ja tego zestawu nie
  tworzyłem" (F6). In BaseLinker an imported multipack "łączą się od razu z produktem o tym samym EANie i dodaje
  jako 1 droga aukcja"; the fix sellers use is to define a set "10 x Sznurówki" and link the offer to it (F5).
  Buyers and sellers dispute multipack counts ("4x4 = 16 tonerów", F7, moderator sided with 16).
- **Recommendation: ADOPT.** Same fix sellers already apply in BaseLinker; holding avoids shipping 1 unit for 6.

### O4. Ended promotion read-only, duplicate to change
- **No evidence** from sellers. (Allegro relists ended offers as copies, but I did not verify that page today.)
- **Recommendation: ADOPT**, cheap and keeps history honest.

### D1. Gift on a receipt as 0,01 zł taken from a paid line
- **Allegro rule**: a 100% discount becomes 0,01 zł and a minimum commission (moderator 2020, thread 49695;
  current value unverified). So an Allegro "free unit" already arrives as a paid 0,01 line.
- **Seller practice**: gift as its own receipt line ("Na paragonie widniały dwie pozycje Towar i Gratisowy
  produkt", gift ~50 zł, F3) or "za zero" on the invoice (F4). No evidence of anyone moving a grosz between lines.
- **Recommendation: ADOPT** (the total must equal what was paid; eparagony refuses 0 and 0,01-on-top is wrong,
  verify/eparagony-gift-forms.md), but skip it when the channel already sent the gift as a 0,01 line.

### D2. Split a line whose value does not divide by quantity
- **Allegro fact**: `price` is per unit (verify Q1). How an Nth-unit discount is folded into one line's unit price
  is undocumented. Sellers notice grosz rounding on Allegro's own invoices (F13, 0,2047 -> 0,21).
- **Seller practice**: no evidence.
- **Recommendation: ADOPT** only as an automatic fallback when qty x unit != line value; no UI.

### D3. Rounding remainder to the largest paid line
- **No seller evidence.** Allegro does proportional allocation for sets ("rozkładana proporcjonalnie", 727363).
- **Recommendation: ADOPT** (standard, invisible).

### D4. Whole-order discount holds the document until "spread"
- **Allegro fact**: Allegro sends per-line prices with coupons already folded in; the order-level `discounts`
  array was deprecated and removed 7-01-2026 (r4 S2). Allegro's own rule is proportional spreading (727363).
- **Recommendation: SIMPLIFY.** Spread proportionally automatically and show it; do not hold. On Allegro it never
  triggers.

### D5. EUR order with foreign VAT waits for review
- **Allegro parallel**: allegro.cz/.sk/.hu sales. Sellers issue foreign invoices by hand and want automation
  ("czy znacie program, który z automatu zrobi fakturę dla transakcji zagranicznych?"); peers: invoice only, no
  receipt, PLN at the previous day's rate (F12).
- **Recommendation: ADOPT for now** (hold beats a wrong PLN receipt), with automatic foreign invoices as the next
  step; sellers clearly want that.

### D6. Returns
- (a) Two identical Allegro lines, one with BUNDLE: **no evidence** this happens; Allegro returns are by
  `offerId` + qty only (r4). **SIMPLIFY**: fold into (c), compute from what the buyer keeps.
- (b) Kept gift never deducted automatically: Allegro's position is "it depends on your return terms": "Czy w
  ofercie miałeś informację zwrocie gratisu w przypadku odstąpienia od umowy?" (moderator, 868973). Standard clause
  "Otrzymujesz gratis? – w przypadku zwrotu towaru odeślij go również do nas" (F2). Disputes are real (F3, 872042).
  **ADOPT**.
- (c) Claw back the lost set discount, editable: Allegro moderator 2026: "Powinieneś sam zwrócić klientowi
  pomniejszoną kwotę ... Za 2 przedmioty za 200 zł płacę 150 zł, to jak zwrócę ostatecznie drugi przedmiot to nie
  zwracasz mi 100 zł tylko 50 zł ... Możesz zawsze edytować kwotę zwrotu" and w_kiwi: "Jako sprzedający masz prawo
  wyliczyć kwotę zwrotu poprzez odjęcie pełnej, regularnej ceny zachowanego produktu od łącznej kwoty, którą
  kupujący pierwotnie zapłacił" (F1). The seller notes Allegro's refund screen shows the full amount, so a seller who
  does not notice overpays. **ADOPT**, using exactly Allegro's formula, only when the offer's return terms say so.

### C1. "Take the composition from PrestaShop"
- Out of my lens; **no Allegro evidence**. (Allegro analogue: the seller re-links the offer to a set, F5.)

### C2. Small-gift register keyed by resolved customer
- **Allegro fact**: e-mail is an alias (P2), so keying by e-mail would split one buyer into many.
- **Seller practice**: no evidence that Allegro sellers keep the art. 7 register for marketplace gifts; most treat
  the gift as part of the sale.
- **Recommendation: SIMPLIFY**: key by customer (buyer.id on Allegro), and only feed it when the operator chose
  the "gratuitous" treatment.

### C3. Option "hold every document with a gift until a decision"
- **Seller practice**: sellers pick one habit and apply it always (F4 "Zawsze..."). No evidence anyone wants a
  per-order hold.
- **Recommendation: DROP.** The per-promotion document treatment already decides; a hold adds a queue nobody asked for.

## Three strongest real cases

1. **Allegro's own help says a seller gift must be a product set** (H1, H2), and Allegro's LEGO "zestaw z
   prezentem" campaign did exactly that at a raised price (F8). Gifts on Allegro arrive as set components: P1 is
   essential, OL gift promotions are secondary there.
2. **Refund after a partial return of a discounted set** (F1, 2026): moderators prescribe "paid total minus the
   regular price of what is kept", editable; Allegro's refund screen defaults to the full amount. This is D6(c).
3. **Multipacks that the seller never created** (H3 auto-marking; F6 "ja tego zestawu nie tworzyłem"; F5
   BaseLinker importing a 5-pack as 1 expensive unit, fixed by defining "10 x Sznurówki" and linking). This is O3.
