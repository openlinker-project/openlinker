# Implementation plan: Amazon as InventoryMaster (#4183)

Part of epic #4176, stacked on #4182 (ProductMaster). Layer: Integration
(`libs/integrations/amazon`), plus one field on the Amazon connection page.

## Goal

When Amazon is where the seller keeps stock, OpenLinker reads Amazon's
quantities and the ordinary propagation publishes them to the other channels.

- FBM: the listing's `fulfillment_availability` entry for the seller channel
  (`DEFAULT`) is the master stock of that variant.
- FBA (opt-in): `getInventorySummaries` (FBA Inventory API v1) reported at an
  operator-chosen OpenLinker location, never written.
- `adjustInventory` (manual correction, return restock, sale decrement) writes
  the FBM quantity with `patchListingsItem`.

Non-goals: selling FBA stock from other channels (#4185, Multi-Channel
Fulfillment), returns (#4184), multi-location pruning.

## Findings that shape the design

1. **Core cannot hold FBM pooled and FBA located for one variant.**
   `MasterInventorySyncService` treats a variant reported both without and with
   a location in one response as a contradiction and stales the pooled row
   (#2322). So FBA is only reported when the FBM position is located too, i.e.
   when the connection has `stockLocationOverride` (the core field the
   connection page already edits). The config policy refuses `fbaLocationId`
   without `stockLocationOverride`, or equal to it; the adapter also skips FBA
   (with a warning) if that ever reaches it.
2. **A location an adapter reports is stored as is.** A plugin cannot create
   `inventory_locations` rows (HostServices is not widened, ADR-062), so the
   operator picks an existing location (`fbaLocationId`) on the connection
   page, from the active locations.
3. **Core prunes per variant, not per location.** A FBA row that is no longer
   reported would stay with its last quantity. With FBA on, every variant gets
   a FBA position (0 when Amazon lists none), and a failed FBA read fails the
   product's sync instead of dropping the rows.
4. **The offer branch of propagation does not exclude the stock master.** An
   Amazon connection with both `InventoryMaster` and `OfferManager` would get
   its own (buffered, reservation-reduced) quantity written back to its
   listings, lowering Amazon's stock on every sync. The Amazon offer manager
   skips the quantity write on a connection that is the stock master.

## Steps

1. `domain/types/amazon-config.types.ts` + `amazon-config.policy.ts`:
   `fbaLocationId` (optional, `ol_location_*`), validated against
   `stockLocationOverride`.
2. `domain/types/amazon-fba-inventory.types.ts`: FBA summaries wire types.
3. `infrastructure/readers/amazon-fba-inventory.reader.ts`: summaries for up
   to 50 SKUs a call, `nextToken` followed, per-instance cache.
4. `infrastructure/readers/amazon-listing.reader.ts`: `refresh(sku)` (a write
   starts from Amazon's current quantity, never the cache).
5. `infrastructure/mappers/amazon-inventory.mapper.ts`: FBM quantity of a
   listing (`DEFAULT` entry; none at all = 0; an entry without a number =
   unreadable error, never 0).
6. `infrastructure/adapters/inventory-master/amazon-inventory-master.adapter.ts`:
   `listInventory`, `getInventory`, `getAvailableQuantity`,
   `prefetchInventory` (BulkInventoryReader, guard-only), `adjustInventory`
   (FBM only; refused for a FBA location or a FBA-only listing; idempotency
   key honoured through the host cache for 7 days, `unsupported` without one;
   `appliedAt: null`), reserve/release refused.
7. Factory `createInventoryMaster`, plugin dispatch, manifest
   `InventoryMaster` (not in `defaultEnabledCapabilities`).
8. Offer manager: quantity write skipped on a stock-master connection.
9. Web: FBA location select in the Amazon edit section (when
   `InventoryMaster` is enabled), en + pl copy.
10. Tests: mapper, FBA reader, adapter, policy, offer-manager skip, FE config.

## Risks / open points

- Not verified on a live account (sandbox has no FBA data). Field names follow
  Amazon's published models.
- With FBA on, FBA quantity counts toward available-to-promise on every
  channel before #4185 exists; the connection page says so.
- `adjustInventory` reads the listing and then patches it: Amazon has no
  conditional stock write, so a sale on Amazon between the two is overwritten.
  To measure on a live account together with how long Amazon takes to apply an
  accepted patch.
- Stock is read on the catalogue marketplace (`catalogueMarketplaceId`, #4182),
  the same one the catalogue is read from.
