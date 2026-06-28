# Implementation Plan — #1253 Showcase all shipped integrations in docs

## 1. Goal & classification

Docs-only. Make the public-facing docs reflect the **9 shipped, registered** integration packages instead of reading as an Allegro+PrestaShop hub. No code, no tests, no migration.

**Layer:** DX (documentation). **Non-goals:** the marketing site (`openlinker.io`); any code/manifest change; writing exhaustive setup guides (InPost/DPD guides mirror the lean existing ones).

## 2. Ground truth (verified against manifests on `origin/main`)

| Package | `supportedCapabilities` (manifest) | FE plugin | Maturity signal (latest merged) |
|---|---|---|---|
| prestashop | ProductMaster, InventoryMaster, OrderSource, OrderProcessorManager | ✅ | reference adapter |
| woocommerce | ProductMaster, InventoryMaster, OrderSource, OrderProcessorManager | ✅ | shop-publish + bulk + FE (#1083) |
| allegro | OrderSource, OfferManager, **ShippingProviderManager** | ✅ | mature |
| erli | OfferManager, OrderSource | ✅ | borrowed-taxonomy mapping (#1250); 18 commits |
| inpost | **ShippingProviderManager** | ✅ | connection settings + ShipX test (#1252/#771) |
| dpd-polska | **ShippingProviderManager** | ✅ | needs_reauth + validationInfo + retry int-spec (#1106) |
| ksef | **Invoicing** | ✅ | connection settings + KSeF-no/UPO (#1152); epic #1142 |
| subiekt | **Invoicing** | ✅ | FE detail/correction/HTTP (#1249) |
| ai | (content router) | n/a | Live |

`ShippingProviderManager` and `Invoicing` are **real registered capabilities** — the new Capabilities-table rows and the "What we cover" updates are grounded, not aspirational.

## 3. Files to change

1. **`README.md` — Integrations table** (~L40–53): add **Erli** (marketplace) and **KSeF** (invoicing) rows linking their existing `docs/integrations/*/setup-guide.md`; re-status **DPD** off "Planned"; set **InPost / Subiekt** to confirmed status. Drop the now-stale "pending `ShippingProviderPort`" qualifier (the port exists).
2. **`README.md` — Capabilities table** (~L63–69): add a **Shipping** row (Allegro · InPost · DPD → `ShippingProviderManagerPort`) and an **Invoicing** row (KSeF · Subiekt → `InvoicingPort`); add **WooCommerce** to Catalog & inventory and Orders rows.
3. **`README.md` — "What we cover" table** (~L113–160): flip the now-false lines — "Generate invoices … — Out of scope" → ✅ `InvoicingPort` (KSeF/Subiekt); "Generate shipping labels 🛣️ planned" → ✅ `ShippingProviderManagerPort`; "Push tracking back 🛣️" → ✅ (order-status writeback #1157 + shipment status).
4. **`docs/integrations/inpost/setup-guide.md`** (new) — mirror the woocommerce guide skeleton (Prerequisites · credentials · create connection · capabilities · troubleshooting).
5. **`docs/integrations/dpd-polska/setup-guide.md`** (new) — same skeleton; carries the REST-creds caveat.
6. **`docs/architecture-overview.md:504`** — adjust the `OfferManagerPort` "Future Implementations" line so Erli's registered skeleton isn't listed as purely future.

## 4. Capability → integration mapping (for the Capabilities table)

- Catalog & inventory → PrestaShop · WooCommerce
- Orders → PrestaShop (src+dest) · WooCommerce (src+dest) · Allegro (source) · Erli (source)
- Offers / listings → Allegro · Erli
- Shipping → Allegro · InPost · DPD *(new row)*
- Invoicing → KSeF · Subiekt *(new row)*
- Content suggestion → AI
- Auth & ops → all

## 5. Open decision (maintainer call — see issue Assumptions)

Status labels for InPost / DPD / KSeF are a judgment call; recommendation in the work-session pause. Everything else is mechanical.

## 6. Validation

- No code touched → `check:invariants` / type-check / tests unaffected (markdown isn't linted).
- AC verification: re-grep README for all 8 platform names; confirm both new guides exist; confirm no "Planned" label on a registered package.
