# Implementation Plan: Shoper ProductMaster — ProductTaxRateReader (#3677)

Epic: #3640. Builds on #3675 / #3676 (stacked branch). Rule: ADR-063.

## Live findings (trial shop, 1 Oct 2026)

`GET /taxes` -> rows `{tax_id, value, name, class}`: `1 23 "23%"`, `2 8 "8%"`, `3 0 "0%"`, `4 0 "zw."`, `5 0 "np."`, `6 5 "5%"`. The spike's open assumption is confirmed: `tax_id` exists and joins `product.tax_id` (product 93 -> `tax_id: "1"` -> 23%). Three rows share `value: "0"`, so the mapping keys on `name`.

## Design

- `ShoperProductMasterAdapter implements ProductTaxRateReader` (guard-narrowed off the dispatched `ProductMaster`; **not** added to the manifest - the WooCommerce / PrestaShop manifests do not advertise it either).
- `readProductTaxRate({productId, variantId?})`: resolve Shoper product id; `GET /products/:id`; `tax_id` -> `/taxes` row -> code via `mapShoperTaxName`.
- `readsTaxRatePerVariant()` = `false`: tax lives on the product. `variantId` is therefore ignored.
- `countryIso2: null`: Shoper's tax table is not country-scoped.
- Outcomes, aligned with `shouldPersistTaxRate` (only `unreadable` is not persisted):
  - no `tax_id` on the product -> `unknown/not-configured` (an answer; fixed in the shop)
  - `tax_id` absent from `/taxes` -> `unknown/unreadable` (the read established nothing usable)
  - row name not recognised -> `unknown/unreadable`, `detail` names it
  - transport failure -> **thrown**, never turned into an answer
- Never falls back to `application-config.product_defaults_tax_id` or to `23`.
- `/taxes` memoised per adapter instance as a promise; failure not cached (same shape as the shop-context provider).
- Name mapper (pure, `shoper-tax-rate.mapper.ts`): `"23%"`->`23`, `"8%"`->`8`, `"5%"`->`5`, `"0%"`->`0`, `"zw."`->`zw`, `"np."`->`np`, `"oo"`->`oo`; case/space/trailing-dot tolerant; `"23,0%"` style decimal comma accepted only for whole numbers; anything else -> null.

## Steps

1. `ShoperTax` type. 2. `shoper-tax-rate.mapper.ts` + table-driven spec. 3. `ShoperTaxTableProvider` (memo) + spec. 4. Adapter + factory wiring + adapter spec. 5. README, live smoke, invariants, lint, type-check.
