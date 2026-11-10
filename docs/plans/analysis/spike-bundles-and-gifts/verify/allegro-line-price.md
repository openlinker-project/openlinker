# Verify: Allegro checkout-form line price semantics

Date: 2026-11-04. Read-only verification. Sources: official swagger
`https://developer.allegro.pl/swagger.yaml` (downloaded 2026-11-04, `info.version: 'latest'`),
the official orders tutorial (`https://developer.allegro.pl/tutorials/jak-obslugiwac-zamowienia-GRaj0qyvwtR`,
EN slug `process-orders-PgPMlWDr8Cv` serves the same PL content), two Allegro dev news posts, and
OpenLinker code. Swagger line numbers refer to that download.

## Q1. Is `lineItems[].price` a unit price or a line total? Same for `originalPrice`.

**Answer: UNIT price (per one offer unit), both `price` and `originalPrice`.** Confidence: **confirmed**
(by arithmetic on Allegro's own documented example; the swagger itself does not say).

Swagger `CheckoutFormLineItem` (swagger.yaml:31021-31046) gives no description at all on either field:

```yaml
        quantity:
          type: number
          format: integer
          description: quantity
          minimum: 1
          example: 1
        originalPrice:
          $ref: '#/components/schemas/Price'
        price:
          $ref: '#/components/schemas/Price'
```

`Price` (swagger.yaml:27465-27480) is just `"The price data."` with `amount` / `currency`. So the
schema is silent on unit-vs-total.

The tutorial (section "Szczegóły zamówienia", example response of `GET /order/checkout-forms/{id}`)
settles it. Verbatim comments:

```
"quantity": 2,    // liczba przedmiotów kupionych w ofercie
"originalPrice": { "amount": "76.00",    // koszt przedmiotu przed ew. rabatem
"price":         { "amount": "76.00",    // koszt przedmiotu po rabacie
"selectedAdditionalServices": [ { "definitionId": "GIFT_WRAP", ...
    "price": { "amount": "10.00",    // jednostkowy koszt usługi
    "quantity": 2    // liczba wykupionych usług dodatkowych
"delivery": { ... "cost": { "amount": "15.87",    // koszt dostawy
"summary": { "totalToPay": { "amount": "187.87",    // całkowita wartość zamówienia
```

Arithmetic: 76.00 x 2 + 10.00 x 2 + 15.87 = 187.87. If `price` were the line total, the order total
would be 76 + 20 + 15.87 = 111.87. So `price` is per unit ("koszt przedmiotu" = cost of the item),
and `originalPrice` is the same unit before discount. A second example in the same tutorial
(`price` 240.00, qty 1, gift wrap 10.00, delivery 13.41, total 263.41) is consistent but not
discriminating (qty 1). The order-events example also says: `"amount": "2999", // cena w chwili
zakupu uwzględniająca ewentualne zniżki np. rabat ilościowy, zestawy, itp.)` and
`"originalPrice": ... // pierwotna cena w ofercie, przed zastosowaniem jakichkolwiek zniżek (rabatów ilościowych, zestawów itp.)`.

Caveat (unknown): how a quantity discount that hits only the n-th unit (MULTIPACK, "every third item
-30%") is expressed in one line's unit `price` (averaged? rounded?) is not documented anywhere I found.

## Q2. Product-set offer (`offer.productSet`): what does `quantity` count; does `price` refer to one set?

**Answer: `quantity` counts offer units sold (i.e. sets); `productSet.products[].quantity` is the count of
each product inside ONE set; `price` is per one set.** Confidence: **confirmed** for quantity semantics
(verbatim), **confirmed** for price-per-set by the same arithmetic as Q1 (that example IS a product-set line).

Swagger `OfferProductSetReference` (swagger.yaml:30251-30267): `description: If the offer was a product set,
you can see a list of component products (product id with quantity).`; `OfferProductSetProductReference.quantity`
(swagger.yaml:30277-30282): `description: Product quantity in a product set.`

Tutorial example (the qty-2 line from Q1 carries a productSet):

```
"productSet": {    // zestawy produktów
 "products": [    // lista produktów w zestawie
  { "id": "9d689aa5-...", "quantity": 1    // liczba produktów w danym zestawie
  { "id": "280ee7f4-...", "quantity": 1 } ] }
...
"quantity": 2,    // liczba przedmiotów kupionych w ofercie
"originalPrice": { "amount": "76.00", ... "price": { "amount": "76.00",
```

Two sets x 76.00 feed the 187.87 total, so 76.00 is the price of one set (not of one component product).
News 13 Dec 2023 "Zamówienia - dodaliśmy informację o zestawach produktów"
(https://developer.allegro.pl/news/zamowienia-dodalismy-informacje-o-zestawach-produktow-7GWeDzwWMfv):
"sprzedający, który w swoich ofertach ma zdefiniowany zestaw produktowy, dowie się z jakich produktów i z
jakiej liczby składa się dane zamówienie." Total physical units of product X = `lineItem.quantity` x
`products[X].quantity` (inference, not stated verbatim). No per-component price is given anywhere.

## Q3. What does `lineItems[].discounts[]` (`LineItemDiscount`) contain? Any amount?

**Answer: only a `type` enum. No amount, no percentage, no id.** Confidence: **confirmed**.

swagger.yaml:31255-31274, verbatim:

```yaml
    LineItemDiscount:
      type: object
      properties:
        type:
          type: string
          enum:
            - BUNDLE
            - UNIT_PERCENTAGE_DISCOUNT
            - WHOLESALE_PRICE_LIST
            - LARGE_ORDER_DISCOUNT
            - TURNOVER_DISCOUNT
            - COUPON
            - CAMPAIGN
          description: >
            Describes the types of discounts used in the lineItems. The types of discounts can be as follows:
              - `BUNDLE` - a bundle discount (used also for bundles with no price change)
              - `UNIT_PERCENTAGE_DISCOUNT` - a MULTIPACK or CROSS_MULTIPACK discount
              - `WHOLESALE_PRICE_LIST` - a wholesale price list discount (a discount for company users only)
              - `LARGE_ORDER_DISCOUNT` - a large order discount (a discount for company users only)
              - `TURNOVER_DISCOUNT` - a turnover discount (a discount for company users only)
              - `COUPON` - a coupon discount
              - `CAMPAIGN` - a campaign discount
          example: 'BUNDLE'
```

The amount of a discount is only derivable as (`originalPrice` - `price`) x `quantity`, and only for
discounts that Allegro folds into `price` (see Q4 caveat). The order-level `discounts[]` (types
`CROSSMULTIPACK`, `MULTIPACK`, `BUNDLE`, `COUPON`, `ALLEGRO_PRICES`) is marked in the tutorial
`// zniżki z których skorzystał kupujący podczas zakupów, pole oznaczone jako "deprecated"` and is
**absent from the current swagger `CheckoutForm` schema** (its properties are id, messageToSeller, buyer,
payment, status, fulfillment, delivery, invoice, lineItems, surcharges, codBookedPayments, note,
marketplace, summary, updatedAt, revision). `ALLEGRO_PRICES` does not appear anywhere in the current swagger.

## Q4. Where do platform-funded promotions show (Allegro Ceny, CAMPAIGN, coupons)?

**Allegro Ceny: NOT in `price`/`originalPrice`; it shows in `lineItems[].reconciliation` (per-item value x
quantity) and, for WALLET type, `payment.reconciliation`.** Confidence: **confirmed** (verbatim).
**CAMPAIGN / COUPON: folded into `price` (buyer-paid), flagged only by `discounts[].type`; who funds it is
not stated.** Confidence: **probable** (tutorial comment says price is after "rabatu, kuponu"; funding not documented).

Swagger `LineItemReconciliation` (swagger.yaml:31096-31119), verbatim:

```yaml
        type:
          enum: [BILLING, WALLET]
          description: >
            Reconciliation type used in the Allegro Prices program, in which the offer is included. The following values are possible:
            * `BILLING` - a reconciliation value is counted as a new entry in the billing
            * `WALLET` - a reconciliation value is added to the checkout form payment
        quantity:
          description: Quantity of reconciled items
```

`CheckoutFormPaymentReference.reconciliation` (swagger.yaml:30609) is a bare `Price`, no description.

News 15 Mar 2021 "Allegro Ceny - dodamy nowe obiekty i typy pól do obsługi zamówień"
(https://developer.allegro.pl/news/allegro-ceny-dodamy-nowe-obiekty-i-typy-pol-do-obslugi-zamowien-ZM9L1B7eqcX), verbatim:
"`payment.reconciliation` - suma płatności, którą Allegro pokrywa i przekaże wraz z płatnością klienta w ramach
programu Allegro Ceny, `lineItems[].reconciliation` - gdzie w obiekcie `value` zwrócimy kwotę o którą została
pomniejszona cena przedmiotu i której koszty wyrówna Allegro w ramach płatności kupującego lub wpisu bilingowego."

Tutorial ("Jak rozpoznać zamówienie złożone w ramach programu Allegro Ceny") example: `quantity 1`,
`originalPrice 80.00`, `price 80.00`, `reconciliation.value.amount "20.00" // kwota, którą wyrównuje Allegro
za pojedynczy przedmiot`, `reconciliation.quantity 1 // liczba przedmiotów, do których przyznaliśmy wyrównanie`,
`payment.paidAmount 80`, and for WALLET `payment.reconciliation.amount "20" // kwota, którą wyrównaliśmy w
płatności (dodaliśmy do płatności kupującego)`. Plus: "Sprzedający otrzyma wpłatę, której wartość sprawdzisz
sumując payment.paidAmount.amount oraz payment.reconciliation.amount."

So in that example `originalPrice` == `price` == the reduced buyer price (80); the seller's undiscounted
price (100) is not in `originalPrice` - it is `price + reconciliation.value`. `reconciliation.value` is
documented per single item, so the line subsidy is `value x reconciliation.quantity`.

`vouchers[]` (`LineItemVoucher`, swagger.yaml:31136-31170) is unrelated to promotions: its only type enum is
`NOTEBOOKS_FOR_TEACHERS` ("a voucher for teacher's notebook action"), with `code`, `status`
(ACTIVE/CANCELLED), `externalTransactionId`, `value` (Price, "The value of the voucher."). Not a discount carrier.

## Q5. How does OpenLinker's Allegro order mapper read price and quantity today?

**Answer: as a UNIT price.** Confidence: **confirmed** (code). Tests use qty > 1 but are synthetic
(hand-written fixtures), so they pin OL's assumption, not Allegro's behaviour; Allegro's behaviour is
settled by the tutorial arithmetic in Q1.

- `libs/integrations/allegro/src/infrastructure/adapters/allegro-order-source.adapter.ts:948-951` - subtotal
  is `item.price.amount * item.quantity` (unit x qty):
  `(acc, item) => acc + Number.parseFloat(item.price.amount) * item.quantity,`
- same file `:1008-1009` - per line `quantity: lineItem.quantity, price: Number.parseFloat(lineItem.price.amount)`
  (copied as-is into `IncomingOrderItem.price`). `unitPriceGross` is not set by the Allegro adapter.
- `:965-966` - order discount is inferred as `subtotal + shipping - totalToPay` when positive.
- Wire type `libs/integrations/allegro/src/domain/types/allegro-api.types.ts:75-85` declares only
  `id, offer{id,name}, quantity, price, boughtAt, tax` - **`originalPrice`, `discounts`, `reconciliation`,
  `vouchers`, `selectedAdditionalServices`, `deposit` and `offer.productSet` are not declared or read.**
  Consequences: a product-set line is ingested as N units of one offer (components invisible); Allegro Ceny
  reconciliation (seller income above buyer price) is invisible; `selectedAdditionalServices` (e.g. GIFT_WRAP,
  per-unit price) are not in the subtotal, so they surface only as part of the shipping fallback
  `total - subtotal` (when `delivery.cost` is absent) or as a negative "surcharge" gap that `discountTotal` ignores.
- Fixtures with quantity > 1 (all synthetic):
  `libs/integrations/allegro/src/infrastructure/adapters/__tests__/allegro-order-source.adapter.spec.ts:74-79`
  (qty 2, price 50.00, totalToPay 100.00, asserts subtotal 100 at :97);
  `:590-594` (qty 2, price 19.99, totalToPay 39.98) with `:612-620` asserting `price: 19.99` and
  `subtotal: 39.98`; `:1053-1062` (qty 5, price 10.00, asserts subtotal 50).
- Core contract `libs/core/src/orders/domain/types/incoming-order.types.ts:177-178` (`quantity`, `price`, no
  comment); the adjacent `unitPriceGross` (:181-186) is documented as "Gross (tax-inclusive) UNIT price".
