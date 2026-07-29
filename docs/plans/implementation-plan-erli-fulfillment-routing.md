# Implementation Plan - Erli Fulfillment Routing (#1738 + #1739)

## 1. Goal

Make fulfillment routing work end-to-end for Erli order sources (not only Allegro -> PrestaShop), and give the Fulfillment tab a live routing-split bar.

- Backend (#1738): Erli order mapper emits `shipping.methodId`; `ErliOrderSourceAdapter` implements `SourceOptionsReader`; `MappingOptionsController.resolvePartnerConnectionId` becomes pairing/capability-driven (no platform literals).
- Frontend (#1739): new `RoutingSplitBar` in the Fulfillment tab, recomputed live from unsaved selections; Erli renders through the existing capability-gated panel.

Non-goals: weight-tier grouping of Erli methods, "Refresh from Erli" button, backfill of historical Erli order snapshots, Erli manifest capability advert (Allegro does not advertise `SourceOptionsReader` either - the `isSourceOptionsReader` guard is the functional gate; keeping manifests consistent).

## 2. Research (verified live, 2026-07-20)

- `IncomingOrder.shipping?: OrderShipping { methodId, methodName? }` exists (`libs/core/src/orders/domain/types/order.types.ts:161`); Allegro sets it, Erli drops `delivery.typeId/name` on the floor (`erli-order.mapper.ts`).
- `SourceOptionsReader` = `listOrderStatuses/listDeliveryMethods/listPaymentMethods` (`source-options-reader.capability.ts`).
- Erli sandbox confirmed: `GET /dictionaries/deliveryMethods` (114 `{id,name,cod,vendor}`), `GET /delivery/priceListsDetails` (`prices[].deliveryMethod.id` = shop-active method ids). `ErliOfferManagerAdapter.listDeliveryPriceLists` already consumes `delivery/priceLists` via the shared `IErliHttpClient` (paths WITHOUT leading slash).
- `resolvePartnerConnectionId` (`apps/api/src/mappings/http/mapping-options.controller.ts:280+`) hardcodes allegro/prestashop; pairing key `config.masterCatalogConnectionId` is set on Allegro, Erli, and WooCommerce connections alike.
- FE panel `routing-rules-panel.tsx` is capability-gated on `OrderSource` already; the only Erli blocker is the options endpoint.

## 3. Design

### BE

1. **Mapper**: `mapErliOrderToIncomingOrder` emits `shipping` (present-only) from `delivery.typeId` + `delivery.name`.
2. **Adapter**: `ErliOrderSourceAdapter implements ..., SourceOptionsReader`:
   - `listDeliveryMethods()`: fetch price-list details (active ids) + dictionary (labels); return intersection as `MappingOption[]` (label falls back to the raw id when the dictionary misses it). Non-array bodies raise `ErliApiException` (no PII).
   - `listOrderStatuses()`: static 4-value list from the Erli status enum.
   - `listPaymentMethods()`: static `online` / `cod` (Erli exposes no payment-method vocabulary; COD is a boolean on delivery).
   - New wire types + paths in `erli-delivery.types.ts`.
3. **Controller**: `resolvePartnerConnectionId` rewritten pairing-first, capability-checked:
   - source side: URL has `masterCatalogConnectionId` -> the URL is the source (verify metadata advertises `OrderSource`, else 400). Otherwise reverse-lookup active connections whose pairing key points at the URL and whose metadata advertises `OrderSource`; 0 -> 400, >1 -> 400 (open the page from the source connection), 1 -> id.
   - destination side: URL has pairing key -> return it; else the URL must itself advertise `OrderProcessorManager` (400 otherwise).
   - No `platformType` literals; metadata via `integrationsService.getAdapter` (metadata-only lookup, same as `FulfillmentRoutingService`).
   - Behavior change (accepted): a destination URL paired to BOTH Allegro and Erli now 400s as ambiguous instead of silently picking Allegro - genuinely ambiguous under multi-source.

### FE

4. **`routing-split-bar.tsx`** (`features/mappings/components/`): pure view of `{ label, count, colorIndex }` buckets; segmented flex bar (aria-hidden) + text legend with counts (`tabular-nums`); segment colors from new `--viz-cat-*` tokens (index.css + tokens.ts, drift check); `prefers-reduced-motion` respected.
5. **Panel wiring**: `RoutingRulesPanel` derives buckets from `selections` + `rowMethods` (default bucket = methods without a rule, labeled with the existing `defaultLabel`), renders the bar between description and table.

## 4. Steps

1. `erli-order.mapper.ts` + `erli-order.mapper.spec.ts` - shipping emission (with/without typeId).
2. `erli-delivery.types.ts` (new) - wire types + path consts.
3. `erli-order-source.adapter.ts` + spec - SourceOptionsReader.
4. `mapping-options.controller.ts` - pairing/capability resolution; new `mapping-options.controller.spec.ts` covering allegro-source, erli-source, prestashop-reverse (single + ambiguous), unsupported (no capability).
5. `routing-split-bar.tsx` + `routing-split-bar.test.tsx`; CSS section + tokens.
6. `routing-rules-panel.tsx` + test extension (live recompute, Erli-shaped string ids).
7. Quality gate: lint, type-check, scoped tests (erli, api, web) then full `pnpm test`.

## 5. Validation

- Hexagonal: adapter change stays in the Erli plugin; controller stays interface-layer; no CORE edits needed.
- Naming: `*.types.ts` for wire shapes; component kebab-case; tests colocated.
- Security: no PII in logs (adapter follows existing no-payload-logging rule); read-only endpoints unchanged in auth posture.
- Pre-implement gate: run as in-session self-gate (greps above + live-code facts gathered this session); full /pre-implement skipped deliberately - all touched surfaces were read in this session at HEAD.
