# Developer Task

## Description
Wire InventorySyncService so that inventory changes propagate to Allegro offers using the mapping from Listings domain.

## Tasks
- [x] On inventory update, resolve mapped Allegro offers per connection
- [x] Enqueue/execute updateOfferQuantity jobs (idempotent)
- [x] Ensure retries/backoff work with commandId idempotency

## Acceptance Criteria
- [x] Inventory update results in Allegro quantity command execution
- [x] Retries do not duplicate effects
- [x] Tests pass
