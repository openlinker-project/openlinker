# Implementation plan - "this destination owns fulfilment" display flag (#2118)

## Goal and layer
One display-only per-connection flag, `Connection.config.fulfilmentOwnedByDestination: boolean`
(default `false`), so OpenLinker hides its own packing affordances for orders routed to a destination
that packs and ships itself (an external OMS/WMS). CORE (config coercer) + API (write validation) +
Frontend (settings checkbox, hide packed control/tick).

## Non-goals
Not an authority or exclusivity mechanism: `POST /orders/:id/packed` still succeeds whatever the flag
says. Not a capability, not per-order, no migration (JSONB), no new endpoint.

## Base
Branched from `main`. #2072's substance is already there (`order_records.packedAt`, `OrderPackedControl`,
`OrderPackedTick`, `markPacked`), so nothing is blocked. No overlap with the OMS wizard branch
(#3668), which does not touch connection settings or the packed UI.

## Steps
1. **Coercer** `libs/core/src/identifier-mapping/domain/types/fulfilment-ownership.types.ts`:
   `FULFILMENT_OWNED_BY_DESTINATION_CONFIG_KEY`, `readFulfilmentOwnedByDestination(config)` (true only
   for the boolean `true`), `isPresentButInvalidFulfilmentOwnedByDestination(config)`; export from the
   identifier-mapping barrel; spec beside the `stock-safety-buffer` spec.
2. **Write validation** `ConnectionService.validateFulfilmentOwnedByDestinationConfig` (create + update,
   next to `validateStockAndPricingConfig`): a present non-boolean is a 400. Stronger than the issue's
   "warn and fall back": nothing in core reads the flag at runtime, so a warn would have no call site;
   refusing on write is the #2610 precedent (reported must equal enforced). A legacy malformed value
   already stored still reads as `false` in both coercers.
3. **FE reader** `features/connections/lib/fulfilment-ownership.ts` (mirror of step 1; the browser
   cannot import core, #591). One boolean test, so no new `check:*-mirror` script.
4. **Settings checkbox**: new `FulfilmentOwnershipSection`, only for connections with
   `OrderProcessorManager`; schema field, patch type, merge, hydration and `sync…ToJson` in the form,
   following `stockLocationOverride`. Writes explicit `false`/`true`, never deletes the key.
5. **Hide the affordances**: pure `isFulfilmentOwnedByDestination(syncStatus, ownedIds)` in
   `features/orders/lib`; `useFulfilmentOwnedConnectionIds()` from the connections query. Order detail
   hides `OrderPackedControl`, the list hides `OrderPackedTick` (there is no packed filter/column to
   hide). An order counts as destination-fulfilled when ANY of its destinations is flagged.
6. **Copy** in a `*.copy.ts` so `check-ui-vocabulary` scans it.

## Tests
Core coercer spec; ConnectionService spec for the 400; FE: coercer, pure order predicate, section
render/gating, detail hides the control when flagged and shows it otherwise, list tick likewise.

## Risks / open
- Assumption from the issue: an external-OMS deployment is actually expected. Unconfirmed; the flag is
  cheap but unused config otherwise.
- `OrderRecord.syncStatus` is empty for orders OpenLinker owns (OMS), so those never read as flagged.
