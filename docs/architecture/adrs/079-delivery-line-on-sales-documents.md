# ADR-079: The delivery line on sales documents is configured per buyer country, and a receipt names its VAT rate

- **Status**: Proposed
- **Date**: 2026-10-30
- **Authors**: @norbert-kulus-blockydevs

## Context

eparagony.pl rejects every receipt with paid delivery: `errorCode 83`, "wystąpił schodek podatkowy" (#3913). OpenLinker sends the delivery line under one fixed name (`Shipping`) while its VAT rate follows the basket ([ADR-063](./063-per-line-tax-rate-resolution-and-provenance.md) § 5). A fiscal printer binds a line name to one VAT rate and refuses a name whose rate goes up after it went down; a refused name stays blocked on that device for good (Dz.U. 2024 poz. 1654, § 2 pkt 1 and § 40 ust. 1). A mixed-rate basket even sends one name at two rates on one receipt. On the eparagony sandbox (115 receipts) a stable name per rate, `Koszt dostawy 23%`, was accepted 14 of 14 times.

The name is also something operators want to choose, in their own language, and the VAT treatment of delivery is a per-country legal matter that core must not encode ([ADR-026](./026-country-agnostic-invoicing-domain.md)). Allegro alone sells into four countries, so one connection sees several regimes.

## Decision

1. Delivery-line settings live on the **order-source** connection, in `config.deliveryOnDocuments = { default: Settings, countries: Record<ISO2, Settings> }` - the shape of `pricingRule`. JSONB, no migration.
2. `Settings = { name, rate: 'goods' | 'fixed' | 'spread', fixedRate?, freeDelivery: 'omit' | 'show', rateFormat: 'plain' | 'brackets' | 'vat', invoiceName?, methodNames? }`.
3. The row is picked by the buyer's delivery country (`order.shippingAddress.country`, trimmed and upper-cased). Anything not listed, or no country, uses `default`.
4. **A receipt line name always carries its VAT rate** (`Shipping 23%`), with or without configuration. The name plus suffix fits the 40 characters a printer compares. Invoices never get the suffix.
5. Name precedence: `methodNames[order.shipping.methodId]`, the country row, `default`, the legacy `config.invoicing.shippingLineName` on the invoicing connection, then `Shipping`.
6. `goods` keeps the [ADR-063](./063-per-line-tax-rate-resolution-and-provenance.md) proportional split by gross. `fixed` is one line at the operator's rate. `spread` (opt-in) adds no delivery line and folds the amount into product lines; a line's share must divide by its quantity, the remainder goes to a quantity-1 line, and if that is impossible the document falls back to `goods`.
7. `freeDelivery: 'show'` prints a zero delivery line on invoices only. A receipt never carries a zero line, since it registers what was paid.
8. Suggested settings are **data** per country in `apps/api` with a cited source, the `sales-document-template-catalogue.ts` pattern. Poland is the only entry. Core holds the resolver and knows no country.
9. The eparagony adapter refuses, before sending, any receipt that names one line at two rates, so a device lock can never be caused by OpenLinker again.

## Alternatives considered

- **One name per invoicing connection** (today). Rejected: it cannot carry a rate, so it is the bug.
- **Always fix delivery at 23%.** Rejected: a tax-authority interpretation (KIS 0114-KDIP1-3.4012.662.2023.1.PRM) ties delivery to the goods' rate, and a blanket rate is wrong outside Poland.
- **Settings on the sales-document routing rules.** Rejected: routing decides which document an order gets, not what the carrier line says, and it is keyed by document kind, not by the channel that knows the delivery methods.
- **Pick the highest rate in the basket.** Rejected: no market tool does it and it overstates tax.

## Consequences

**Pros:**
- Mixed-rate receipts pass, and no printer name is ever locked by OpenLinker.
- Operators name delivery in any language, per country and per delivery method.
- Core stays country-agnostic; a new country is a data entry.

**Cons / trade-offs:**
- Receipt names change from `Shipping` to `Shipping 23%` on deploy, which is the fix itself.
- Two places can name delivery until the legacy key is retired.

**Migration path:**
- None required. Without `deliveryOnDocuments` a connection behaves as before, plus the rate suffix on receipts.

## References

- Related issues: #3913, #3904, #3905, #3906, #3907, #3908, #3911
- Related ADRs: [ADR-026](./026-country-agnostic-invoicing-domain.md), [ADR-063](./063-per-line-tax-rate-resolution-and-provenance.md), [ADR-070](./070-sales-document-market-discovery.md)
- Mockup: [docs/plans/mockups/delivery-on-documents.html](../../plans/mockups/delivery-on-documents.html)
