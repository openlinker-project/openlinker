# ADR-077: Catalogue prices are gross; tax-basis conversion is adapter-owned

- **Status**: Proposed
- **Date**: 2026-10-12
- **Authors**: @norbert-kulus-blockydevs

## Context

`Product.price` / `ProductVariant.price` carried no stated tax basis, so each master adapter filled them from the field nearest to hand:

- PrestaShop: its tax-excluded `price`.
- WooCommerce: whatever its `woocommerce_prices_include_tax` setting made it, and the sale price while a promotion ran.
- Subiekt: deliberately gross.

Every consumer passed the number through unchanged. Allegro and Erli read it as gross, and the PrestaShop publisher wrote it into a tax-excluded field. Measured end to end (#3737): a PrestaShop product priced 100.00 net in a 23% group (123.00 for a Polish buyer) became an active Allegro offer at 100.00.

The order side already had an explicit basis (`taxTreatment`, `unitPriceGross`, `shippingGross`; [ADR-014](./014-source-authoritative-order-pricing.md)). The catalogue side had none, and the golden-path tests compared net to net, so they stayed green.

## Decision

A catalogue price is the **gross amount a buyer pays**, in the master connection's sales country and currency, **excluding promotions**. Conversion between net and gross happens only inside the platform adapter, with that platform's own rate and rounding. Core applies no rate ([ADR-063](./063-per-line-tax-rate-resolution-and-provenance.md) § 5 restricts core, and rounding is the adapter's). When an adapter cannot state a gross figure, the price is **absent**, never net.

- **PrestaShop master**: transcribes PrestaShop's own computed price for the sales country (`price[..][use_tax]=1`), and accepts it only when the shop's rules name a rate for that country and its figure equals `net × (1 + rate)` within a cent.
  - The sales country is the connection's `salesCountryIso2`, or else `PS_COUNTRY_DEFAULT`.
  - A shop with `PS_TAX = 0` passes its price through as it stands.
- **WooCommerce master**: reads `regular_price`. It grosses up with the store's own class × country rate only when the store taxes and enters prices without tax.
- **Shop publishers**: convert back to their own basis. PrestaShop writes net to 6 decimals plus the matching `id_tax_rules_group`. WooCommerce writes net for a tax-exclusive store, in both the publish path and `updateShopProductPrice`. An unresolvable rate is a terminal refusal.
- **Correction wave**: the first post-upgrade price move of a previously net master is stamped `cause: 'tax-basis-correction'` and never auto-applied ([ADR-072](./072-recurring-price-propagation.md)).

## Alternatives considered

- **Net price plus a basis flag on `Product`**: every consumer would need a rate, so core would compute tax. Rejected.
- **A second `priceGross` field**: two prices for one fact, and every consumer must pick one. That is this bug, one level up. Rejected.
- **Core converts using the stored `taxRate`** (#3737 as filed): the first place core computes tax. The stored rate is resolved country-less, so it can disagree with what the shop charges. Rejected.
- **Opt-in per connection, defaulting to today's behaviour**: leaves every install mispriced until someone acts. The correction wave's manual review is the safety net instead. Rejected.

## Consequences

**Pros:**
- One meaning for a catalogue price on every path. Subiekt already complied, and Allegro and Erli need no change.
- Subiekt → PrestaShop publishing stops taxing the buyer twice.

**Cons / trade-offs:**
- A PrestaShop shop whose default country has no tax rule (a stock docker install defaults to the US) reports no prices until `salesCountryIso2` is set. The connection tester says so.
- PrestaShop ecotax and a state-only rule fail the consistency check, so those products report no price.
- WooCommerce stops reading the active sale price. Shoper reads and writes `stock.price` unchanged; that it is gross is believed but unverified (follow-up).
- A `pricingRule` markup set by hand to compensate for missing VAT now counts VAT twice.

**Migration path:**
- One migration flags priced variants of PrestaShop/WooCommerce masters with `priceBasisPending` and adds `price_change_episodes.cause`. The next sync stamps the correction and clears the flag.
- No SQL backfill of prices; a resync rewrites them.
- Shop products published from a gross master before this change need one republish.

## References

- Related issues: #3737
- Related ADRs: [ADR-014](./014-source-authoritative-order-pricing.md), [ADR-063](./063-per-line-tax-rate-resolution-and-provenance.md), [ADR-072](./072-recurring-price-propagation.md)
- Primary doc section: [docs/architecture-overview.md](../../architecture-overview.md)
