# Implementation plan - Shoper: map variant options to `ProductVariant.attributes` (#3706)

## 1. Task

Layer: **Integration / Infrastructure** (`libs/integrations/shoper`). No core change. Stacked on PR #3704.

`mapShoperStockToVariant` sets `attributes: null`, so siblings of a multi-variant Shoper product reach an
explicit-grouping destination (Erli, #986) with no distinguishing values (#1065).

Non-goals: `options_non_stock` (product add-ons with price changes, not variants), `products.options`
(a list of non-default stock ids), the missing `code` on a stock, `tax_id = '0'`.

## 2. Verified read shape (live probe, 5 Oct 2026, product 127, read-only `GET`s)

- `product-stocks[].options` is `{ "<option_id>": "<ovalue_id>" }` - IDS ONLY. A stock with none carries `[]`
  (PHP's empty array), so the type is `Record<string,string> | []`.
- Names are a separate resource: `GET /options/:id` -> `translations[lang].name` ("Kolor"),
  `GET /option-values?filters[option_id]=:id` (bracket filter honoured, rows carry `option_id`) ->
  `translations[lang].value` ("biszkoptowy", "Shoper blue").
- `products.options` is `[217, 218]`, not option data.

## 3. Design

1. `shoper-api.types.ts`: type `ShoperStockOptions`, `ShoperOption`, `ShoperOptionValue`; `ShoperProduct.options` -> `readonly number[]`.
2. `ShoperOptionTableProvider` (`shop-context/`, the `ShoperTaxTableProvider` shape): per option id, memoised
   promise of `{option, values}`; 404 -> `null`; a value row of ANOTHER option proves the filter was ignored ->
   `null` + warn (the #3704 parcels lesson); transport failures propagate and are not cached.
3. Mapper (pure): `shoperStockOptionPairs`, `resolveShoperVariantAttributes`; `mapShoperStockToVariant` gains an
   optional 4th argument. ALL-or-nothing: any unresolvable pair, a missing name/value or a name collision gives
   `attributes: null` plus a reason - never a partial group.
4. Adapter: resolves attributes per stock, logs the reason, drops the old `warn`; factory wires the provider.
5. README: Known gaps entry replaced by the verified shape.

## 4. Tests

Fixture captured from the real shop (`shoper-test-data.ts`), mapper spec, provider spec, adapter spec.

## 5. Pre-implement gate

Skipped, stated explicitly: self-contained change in one package; grep found no existing
`ShoperOptionTableProvider` / option-table reader and no core contract is touched.
