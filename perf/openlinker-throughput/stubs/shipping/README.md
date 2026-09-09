# Carrier upstream stub

Implements GitHub issue #3043 (provisioning for F15 / #3045, epic #2840). A
single-process `node:http` stub serving `ShippingStubShippingAdapter`
(`@openlinker/integrations-shipping-stub`) - a REAL `ShippingProviderManagerPort`
adapter, so `ShipmentDispatchService.dispatch` and `ShipmentStatusSyncService`
run their exact, unmodified core code paths against it.

## Why a dedicated adapter package, not a stub server behind a real carrier adapter

`stubs/allegro` and `stubs/eparagony` both front a REAL, unmodified in-tree
adapter (Allegro / eparagony.pl) by pointing its documented test-mode
base-URL override at a stub server. That precedent does not transfer here:
`InpostShippingProviderAdapter` resolves its host from a closed
`BASE_URLS[config.environment]` map with **no override** - unlike eparagony's
`apiBaseUrl`/`authBaseUrl`, both explicitly documented "intended for
testing". Patching production carrier code to add one, purely to serve a
perf harness, is a bigger and riskier change than this package.

So this stub follows the OTHER shipped precedent instead:
`@openlinker/integrations-invoicing-stub` (#3006) - a small, dedicated,
`requiresCredentials: false` adapter (ADR-055) that is real in every way
that matters to the measurement (it makes a real HTTP call, through the
real `ShipmentDispatchService` / `ShipmentStatusSyncService` code), and
fake only in what it talks to.

## What it serves

| Method | Path | Behaviour |
|---|---|---|
| `POST` | `/labels` | `GenerateLabelCommand` in, `GenerateLabelResult` out. `trackingNumber` is synchronous (`mintTrackingImmediately: true`, default) or `null` until polled (`false`). |
| `GET` | `/shipments/:id/tracking` | `TrackingSnapshot` out. When tracking was not minted at label time, stays `null` for `pollsUntilTracking` reads, then mints it - the `null -> value` backfill shape #1947 exists for. |

## The late-mint shape, and why it is the point

`Shipment.trackingNumber` going `null -> value` on a LATER poll is not an
edge case for InPost/ShipX - it is documented as the normal shape (ShipX
mints the waybill at courier CONFIRMATION, after label creation). Core's
`Shipment.waybillRelayedAt` at-most-once claim (#1947) and its
claim-then-release-on-failure path only run when this transition actually
happens; a stub that always minted tracking synchronously would leave that
whole mechanism permanently unmeasured, which is exactly the gap #3045
exists to close. `mintTrackingImmediately: false` + `pollsUntilTracking`
makes the transition happen ON DEMAND rather than by chance.

The COMPLEMENTARY half of #3045's "transient relay failure" arm - the
relay write BACK to the order source failing and being retried - is not
this stub's job to model: that failure belongs on the order-source
adapter's own outbound call (PrestaShop/WooCommerce/Allegro writing the
tracking number back), and the already-shipped `stubs/ps-fault-proxy`
exists for injecting exactly that kind of transient fault. Compose the two:
this stub produces the late-mint transition, `ps-fault-proxy` fails the
relay's destination transiently.

## Control surface

| Method | Path | Behaviour |
|---|---|---|
| `GET` | `/__stub/health` | `{ok: true}` - compose healthcheck target. |
| `GET` | `/__stub/config` | `{gitSha, latencyMs, mintTrackingImmediately, pollsUntilTracking, requestsTotal, labelsIssuedTotal, trackingReadsTotal, shipmentsHeld}`. |
| `PUT` | `/__stub/config` | Sets `latencyMs` / `mintTrackingImmediately` / `pollsUntilTracking`. |
| `POST` | `/__stub/reset` | Clears held shipments and counters. Knobs survive. |

`mintTrackingImmediately` is captured PER SHIPMENT at label-creation time
(the invoicing-stub "knobs survive a reset, but not mid-flight state" rule),
so a sweep sets it before enqueuing an arm's dispatch jobs.

## What it deliberately does not serve

- Cancellation, pickup-point search, insurance, or COD - no shipped scenario
  needs them yet.
- A genuinely invalid label request (bad address, unsupported method) - no
  concept of rejection here; the "mock is now the model" trap
  `stubs/allegro/README.md` names by name.
- The webhook-driven tracking path - only the poll-based backfill this
  stub's `GET /shipments/:id/tracking` serves is modelled.

## Design decisions

Same as `stubs/invoicing/README.md`'s: standalone `node:http`, zero
dependencies, `server.mjs` exports `{server, describeConfig, _resetForTest}`
for `test.mjs` to drive in-process.
