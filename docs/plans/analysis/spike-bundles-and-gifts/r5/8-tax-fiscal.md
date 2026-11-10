# R5-8 Red team: tax and fiscal claims (C-028..C-038) and the gift document rule

Researched 2026-11-04. Research, not legal advice. Polish law first, two foreign claims checked briefly.

## Headline

The proposed rule G-10 ("gift on a receipt/invoice = list price + per-line 100% rebate") rests on C-033
("a gift that is part of a paid sale is one supply, tax base = amount paid"). The most recent KIS ruling on
exactly this shape says the opposite: a product shown at 0 zl / with a 100% rebate is a **gratuitous supply
under art. 7 ust. 2**, taxed on its **purchase price** at its **own rate**, and a gratuitous supply is **not
documented by an invoice**. Older KIS rulings say the gift is a paid supply only when its value is priced into
the paid goods, and then each good is taxed at its own rate. So the 100%-rebate line is the **riskiest**
presentation, not the safest. The tax-defensible shape is a gift line that carries a **positive share of what
the buyer paid** (proportional allocation, or a symbolic 1 grosz), or no line at all with an internal record.

## Sources consulted (primary unless stated)

| # | Source | Kind | Used for |
|---|---|---|---|
| S1 | VAT Act, consolidated text Dz.U. 2026 poz. 1263 (in force; obwieszczenie 1.09.2026), PDF from api.sejm.gov.pl/eli/acts/DU/2026/1263, text extracted locally | statute | art. 7, 29a, 106e |
| S2 | Ustawa z 27.11.2020 (SLIM VAT), Dz.U. 2020 poz. 2419, art. 1 pkt 2 lit. a - https://api.sejm.gov.pl/eli/acts/DU/2020/2419/text.html | statute (amending) | 10 -> 20 zl |
| S3 | Rozporządzenie MF z 25.06.2025 w sprawie kas rejestrujących, Dz.U. 2025 poz. 845 (in force from 1.07.2025) | regulation | replaces 2019 reg.; par. 26 |
| S4 | Rozporządzenie MRPiT w sprawie wymagań technicznych dla kas rejestrujących, consolidated Dz.U. 2024 poz. 1654 | regulation | par. 22 (on-line receipt content), par. 35 |
| S5 | Rozporządzenie MF z 17.12.2024 w sprawie zwolnień z kas, Dz.U. 2024 poz. 1902, załącznik poz. 46; amended Dz.U. 2026 poz. 420 (poz. 46 untouched) | regulation | art. 7 ust. 2 supplies exempt from kasa |
| S6 | KIS 0114-KDIP1-1.4012.876.2025.2.IZ, 23.01.2026 (eureka id 676872), via https://eureka.mf.gov.pl/api/public/v1/informacje/676872 | individual interpretation | 100% rebate = gratuitous |
| S7 | KIS (DIS Katowice) IBPP1/4512-383/16-1/MS, 9.09.2016 (eureka 322896) | individual interpretation | gift priced in = paid, own rate |
| S8 | KIS (DIS Poznań) ILPP1/4512-1-199/15-4/AS, 17.06.2015 (eureka 281255) | individual interpretation | gift priced in, same rate, listing irrelevant |
| S9 | KIS 0114-KDIP4-1.4012.289.2026.1.PS, 22.06.2026 (eureka 696566); 0111-KDIB3-1.4012.648.2025.3.KO, 24.10.2025 (eureka 663546) | individual interpretations | 1 grosz sale = paid, base = 1 gr |
| S10 | KIS 0113-KDIPT1-1.4012.373.2025.1.RG, 8.07.2025 (eureka 647745) | individual interpretation | set components at own rates on kasa |
| S11 | KSeF FA(3) XSD `libs/integrations/ksef/src/infrastructure/fa3/schema/schemat_fa3_v1-0e.xsd:1142,3139-3161` | official schema (vendored) | P_9A/P_10/P_11 |
| S12 | eparagony sandbox probes 2026-11-03, printer ZBN1901007783, saved outputs (scratchpad `eparagony-gift-probe/*.json`, `*.receipt.html`) | live test | C-028, C-029 |
| S13 | OL code (file:line below) | code | C-030, C-037, C-038 |
| S14 | amavat.pl article "Kup 2, trzeci gratis" | vendor blog (secondary) | context only |
| S15 | Deloitte / KPMG / beck-aktuell summaries of BFH XI R 19/23 and XI R 22/22 (22.01.2025) | secondary | C-035 |
| S16 | ecnews.it / quotidianopiu.it summaries of DPR 633/1972 art. 15 c.1 n.2 | secondary quoting statute | C-036 |

Note on eureka: the public UI is a SPA; its backend answers `GET /api/public/v1/informacje/{id}` and
`POST /api/public/v1/wyszukiwarka/informacje` (found in chunk `18.*.js`). All KIS quotes below come from those
JSON documents, not from blogs.

## Claim verdicts

### C-028 - eparagony accepts a 0.00 gift line / 100% line rebate only when another line has a positive value at the same VAT letter; else HTTP 400 errorCode 41 before the printer
**Confirmed (live, narrow).** Probes:
- a1: paid 10.00 A + gift 0.00 A -> 202, CONFIRMED, fiscalDocumentId ZBN1901007783/17112; receipt prints `GiftProbeGift... 1 x 0,00 = 0,00 A`.
- a8: paid 10.00 A + gift 0.00 **B** -> `400 {"errorCode":41,"message":"Incorrectly calculated value of 'eReceipt.lines[1]'"}`.
- b1: gift 5.00 A with `rebatesMarkups:[{value:-500}]` -> CONFIRMED; prints `OBNIŻKA Gratis -5,00`.
- b8 / b8r: same in rate B -> 400 errorCode 41.
- b8p: gift 5.00 B, rebate -4.99 -> CONFIRMED; prints `Sprzedaż opodatkowana PTU B 0,01 / Kwota B 8% 0,00`.
- d1: gift 0.01 A -> CONFIRMED.
Precision fix: what is refused is **a VAT letter whose sales total would be 0.00**, not "a 0 line". The legal
backdrop: S4 par. 35 pkt 3 forbids sales "powodujących w ich wyniku ujemną wartość sprzedaży dla dowolnej stawki"
- negative, not zero; the zero-bucket refusal is eparagony/printer behaviour, not law. It is "before the
printer" only in the sense that the API refuses it synchronously (n=1 printer model).

### C-029 - a document-level REBATE without taxRate spreads across rates and prints wrong VAT
**Disputed.** Probe c8 (10.00 A + 5.00 B, doc REBATE -5.00) is CONFIRMED and prints
`Sprzedaż opodatkowana PTU A 6,67 / Kwota A 23% 1,25 / PTU B 3,33 / Kwota B 8% 0,25`. The spread is proportional
to line values. S4 par. 22 pkt 9 lit. b allows a rebate position without a rate letter "z wyjątkiem opustu ...
udzielanych do pozycji sprzedaży, lub do grupy towarów lub usług, lub do całego paragonu" and pkt 11 requires
per-rate totals "po uwzględnieniu opustów". Whether 6.67/3.33 is "wrong" depends on the tax qualification of the
gift: under S7 (gift priced into the paid goods, each taxed at its own rate) a proportional split by selling
price is the defensible allocation (cf. BFH XI R 19/23, S15); the version that is wrong is the one where the gift
is shown free and all payment stays at A while the gift really went at B. Correct wording: "spreads a whole-order
rebate proportionally; that is the right answer only if the gift is a paid component, and the merchant cannot
choose the split".

### C-030 - OL core refuses a receipt whose lines do not sum to the total beyond epsilon (order-level discount -> line-total-mismatch)
**Confirmed.** `libs/core/src/fiscalization/application/mappers/order-to-register-transaction-command.mapper.ts:136`
calls `assertLinesSumToTotal` (:214-240, quantity-scaled epsilon); invoice twin
`libs/core/src/invoicing/application/mappers/order-to-issue-invoice-command.mapper.ts:147,304`; reason written at
`libs/core/src/invoicing/application/services/auto-issue-trigger.service.ts:1112,1251`. Nuance: when the order
carries `discountTotal`, `reconcileDiscountRounding` (`libs/core/src/sales-documents/domain/types/discount-rounding.types.ts`)
only fixes minor-unit drift; a discount that is on no line still fails. The eparagony mapper's negative balancing
REBATE (`eparagony-document.mapper.ts:96-105`) is therefore reachable only for rounding dust, contrary to its own
comment ("typically an order-level discount").

### C-031 - Kas rozporządzenie 2019 par. 25 requires showing rebates and per-rate totals after them; silent on 0.00 lines
**Refuted as cited, confirmed in substance.** The 2019 regulation is gone: S3 par. 61 "Rozporządzenie wchodzi w
życie z dniem 1 lipca 2025 r.", footnote "poprzedzone rozporządzeniem Ministra Finansów z dnia 29 kwietnia 2019 r.".
In S3 par. 25 is about replacing fiscal memory; receipt content for kasy with copy is **par. 26 ust. 1** ("9)
wartość opustów, obniżek lub narzutów, o ile występują; 10) wartość sprzedaży brutto i wysokość podatku należnego
według poszczególnych stawek ... po uwzględnieniu opustów"). R4's "par. 26" is right **only for kasy with
electronic/paper copy**. For on-line kasy (eparagony's Novitus path) S3 par. 20 points to the technical
regulation, and the binding list is **S4 par. 22 pkt 9-12** (line "opust, narzut lub obniżkę do pozycji
sprzedaży", rebate position with "oznaczenie OPUST, NARZUT lub OBNIŻKA", per-rate totals after rebates). Both are
silent on a zero-value line; S4 par. 35 pkt 3 only bans a **negative** per-rate value.

### C-032 - Comarch Optima refuses to fiscalise lines priced 0
**Probable (vendor docs, not re-fetched here).** R3 quotes Comarch help: "Nie można dokonać zapłaty ponieważ na
Paragonie znajdują się pozycje z ceną zerową" (pomoc.comarch.pl/optima/pl/2026/?p=3850). Product behaviour, not
law; it shows ERP-side zero-line refusal is common and that a 1-grosz or allocated price travels further.

### C-033 - gift in a paid sale = one supply, base = amount paid (art. 29a); separate free transfer = art. 7 ust. 2 on an internal document
**First half disputed (KIS split), second half confirmed.**
- Against: S6 (23.01.2026), on facts nearly identical to G-10 ("Gratisy będą dokumentowane na fakturze lub
  paragonie jako produkty z rabatem 100%"; "Wartość gratisu jest wliczona w całą cenę zamówienia"): "obniżenie
  ... ceny zakupu produktu o 100% ... nie będzie równoznaczne z udzieleniem rabatu", "dostawa na rzecz klienta
  towaru objętego rabatem w wysokości 100% stanowić będzie nieodpłatną dostawę towarów. Bez znaczenia dla tej
  kwalifikacji jest to, że produkt objęty promocją jest nabywany przez klienta jako element transakcji
  odpłatnej", "podstawą opodatkowania będzie cena nabycia tych towarów ... z zastosowaniem właściwej dla nich
  stawki", and "czynności podlegających opodatkowaniu na podstawie art. 7 ust. 2 ustawy nie są dokumentowane
  poprzez wystawienie faktury". It also rejects the composite-supply argument ("nie można przypisać przymiotu
  świadczenia złożonego").
- For: S7 (2016): where "koszt zakupu (wytworzenia) towarów gratisowych będzie stanowił element kalkulacji ceny
  za towary podstawowe" there is no gratuitous transfer, but "odpłatną sprzedażą obejmującą dwa odrębne towary,
  opodatkowane ... na zasadach określonych dla ich przedmiotu (stawka podatku, podstawa opodatkowania)" -
  i.e. two supplies, each at its own rate, not one supply. S8 (2015) same, adding that with one rate a separate
  listing "nie ma znaczenia".
- Reconciliation (my reading, needs adviser): the decisive fact KIS 2026 used is that the gift's own consideration
  is 0 ("sami Państwo wskazali, że kwota zapłaty stanowi 0 zł"). A gift line that carries a positive share of the
  payment, or 1 gr (S9: "może Pan za podstawę opodatkowania przyjąć rzeczywistą kwotę należną ..., a więc
  przykładowo 1 gr"), stays on the paid side. Individual interpretations bind only the applicant.
- Second half: art. 7 ust. 2 supplies are exempt from kasa: S5 załącznik poz. 46 "Czynności wymienione w art. 7
  ust. 1 pkt 5 i ust. 2 oraz w art. 8 ust. 2 ustawy", until 31.12.2027 (S5 par. 2 ust. 1). So a gratuitous gift
  does not belong on the buyer's receipt either.
- Also wrong in C-033 and in the plan: "one supply". Even the favourable KIS line treats gift and product as
  **separate** supplies (S7, S10), which is exactly why the rate of each line matters.

### C-034 - small gifts: 20 zl net per unit without records, 100 zl per person per year with records (art. 7 ust. 3-4)
**Confirmed, threshold fixed at 20 zl; two precisions.** S1 art. 7 ust. 4: "1) o łącznej wartości nieprzekraczającej
w roku podatkowym kwoty 100 zł (bez podatku), jeżeli podatnik prowadzi ewidencję pozwalającą na ustalenie
tożsamości tych osób; 2) których przekazania nie ujęto w ewidencji, o której mowa w pkt 1, jeżeli jednostkowa cena
nabycia towaru (bez podatku), a gdy nie ma ceny nabycia, jednostkowy koszt wytworzenia, określone w momencie
przekazywania towaru, nie przekraczają 20 zł." S2: "w pkt 2 wyrazy „nie przekraczają 10 zł” zastępuje się
wyrazami „nie przekraczają 20 zł”", in force 1.01.2021. The 10 zl figure (R2 voice, bezprawnik.pl, KIS 2016
text) is pre-2021. Precisions: (a) it is the **purchase price/production cost**, not the list price - OL needs
cost, not catalogue price; (b) it matters only if the gift is gratuitous (art. 7 ust. 2); it is irrelevant to a
gift that is a paid component. Art. 29a ust. 2: base for art. 7 ust. 2 = "cena nabycia towarów lub towarów
podobnych ... określone w momencie tej dostawy".

### C-035 - BFH XI R 19/23: split a bundle price by individual selling prices, never above a component's own price
**Probable, with a correction (secondary sources only).** Summaries agree: where components are also sold alone,
split "nach Maßgabe der Einzelverkaufspreise"; a method is not appropriate if a component's share exceeds its own
selling price. But the companion XI R 22/22 rejected a **capping** method ("Kappung") as well, so "cap warning" is a
safe UI warning, not an accepted allocation method. German, persuasive only; Polish KIS uses proportional splits
by analogy (transport-cost rulings, S14 context).

### C-036 - Italy: sconto merce outside the base vs omaggio separate regime
**Confirmed (secondary quoting statute), with a rate rule worth stealing.** DPR 633/1972 art. 15 c.1 n.2: goods
given "a titolo di sconto, premio o abbuono in conformità alle originarie condizioni contrattuali" are outside the
base, "tranne quelli la cui cessione è soggetta ad aliquota più elevata". Italy explicitly taxes a gift in a
**higher** rate than the main goods - the same direction of risk as case 4 below.

### C-037 - KSeF FA(3) builder never emits P_10; schema has it
**Confirmed.** `libs/integrations/ksef/src/infrastructure/fa3/domain/fa3-xml.types.ts:290-304`
(`FA3_FA_WIERSZ_CHILD_ORDER` has P_9A, P_9B, P_11, no P_10); XSD `schemat_fa3_v1-0e.xsd:3149` "P_10 Kwoty
wszelkich opustów lub obniżek cen ... o ile nie zostały one uwzględnione w cenie jednostkowej netto". P_11 is
`TKwotowy` (:1142, decimal, no minimum) so a 0.00 net value is schema-valid. Statute S1 art. 106e ust. 1 pkt 9-11
mirrors this. Adding P_10 does not make a 100%-rebated line safer - per S6 that line describes a supply that
should not be on the invoice at all.

### C-038 - Subiekt bridge has a before/after rebate pair on the ZK path but sets both equal on receipt and invoice
**Probable.** OL side confirmed: the pair exists only on the order path
(`libs/integrations/subiekt/src/bridge/subiekt-bridge-orders.types.ts:28-42`,
`subiekt-order-processor.adapter.ts:260-300`, `wartoscBruttoPoRabacie`); no rebate field anywhere in the invoicing
bridge contract (grep: no `PoRabacie`/`rabat` outside the order files). Bridge-side behaviour lives in the Windows
repo and was not checked here.

## The proposed rule, tested

### (2) "Omit the gift line" vs "move its value to a paid line"
- Tax effect is the **same**: in both, the whole payment is taxed at the paid line's rate and the gift's rate
  bucket gets nothing. The difference is only what the document shows.
- When gift and paid line share a rate: harmless either way (S8: separate listing "nie ma znaczenia"). But if the
  gift costs > 20 zl and the merchant's facts look like S6, the gift itself may additionally owe VAT on its
  purchase price as art. 7 ust. 2 - omission does not cure that; only pricing it in (positive share) does.
- When rates differ: both shift tax between rates. Gift at a **lower** rate (e.g. 5% book with a 23% paid item):
  over-declares tax - safe for the authority, costs the merchant. Gift at a **higher** rate (23% gift with a 5%/8%
  basket): under-declares - this is the risky direction (Italy taxes it explicitly, C-036).
- Neither is "safer" in general. Omission is the cleaner of the two **if** the merchant treats the gift as
  gratuitous and records it internally (art. 7 ust. 2 / small-gift register, kasa-exempt per S5 poz. 46).
  "Move value" without saying so is the worst option: it hides a rate shift inside a document that looks normal.

### (3) 0.00 line or list price + 100% rebate?
- Legally equivalent descriptions of the same thing: consideration 0 for that good. S6 treats both as gratuitous.
- On a paragon both pass eparagony only when the rate bucket stays > 0 (C-028); 100% rebate prints an explicit
  OBNIŻKA line (more transparent, S3 par. 26 pkt 9 / S4 par. 22 pkt 9 satisfied); 0.00 is refused by Comarch.
- On a faktura: per S6, a gratuitous supply is not invoiced; a 0 line or full P_10 rebate on the buyer's invoice
  documents something KIS says belongs elsewhere.
- Preferred by risk: (1) gift line with a **positive allocated price** (proportional by list price, BFH-style) -
  paid supply at its own rate, both documents normal, eparagony accepts any positive bucket (b8p/d1 show 0.01
  works); (2) **1 grosz** gift line (S9) - paid supply, minimal tax shift, accepted by eparagony (d1);
  (3) **no line + internal record** for a merchant who declares the gift gratuitous; (4) 0.00 / 100% rebate on
  the buyer's document - only with an adviser's sign-off.

### (4) Gift in a different VAT rate than the basket
- eparagony refuses a zero bucket (C-028), so a 0/100% gift alone in its rate cannot even be fiscalised.
- Positive allocation puts real value in the gift's rate; that is what S7/S10 ("opodatkowane oddzielnie, według
  stawek właściwych dla danego towaru") imply. Proportional split by list price is the most defensible method;
  never above the gift's own list price (BFH); flag rounding so the bucket never ends at 0.00.
- If the merchant insists the gift is free: omit it from the receipt/invoice and record it as art. 7 ust. 2 with
  purchase price and the gift's own rate; small-gift exclusion applies on cost (20 zl / 100 zl with register).

### (5) What OL must store to let an accountant defend the document
Per gift unit, frozen at order time: promotion id + terms/regulamin version and the condition met (proves
conditionality); chosen treatment (`priced-in` | `symbolic` | `gratuitous` | `zero-line`) and who chose it;
list/individual selling price of every line and the gift; gift **purchase price/production cost at transfer
date** (art. 7 ust. 4 pkt 2, art. 29a ust. 2) and currency; VAT rate of each line; allocation method, inputs and
resulting per-line gross/net and rounding remainder; document ids (receipt fiscalDocumentId, KSeF number);
recipient identity and per-person yearly running total **only if** the 100 zl register path is used - this
conflicts with `OL_STORE_PII=false` (hash-only) and needs a design decision; source-channel evidence (Allegro
`originalPrice`/`discounts`, Erli `unitPriceBeforeRebate`) as raw payload.

## Counterarguments against the proposed design, with alternatives

| # | Problem | Alternative | Cost |
|---|---|---|---|
| A1 | G-10 picks the one presentation KIS 2026 classed as gratuitous (S6) | Default treatment `priced-in`: core allocates paid total proportionally by list price over paid lines + gift; adapter renders normal lines | Pure function beside `reconcileDiscountRounding`; needs gift list price; changes what operators see (gift no longer "0 zl") |
| A2 | Core "country-agnostic" yet a single rule is hardwired | Make treatment a merchant setting with typed reason; adapters declare which they can render (`LineAdjustmentRenderingDeclarer` already proposed) | Setting + copy; no national vocabulary in core if named neutrally |
| A3 | "Omit/merge when adapter cannot render" silently shifts tax between rates | Refuse with a named reason when rates differ; allow omit only with `gratuitous` treatment + internal record | One more `SalesDocumentBlockOutcome` reason |
| A4 | Small-gift support keyed on list price | Key on cost (`netUnitCost`, ADR-080 already stores it) | Cost coverage gaps -> "unknown", never "under 20 zl" |
| A5 | P_10 work justified by gifts | Do P_10 for ordinary discounts only; gifts use allocated prices | Smaller KSeF change |
| A6 | `1 grosz` dismissed as a hack | It is the variant with two favourable KIS rulings (S9) and works on eparagony (d1) | Merchant must accept 0.01 on the receipt and paid-total distortion of 0.01 |

## Conflicts / open questions
- KIS 2026 (S6) vs KIS 2015/2016 (S7/S8): same economics, opposite outcome; S6 is newer and from the national
  KIS, S7/S8 from former regional chambers. I trust S6 as the current practice for the 0/100% shape, but it binds
  only its applicant. No NSA/WSA ruling found on 0-zl gifts in this session (not searched exhaustively).
- Is a proportionally allocated gift price a "real" price or an artificial split under art. 29a? Unresolved.
- Does a marketplace-funded gift (Allegro coupon on the gift line) change the qualification? Not researched.

## Confidence
- High: statute texts (S1-S5), 20 zl threshold, code claims C-030/C-037, eparagony behaviour (n=1 printer).
- Medium: reading of S6 vs S7 as "presentation decides"; C-035/C-036 (secondary).
- Low / adviser: which treatment a given merchant should use; whether proportional allocation survives audit.
