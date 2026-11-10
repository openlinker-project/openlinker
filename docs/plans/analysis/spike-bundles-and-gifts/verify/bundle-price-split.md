# Verify: splitting one bundle price across components with different VAT rates

Research for the bundles-and-gifts spike, checked 2026-11-04. **This is research, not legal advice.**
It records what the sources say; whether a given operator's split is acceptable is a question for
their tax adviser.

Question: an OMS sells a bundle (zestaw) at one price, and the components carry different VAT
rates. How should the price be split on the invoice or receipt, and on a partial refund? Two
candidate designs:

- **A.** The operator types an "in-set price" per component when defining the bundle (claimed for
  Apilo and Sellasist), rescaled proportionally when the channel price differs.
- **B.** Computed at sale time from each component's own standalone selling price (unit price x
  qty weights), optionally capped so no component exceeds its standalone price.

Quotes are verbatim. Where a quote comes from a secondary source, it is marked so.

## 1. What the sources require

### 1.1 Polish VAT Act (primary)

Dz.U. 2025 poz. 775 (consolidated text), fetched from
https://api.sejm.gov.pl/eli/acts/DU/2025/775/text.pdf

- Art. 29a ust. 1: "Podstawą opodatkowania [...] jest wszystko, co stanowi zapłatę, którą
  dokonujący dostawy towarów lub usługodawca otrzymał lub ma otrzymać z tytułu sprzedaży od
  nabywcy [...]".
- Art. 29a ust. 10: "Podstawę opodatkowania obniża się o: 1) kwoty udzielonych po dokonaniu
  sprzedaży opustów i obniżek cen; 2) wartość zwróconych towarów i opakowań; [...]".

The Act has no rule specific to sets. The split is a question of how the single consideration is
attributed to each separate supply.

### 1.2 Ministry of Finance notice, 29 Sep 2017 (primary)

"Nieprawidłowe określanie podstawy opodatkowania VAT dla towarów sprzedawanych w formie zestawów",
published "2017.09.29 16:16".
https://mf-arch2.mf.gov.pl/ministerstwo-finansow/wiadomosci/komunikaty/-/asset_publisher/6Wwm/content/nieprawidlowe-okreslanie-podstawy-opodatkowania-vat-dla-towarow-sprzedawanych-w-formie-zestawow/pop_up?_101_INSTANCE_6Wwm_viewMode=print
(A KIS copy at kis.gov.pl/.../id/7327876 now redirects to gov.pl/web/kis.)

- Practice is fine without manipulation: "na fakturze lub paragonie fiskalnym wydawanym
  konsumentowi wskazywane są poszczególne towary wchodzące w skład zestawu, z przypisanymi im
  cenami (dającymi łącznie cenę całkowitą). W sytuacji, gdy tego rodzaju promocjom nie towarzyszy
  manipulowanie podstawami opodatkowania poszczególnych towarów (patrz niżej), tego rodzaju
  praktykę należy uznać za prawidłową."
- The method it endorses, with standalone prices as the reference: "podatnicy często stosują
  proporcjonalne obniżenie ceny – cena każdego towaru zestawu jest obniżana o tyle samo procent
  (patrz: Przykład 1) – nie ma wątpliwości, że jest to prawidłowe postępowanie." Przykład 1 starts
  from "Cena sprzedaży towarów sprzedawanych poza zestawem" (coffee 23% + pastry 7%: 13 zł outside
  the set, 10 zł in the set).
- The fallback when no standalone price exists: "W przypadku braku możliwości odniesienia się do
  ceny sprzedaży poszczególnych towarów w zestawie – w szczególności, gdy jeden lub więcej z tych
  towarów nie jest sprzedawany poza zestawem (nie figuruje samodzielnie w zwykłej ofercie
  sprzedaży), nie ma przeszkód, ażeby podatnik odniósł ceny sprzedaży (brutto) poszczególnych
  towarów do ich cen nabycia (netto)/kosztu wytworzenia towaru."
- What is not allowed: "sztucznym zawyżaniu ceny towaru opodatkowanego stawką obniżoną VAT, przy
  jednoczesnym zaniżaniu ceny towaru opodatkowanego stawką podstawową VAT, w celu osiągnięcia
  korzyści podatkowej."
- The warning: "nieproporcjonalne obniżenie podstawy opodatkowania stawką podstawową w stosunku do
  podstawy opodatkowania stawką obniżoną naraża podatnika na ryzyko sporu z organem podatkowym
  [...] mogą zostać uznane [...] za praktykę stanowiącą nadużycie prawa". It cites NSA
  26.05.2017, I FSK 1944/15 (a book plus an e-cigarette set).

So the default is proportional to standalone prices, the fallback is cost, and a non-proportional
split is a risk rather than a ban.

### 1.3 KIS individual interpretations

None could be fetched from the KIS database (eureka.mf.gov.pl is a JavaScript app and was not
reachable). The signatures and holdings below come from **secondary** summaries only; confirm
them against the full text before citing.

- **0114-KDIP4-2.4012.449.2026.3.WH**, 3 Aug 2026. Source: akademialtca.pl. A package of services
  stays separate supplies, and the discount may be split "proporcjonalnie do ich standardowych
  cen" across items with different rates. The article attaches a condition: the model must
  reflect real economics and be documented.
- **0114-KDIP1-1.4012.127.2023.1.MM**, 26 Apr 2023. Source: martinitax.pl. The whole discount
  may sit on the 23% drink, because "alokacja rabatu wyłącznie do produktu o wyższej rentowności
  ma ekonomiczny sens".
- **0114-KDIP4-2.4012.235.2023.1.MMA**, 26 Jun 2023. Source: martinitax.pl. The tax base may be
  set "w sposób inny niż" a proportional reduction (margin-based or cost-plus), because the model
  was economically justified.
- **0114-KDIP1-3.4012.440.2023.1.JG**, 10 Oct 2023. Source: martinitax.pl. Most of the discount
  goes on an extra roll valued at production cost, and "Pozostały rabat byłby alokowany w sposób
  proporcjonalny do pozostałych rolek."
- **0115-KDIT1-1.4012.613.2019.2.IK**, 4 Nov 2019. Source: prawo.pl. A snack set is a "zespołem
  odrębnych świadczeń", so each product is taxed at its own rate. The interpretation does not say
  how to split the price.

The pattern: proportional to standard (standalone) prices is the safe default. KIS has accepted
non-proportional splits when the taxpayer showed an economic, non-tax reason.

Related: **0114-KDIP4-3.4012.578.2020.13.S.IG**, 9 Apr 2026 (inforlex freemium, full text).
Listing cost items separately on an invoice does not make them separate supplies when they are
parts of one composite service: "wykazanie poszczególnych kosztów na fakturze nie powoduje
konieczności ich osobnego opodatkowania".

### 1.4 CJEU (primary)

Fetched from the Publications Office (CELLAR).

- **C-349/96 CPP**, paras 31-32: "the fact that a single price is charged is not decisive.
  [...] if [...] the customers intended to purchase two distinct services [...] then it would be
  necessary to identify the part of the single price which related to the insurance supply [...].
  The simplest possible method of calculation or assessment should be used for this (see, to that
  effect, Madgett and Baldwin, paragraphs 45 and 46)."
- **C-308/96 and C-94/97 Madgett and Baldwin**, paras 43-46. The cost method is "problematical,
  as there is no reason to suppose that the margins on the different services [...] are
  proportional to the respective costs". Market value "has the advantage of simplicity". So "a
  trader may not be required to calculate the part of the package corresponding to the in-house
  services by the actual cost method where it is possible to identify that part of the package on
  the basis of the market value of services similar to those which form part of the package."
- **C-41/04 Levob** (summary, operative part 1, para 30). Elements "so closely linked that they
  form objectively, from an economic point of view, a whole transaction, which it would be
  artificial to split, [...] constitute a single supply [...] even where separate prices are
  paid."
- **C-208/15 Stock '94**, para 29. The Court "takes into account the economic objective of that
  transaction" and "the interests of the recipients". The ruling: goods plus a loan to buy them
  are one transaction, and "The taxable amount of that single transaction is made up of both the
  price of those goods and the interest". Stock '94 decides single vs separate; it says nothing
  about how to split a price.

What each one requires:
- CPP and Madgett set the method: the simplest one, which in practice means market value
  (standalone price). Cost is disfavoured, and a trader cannot be forced into it.
- Levob and Stock '94 decide the prior question: single supply or separate supplies. When the
  supply is single, nothing is split, and the principal element's rate applies to the whole price.
- Showing separate prices on the document does not change that answer (Levob; KIS 2026 S.IG).

## 2. BFH XI R 19/23 (22 Jan 2025)

Primary: https://www.bundesfinanzhof.de/de/entscheidung/entscheidungen-online/detail/STRE202520153/
(press release 038/25). Quotes are from the BFH page. The fetch tool caps quotes, so some are
short excerpts.

- Leitsatz (the only one): "Eine Methode zur Aufteilung eines einheitlichen Gesamtentgelts, die
  dazu führt, dass auf ein Produkt einer rabattierten Warenzusammenstellung ein anteiliger
  Verkaufspreis entfällt, der höher ist als der Einzelverkaufspreis, ist nicht sachgerecht."
- Rn 6 cites CPP (C-349/96) and Madgett and Baldwin: the split must use the "einfachstmögliche"
  method.
- Rn 7: "Als einfachstmögliche Methode sieht der BFH dabei die Aufteilung nach Marktwerten
  beziehungsweise Einzelverkaufspreisen an."
- Rn 13: exceptions are possible, but "Notwendige Voraussetzung hierfür ist aber jedenfalls, dass
  die angewendete Methode zumindest ebenso sachgerecht ist."
- Rn 18-19: the cost-based "Food-and-Paper" method fails because the price of a high-cost item
  lands "deutlich über dem Einzelverkaufspreis", which "widerspricht der wirtschaftlichen und
  geschäftlichen Realität".

**Answer: it is an exclusion test, not a method requirement.** The headnote does not prescribe a
method. It rules out any method whose result gives a component a share above its standalone
price. Standalone prices are the default "simplest" method (Rn 7). Another method is allowed only
if it is at least as appropriate (Rn 13) and passes the cap.

This is German law. In Poland it is persuasive only. The Polish MF and KIS do not state the cap,
but MF Przykład 1 (a set price at or below the sum of standalone prices) satisfies it by
construction.

## 3. Fixed at definition, or computed at sale time? And a refund of one component

**Fixed at definition or computed at sale.** No source requires the split to be fixed when the
bundle is defined.

- The tax base is the consideration received for that sale (art. 29a ust. 1).
- MF and BFH both measure against the standalone selling price ("poza zestawem",
  "Einzelverkaufspreis"). The natural reading is the standalone price in force when the sale
  happens.
- KIS acceptances rest on a documented, economically grounded, consistent method. A fixed
  per-component number is not required.

Confidence: medium. This is an inference from the wording; no source addresses the timing
directly.

What the sources do require: the split must appear on the document. The MF notice describes
receipts and invoices listing each item "z przypisanymi im cenami (dającymi łącznie cenę
całkowitą)".

**Refund of one component.** Art. 29a ust. 10 pkt 2 reduces the tax base by "wartość zwróconych
towarów". In practice that is the value attributed to that component on the original document.

So the per-component split must be **frozen at the moment of sale** and reused for any refund or
correction. Recomputing it at refund time from current catalogue prices would give a different
figure from the one already reported.

Shopify works the same way at component grain: "Refund/Returns: Operates at the component level"
(shopify.dev bundles "start building" page). No source says how a refund of one component should
be handled when the remaining components would no longer qualify for the set discount. That is a
commercial question, not answered by the VAT sources.

## 4. Which design the sources support

**B as the default, with an optional operator override (A), is the best-supported design.**

What supports B:

- MF 2017 Przykład 1 (proportional to standalone prices, "nie ma wątpliwości, że jest to
  prawidłowe").
- CPP and Madgett (simplest method, market value) and BFH Rn 7.
- Shopify's documentation: "The bundle price is allocated across components in the checkout,
  cart, and orders using a weighted price algorithm" and "Taxes will be computed on the
  components" (shopify.dev/docs/apps/build/product-merchandising/bundles/start-building).
- A Shopify changelog entry, seen through a search snippet only (the page itself returned 404 to
  the fetch tool), describes the weight as price x quantity. The same snippet says expand
  operations "will also allow you to set fixed prices on each component of the bundle". Shopify
  therefore appears to ship B by default with a per-component override. Confidence: medium.

Why A is supported only as an override:

- KIS has accepted non-proportional splits, but only with an economic justification on record.
- MF warns that a disproportionate split risks being treated as an abuse of law.
- BFH excludes any split that gives a component a share above its standalone price.
- A per-component "in-set price" typed once at definition goes stale when catalogue prices
  change. Later sales then drift from proportional-to-current-standalone, which is exactly the
  pattern the MF warns about.
- The claim that Apilo and Sellasist work this way was **not re-verified** here. No primary docs
  were found for either.

Data needed for B:

- The standalone (gross) selling price of each component at sale time, from the master
  catalogue. ADR-077: catalogue prices are gross.
- Component quantities.
- The bundle price actually charged on the channel.
- Fallback for a component with no standalone price: cost, as the MF notice allows. The
  operator-recorded `netUnitCost` (#3588) is a candidate, but it is net and optional.
- The frozen per-line allocation persisted with the order, for documents and refunds.

Data needed for the A override:

- The operator's per-component in-set prices.
- A recorded reason: KIS asks for an economic justification.
- Validation that the shares sum to the bundle price, and that no component exceeds its
  standalone price (the BFH cap, a cheap guard).

Edge case: when the bundle costs MORE than the sum of its standalone prices, proportional B
breaches the BFH cap for every component. No source covers this case; flag it for an adviser.
