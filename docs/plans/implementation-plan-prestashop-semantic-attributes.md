# Implementation Plan — PrestaShop semantic variant attributes (#1050)

**Issue:** #1050 (prerequisite for #1038, epic #1005) · **Layer:** Integration (PrestaShop) only · **Size:** M

## 1. Understand

Make the PrestaShop product-master adapter emit `ProductVariant.attributes` as semantic `{ attributeGroupName: valueName }` (e.g. `{ "Color": "Red" }`) instead of the current positional `{ option_${index}: <product_option_value_id> }`, matching the WooCommerce shape so attribute mapping (#1038) has usable input.

**Non-goals:** core changes (`ProductVariant.attributes` contract unchanged — only content); a migration/backfill (master-derived data self-heals on next sync; SQL can't resolve option ids → names); WooCommerce (already semantic); the attribute-mapping/projection itself (#1038).

## 2. Research findings
- `prestashop-product.mapper.ts:73` → `attributes['option_${index}'] = readAssociationId(ov)` (positional key + `product_option_value` id).
- Adapter `getProductVariants` (`prestashop-product-master.adapter.ts` ~180–290) fetches `combinations`, maps each via `productMapper.mapVariant(combination, productId)`. Combinations carry `associations.product_option_values` → list of `{ id }` references.
- WS client: `getResource(resource, id)` + `listResources(resource, filters?, limit?, offset?)` with `PrestashopQueryFilters` (has a `custom` escape hatch — used today for `id_product`).
- Mapper has `getLocalizedField(field, langId=1)` for PS multi-language name fields; `mapProduct` resolves `name` that way. No `PrestashopProductOption`/`…OptionValue` types exist yet.
- `attributes` **is** persisted (variants JSONB column) → existing rows hold positional shape until re-synced (self-heals; no migration).

## 3. Design

### Why semantic names, not the stable option-value id (alternative considered)
PrestaShop `product_option_value` **ids are store-global and stable** (id 15 = "Red" in "Color" everywhere), so projection-correctness *alone* could be had cheaper by keying attributes on the attribute-**group id** (one WS call, no name resolution). Rejected because: (1) **cross-source consistency** — WooCommerce already emits `{ "Color": "Red" }`, and a single neutral attribute-mapping contract (#1038) requires one shape across sources, else mappings are name-keyed for WC and id-keyed for PS; (2) names are required for a usable authoring UI; (3) `attribute_value_mappings` author `Red → Czerwony`, far better than `15 → Czerwony`. So we resolve to names. (Confirmed the extra fetch is unavoidable: combination `associations.product_option_values` are **id-only** refs — the mapper's `readAssociationId` proves it — PS WS doesn't deep-embed them.)

### 3.1 Types (`domain/types`)
- `PrestashopProductOption { id; name: <localized> }` — attribute group (e.g. "Color").
- `PrestashopProductOptionValue { id; name: <localized>; id_attribute_group }` — value + its group.

### 3.2 Resolver (NEW — `infrastructure/.../prestashop-attribute.resolver.ts`) — **caching is the point**
Master sync resolves the adapter **per product/job**, so a per-adapter cache wouldn't survive across products. Mirror the existing resolver-singleton pattern (`PrestashopCountryResolver`) but **hold it on the factory** (a field, constructed once) so its cache persists across product jobs for the process lifetime:
- `PrestashopAttributeResolver` holds `Map<connectionId, { map: Map<optionValueId,{groupName,valueName}>; timestamp }>`, TTL 24h (option groups/values are a tiny, near-static set).
- `getOptionValueMap(connectionId, client, langId): Promise<Map<…>>` — on miss/expired, **fetch the full set once** (`listResources('product_options')` + `listResources('product_option_values')`, `display=full`), build + cache. **Two WS calls per connection per TTL**, not per product — this is the fix for the review's IMPORTANT scaling item.
- Localized names via a shared `readLocalizedField(field, langId)` util extracted from the mapper's private `getLocalizedField` (mapper delegates to it — no behaviour change, dedupes the parser).

### 3.3 Adapter (`prestashop-product-master.adapter.ts` + factory)
- Constructor gains `attributeResolver: PrestashopAttributeResolver`. Factory holds `private readonly attributeResolver = new PrestashopAttributeResolver()` (persists with the singleton factory) and passes it in.
- `getProductVariants`: `const optionMap = await this.attributeResolver.getOptionValueMap(connection.id, httpClient, langId)`; build `resolve = (id) => optionMap.get(id) ?? null`; pass to `mapVariant`. On resolver error → log `warn`, pass `() => null` → positional fallback (a transient options fetch never breaks variant sync).

### 3.4 Mapper (`prestashop-product.mapper.ts` + interface)
- `mapVariant(combination, productId, resolveOptionValue?)`: resolver hit → `attributes[groupName] = valueName`; miss/unresolved id → `option_${index} = id` fallback (variant distinctness + back-compat); no resolver → current positional behaviour (existing callers/tests valid).

### 3.5 Tests
- **Resolver unit:** builds the map from `product_options` + `product_option_values` (mock WS); caches (second call → no WS); TTL expiry refetches; per-connection keying.
- **Mapper unit:** semantic given resolver; positional fallback when absent / unresolved; empty when no option values.
- **Adapter unit:** passes the resolver, semantic attributes on the variant, graceful fallback on resolver error. Update existing `mapVariant`/adapter specs to the new signature.

## 4. Validate
- `pnpm lint`, `pnpm type-check`, `pnpm test` (prestashop package + any core consumers). No migration → no `migration:show`. PS Testcontainer int-spec is **out of scope** (opt-in, heavy; unit coverage with mocked WS is the right level here — the option→name resolution is request-shape logic, not PS-behaviour-dependent).
- Architecture: stays within the PrestaShop plugin; mapper does no I/O (adapter fetches, passes resolved data in); neutral `ProductVariant` contract unchanged.

## Notes
- Existing persisted positional attributes correct themselves on the next master sync — documented, no backfill.
