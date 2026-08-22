# Changelog

All notable changes to OpenLinker are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
(pre-1.0: **minor** carries new features *and* breaking changes, **patch** carries
fixes — see [RELEASING.md](./RELEASING.md)).

From `0.2.0` onward this file is generated automatically by
[release-please](https://github.com/googleapis/release-please) from Conventional
Commits. The `0.1.0` entry below is the hand-curated baseline of what shipped
before automated releases began.

## [0.8.0](https://github.com/openlinker-project/openlinker/compare/v0.7.0...v0.8.0) (2026-08-22)


### ⚠ BREAKING CHANGES

* **core:** `SYNC_JOBS_EVENT_STREAM` is no longer exported from `@openlinker/core/sync`. The `events.sync.jobs` stream it named is a ghost - nothing reads it, verified as having no remaining in-tree consumers - and the upgrade deletes it. Separately, Redis now runs with `maxmemory` set together with `maxmemory-policy noeviction`, so an existing deployment already holding more data than the new limit will reject every `denyoom` command, including `XADD`, until the previously-unbounded streams are trimmed. `XTRIM` is not a `denyoom` command, so it stays available and is the way out. Run, in order: `DEL events.sync.jobs`; `XTRIM events.inbound.webhooks MAXLEN ~ 50000`; `XTRIM events.inbound.webhooks.dead MAXLEN ~ 10000`; `XTRIM jobs.sync MINID ~ {epoch_ms_14_days_ago}`; `XTRIM events.master.deletion.dead MINID ~ {epoch_ms_30_days_ago}`. Then confirm with `CONFIG GET maxmemory`, `CONFIG GET maxmemory-policy` and `INFO memory`. Full procedure, sizing guidance for `REDIS_MAXMEMORY`, and the rationale for `noeviction`: docs/operations/redis-stream-retention.md (refs #2163, #2223, #2226)

### Features

* adapter-declared description format (DescriptionFormat contract + WYSIWYG editor) ([#2204](https://github.com/openlinker-project/openlinker/issues/2204)) ([8021570](https://github.com/openlinker-project/openlinker/commit/8021570ad53972949d44ec6436a386bd4c264933))
* **core,currency,orders:** order-time FX rate snapshot + reporting-currency stamping ([#2135](https://github.com/openlinker-project/openlinker/issues/2135)) ([c6c1e4f](https://github.com/openlinker-project/openlinker/commit/c6c1e4f54b51ff2685f452894c40efcd9af24024))
* **core,worker,api,web:** report the master capability rung + reconcile recency per connection ([#2290](https://github.com/openlinker-project/openlinker/issues/2290)) ([6a335fd](https://github.com/openlinker-project/openlinker/commit/6a335fddd189b83ccb9f175575a1f7f100fb04b5))
* **core,worker:** concurrency lanes — per-lane caps in the job runner (ADR-050) ([#2294](https://github.com/openlinker-project/openlinker/issues/2294)) ([e913866](https://github.com/openlinker-project/openlinker/commit/e9138663f52f8cd7a1f24776f3868ba83d3f0bd1))
* **core/products:** master capability ladder — modified-since rung + PrestaShop watermark spike ([#2232](https://github.com/openlinker-project/openlinker/issues/2232)) ([e30c18e](https://github.com/openlinker-project/openlinker/commit/e30c18e7bbfe70197cd8bff05dfa49861e5ebf85))
* **dx:** make the ADR reversal gates executable in check:invariants ([#2291](https://github.com/openlinker-project/openlinker/issues/2291)) ([a46c1b4](https://github.com/openlinker-project/openlinker/commit/a46c1b48d99c0acb430f5059daf63219eb6da061))
* **fiscalization:** Polish fiscal e-receipts via a neutral fiscalization capability ([#1902](https://github.com/openlinker-project/openlinker/issues/1902)) ([#2137](https://github.com/openlinker-project/openlinker/issues/2137)) ([04b0ece](https://github.com/openlinker-project/openlinker/commit/04b0ece8fb79667c1728c9f163dc43769c0a15a4))
* **infakt:** replace free-text baseUrl with Sandbox/Production dropdown ([#2179](https://github.com/openlinker-project/openlinker/issues/2179)) ([e38d63c](https://github.com/openlinker-project/openlinker/commit/e38d63cdcc1ff0f325f37f1b757a2acebf8c5167))
* **listings,connections:** make the category-resolve in-flight ceiling operator-visible ([#2238](https://github.com/openlinker-project/openlinker/issues/2238)) ([6468944](https://github.com/openlinker-project/openlinker/commit/64689446d34e32db208315226b94f7f7336522cb))
* **listings,web:** pre-submit offer validation in the bulk wizard ([#2244](https://github.com/openlinker-project/openlinker/issues/2244)) ([6ec95e5](https://github.com/openlinker-project/openlinker/commit/6ec95e5c6fc3ad2987ddc4f9391f4b8c785e7a16))
* **listings:** recover a failed bulk batch without starting over ([#2237](https://github.com/openlinker-project/openlinker/issues/2237)) ([b32d3ad](https://github.com/openlinker-project/openlinker/commit/b32d3ad452c265a4f75f75af4e60c211c7e6cdcd)), closes [#2234](https://github.com/openlinker-project/openlinker/issues/2234)
* **listings:** streamed per-variant progress for the bulk publish Resolve step ([#2214](https://github.com/openlinker-project/openlinker/issues/2214)) ([bb1d455](https://github.com/openlinker-project/openlinker/commit/bb1d45593eabf145ce15e7c22ce8ca6b08ad1d23))
* **sales-documents,invoicing,fiscalization,web:** sales-document routing policy (ADR-041) ([#2154](https://github.com/openlinker-project/openlinker/issues/2154)) ([#2161](https://github.com/openlinker-project/openlinker/issues/2161)) ([e089363](https://github.com/openlinker-project/openlinker/commit/e08936377a15cdeb3eca685d6e6c47973aafb752))
* **web:** add Open Graph / Twitter Card meta tags with demo-prefix support ([#2175](https://github.com/openlinker-project/openlinker/issues/2175)) ([be37bff](https://github.com/openlinker-project/openlinker/commit/be37bff274600901bbd74c1435edd16f115ed9e1))
* **webhooks,worker,sync:** durable webhook spine + worker roles (ADR-049 D1, ADR-051) ([#2295](https://github.com/openlinker-project/openlinker/issues/2295)) ([25111eb](https://github.com/openlinker-project/openlinker/commit/25111eb9371ee117149d48d5d0e8a5c481123929))
* **web:** show the destination integration + step-1 config on every bulk wizard step ([#2239](https://github.com/openlinker-project/openlinker/issues/2239)) ([e533bc0](https://github.com/openlinker-project/openlinker/commit/e533bc0f254ee9377d08d0221c61ce983641e54a))
* **worker,identifier-mapping:** bound and resume the master sweeps ([#2218](https://github.com/openlinker-project/openlinker/issues/2218), [#2219](https://github.com/openlinker-project/openlinker/issues/2219)) ([#2228](https://github.com/openlinker-project/openlinker/issues/2228)) ([9099a73](https://github.com/openlinker-project/openlinker/commit/9099a7339c5e38b2b5f5268116fc32a46caf2e16))


### Bug Fixes

* **ci:** make the docs-only path gate actually fire (predicate-quantifier) ([#2297](https://github.com/openlinker-project/openlinker/issues/2297)) ([31270cf](https://github.com/openlinker-project/openlinker/commit/31270cf9611e28ab04ab280815c6524ec38de59c))
* **core:** bound every Redis stream and declare the memory policy ([#2163](https://github.com/openlinker-project/openlinker/issues/2163)) ([#2226](https://github.com/openlinker-project/openlinker/issues/2226)) ([94ba20e](https://github.com/openlinker-project/openlinker/commit/94ba20e6a4500d6c61ce0f95dc3efd53fff7a318))
* **core:** reconciliation as the deletion authority — deleted products stop selling ([#2242](https://github.com/openlinker-project/openlinker/issues/2242)) ([d392f1c](https://github.com/openlinker-project/openlinker/commit/d392f1c02573c2ca49ead2da8a2b269473c04299))
* **core:** recover Redis stream messages stranded between read and ACK + ADR-049 durability spine ([#2223](https://github.com/openlinker-project/openlinker/issues/2223)) ([66bbb89](https://github.com/openlinker-project/openlinker/commit/66bbb895690708991283c2eb7548b6550ca733f5))
* **dx:** unbreak main — register the sales-document routing knob, retire the superseded one ([#2292](https://github.com/openlinker-project/openlinker/issues/2292)) ([b29359f](https://github.com/openlinker-project/openlinker/commit/b29359fdbeeb741059c9a5cdcfc4738d629dee10))
* **erli,core,web:** surface why an Erli offer cannot sell instead of showing Draft ([#2236](https://github.com/openlinker-project/openlinker/issues/2236)) ([8fdbedd](https://github.com/openlinker-project/openlinker/commit/8fdbeddcfaee9a21bd1b8ea17c31037340e4ecc4))
* **erli:** default the offer-status sync scheduler task ON ([#2235](https://github.com/openlinker-project/openlinker/issues/2235)) ([2177a7a](https://github.com/openlinker-project/openlinker/commit/2177a7a32f89769763f1e4ce299eb2f10c61e127)), closes [#2230](https://github.com/openlinker-project/openlinker/issues/2230)
* **listings,connections:** address review on the resolve-concurrency ceiling ([#2274](https://github.com/openlinker-project/openlinker/issues/2274)) ([a4ea0bc](https://github.com/openlinker-project/openlinker/commit/a4ea0bc243f5bc76bc2d962b5d2384177655ba4c)), closes [#2229](https://github.com/openlinker-project/openlinker/issues/2229)
* **web/orders:** stop claiming nothing has synced when a filter is simply narrow ([#2149](https://github.com/openlinker-project/openlinker/issues/2149)) ([54e73a2](https://github.com/openlinker-project/openlinker/commit/54e73a2ba52b11157e48cef275f0be652fa5e8de))
* **web:** add the favicon set the app never had ([#2183](https://github.com/openlinker-project/openlinker/issues/2183)) ([58d832c](https://github.com/openlinker-project/openlinker/commit/58d832cb55c555865b1cb2d77d0b0403afef10a2))


### Miscellaneous Chores

* **core:** declare the Redis stream retention upgrade as breaking ([#2163](https://github.com/openlinker-project/openlinker/issues/2163)) ([#2259](https://github.com/openlinker-project/openlinker/issues/2259)) ([3598ff6](https://github.com/openlinker-project/openlinker/commit/3598ff65a92f2e21f3c020bd0035d6a28f1c76e2))

## [0.7.0](https://github.com/openlinker-project/openlinker/compare/v0.6.0...v0.7.0) (2026-08-18)


### Features

* **analytics-trust,sync:** add analytics data-trust reads ([#2037](https://github.com/openlinker-project/openlinker/issues/2037)) ([cf0beac](https://github.com/openlinker-project/openlinker/commit/cf0beac644218cef8e964bb1639ce027c56785b6))
* **invoicing,orders,web:** persist and surface the auto-issue block reason ([#2100](https://github.com/openlinker-project/openlinker/issues/2100)) ([#2129](https://github.com/openlinker-project/openlinker/issues/2129)) ([c9231c9](https://github.com/openlinker-project/openlinker/commit/c9231c9ba3d994eae2015d68800518a1b843fd69))
* **listings,api:** repoint marketplace category reads at the taxonomy projection ([#2117](https://github.com/openlinker-project/openlinker/issues/2117)) ([ab2c963](https://github.com/openlinker-project/openlinker/commit/ab2c96369661d91b80598071d1fbbd185b79fd2f)), closes [#2074](https://github.com/openlinker-project/openlinker/issues/2074)
* **listings,integrations:** bootstrap destination taxonomy on connect, delegate shop browse to the projection ([#2145](https://github.com/openlinker-project/openlinker/issues/2145)) ([6956d29](https://github.com/openlinker-project/openlinker/commit/6956d29ac24a135e745b85211d2a3828aac0bff6)), closes [#2084](https://github.com/openlinker-project/openlinker/issues/2084) [#2085](https://github.com/openlinker-project/openlinker/issues/2085)
* **listings,orders,analytics:** needs-attention aggregates ([#2045](https://github.com/openlinker-project/openlinker/issues/2045)) ([b849933](https://github.com/openlinker-project/openlinker/commit/b8499333d3ab4403c6c30c896ba521bac2f92e1f))
* **listings,sync:** derive the taxonomy sync frontier from the projection ([#2067](https://github.com/openlinker-project/openlinker/issues/2067)) ([07fa171](https://github.com/openlinker-project/openlinker/commit/07fa1711ee35bfe566f84b4bcd306439d58d2169))
* **listings,sync:** neutral destination-taxonomy read model (browse + search + sync) ([#2062](https://github.com/openlinker-project/openlinker/issues/2062)) ([59fe748](https://github.com/openlinker-project/openlinker/commit/59fe748db00f4646a41b68d4a64e8b12d7ccb346))
* **orders:** capture order cancellation as first-class record state ([#2022](https://github.com/openlinker-project/openlinker/issues/2022)) ([5e1443c](https://github.com/openlinker-project/openlinker/commit/5e1443c35f4d9932baaefaec94fa92b9676c7cec))
* **orders:** capture return/refund/withdrawal as a first-class record ([#2046](https://github.com/openlinker-project/openlinker/issues/2046)) ([e4fe656](https://github.com/openlinker-project/openlinker/commit/e4fe656ae4e6ea0599bfabcde22b45f85c8693e0))
* **shared,plugin-sdk:** Redis-backed cross-process rate limiter ([#2019](https://github.com/openlinker-project/openlinker/issues/2019)) ([d5e8104](https://github.com/openlinker-project/openlinker/commit/d5e8104d7a57312655290839232d5d1c4484edbf))
* **web/listings,mappings:** whole-tree category search in the pickers ([#2133](https://github.com/openlinker-project/openlinker/issues/2133)) ([bc59f43](https://github.com/openlinker-project/openlinker/commit/bc59f43ec7defc8283bc1e23d2653e9ef477b956))
* **web/listings:** redesign /listings with lifecycle tabs and channel-side commercial data ([#2032](https://github.com/openlinker-project/openlinker/issues/2032)) ([805e29c](https://github.com/openlinker-project/openlinker/commit/805e29ca34a66c22ab2dbf2be68754243bf97951))
* **web:** unify the Order identity and Connection cells across the remaining five lists ([#2086](https://github.com/openlinker-project/openlinker/issues/2086)) ([#2150](https://github.com/openlinker-project/openlinker/issues/2150)) ([14bfc6e](https://github.com/openlinker-project/openlinker/commit/14bfc6e60dc2c5c51b0c8459511fb83aa0f8b6dd))


### Bug Fixes

* **core/orders:** stop the order upsert resetting fulfillmentState to NULL ([#2107](https://github.com/openlinker-project/openlinker/issues/2107)) ([b3e1506](https://github.com/openlinker-project/openlinker/commit/b3e1506399d9b938747e9b6dbedb3e72397b5c84))
* **core/orders:** stop the order upsert wiping syncStatus and syncAttempts ([#2141](https://github.com/openlinker-project/openlinker/issues/2141)) ([5bbb63e](https://github.com/openlinker-project/openlinker/commit/5bbb63e1f2c820928cbded7b05a9319e4028e5c4))
* **dx:** resolve the WooCommerce dev-stack container through Compose ([#2112](https://github.com/openlinker-project/openlinker/issues/2112)) ([3df1b54](https://github.com/openlinker-project/openlinker/commit/3df1b54a65d1aace13a241d6f5be7438e25d7a30))
* **infakt:** stamp the invoice currency instead of booking in the account default ([#2108](https://github.com/openlinker-project/openlinker/issues/2108)) ([a65981b](https://github.com/openlinker-project/openlinker/commit/a65981b103f760936dab10d99f694a9ac43929da))
* **invoicing,web:** lock an order to one invoicing connection ([#2047](https://github.com/openlinker-project/openlinker/issues/2047)) ([#2060](https://github.com/openlinker-project/openlinker/issues/2060)) ([0788a5f](https://github.com/openlinker-project/openlinker/commit/0788a5f3ef85c87721f4eb9f63d47e9830f1a433))
* **invoicing:** let operators pick the correction line instead of typing it ([#2132](https://github.com/openlinker-project/openlinker/issues/2132)) ([c481678](https://github.com/openlinker-project/openlinker/commit/c481678f6b021d700cae25193ba54d5e92863c45))
* **listings,allegro:** taxonomy identity is declared, not inferred from platformType ([#2065](https://github.com/openlinker-project/openlinker/issues/2065)) ([8c64e32](https://github.com/openlinker-project/openlinker/commit/8c64e3252c5cc971a2fb4033e4acfe29de70707c))
* **listings:** write the status snapshot a create already knows, and make its reconcile reachable ([#2039](https://github.com/openlinker-project/openlinker/issues/2039)) ([#2044](https://github.com/openlinker-project/openlinker/issues/2044)) ([bded91b](https://github.com/openlinker-project/openlinker/commit/bded91be1c9de107f32cc5ffa9a85fbd3deeef2f))
* **prestashop:** refuse an unresolvable order currency instead of defaulting to id 1 ([#2142](https://github.com/openlinker-project/openlinker/issues/2142)) ([4b1bd67](https://github.com/openlinker-project/openlinker/commit/4b1bd675ba3575f3853c8f544c3e47f54b142888))
* **prestashop:** tell an unknown tax rate apart from a resolved zero ([#2057](https://github.com/openlinker-project/openlinker/issues/2057)) ([351c78d](https://github.com/openlinker-project/openlinker/commit/351c78d314d61cc93331552c746620b0cd9866ec))
* **prestashop:** use the real order_details id as the line id ([#2134](https://github.com/openlinker-project/openlinker/issues/2134)) ([7401126](https://github.com/openlinker-project/openlinker/commit/74011260bd2780dc664c76f8c47ec6bd3b7c0600))
* **web:** persist explicit config.rateLimit: null on revert-to-default ([#2016](https://github.com/openlinker-project/openlinker/issues/2016)) ([#2017](https://github.com/openlinker-project/openlinker/issues/2017)) ([3a35ff8](https://github.com/openlinker-project/openlinker/commit/3a35ff8a3fb334a67a47fae3f8e2844c4451a875))
* **woocommerce:** map placedAt from date_created_gmt on order source ([#2114](https://github.com/openlinker-project/openlinker/issues/2114)) ([bd642a0](https://github.com/openlinker-project/openlinker/commit/bd642a070fabbc456d67c2efd6f6a464e06295c8))

## [0.6.0](https://github.com/openlinker-project/openlinker/compare/v0.5.0...v0.6.0) (2026-08-10)


### Features

* **allegro,shared:** Allegro adopts the connection-bound rate-limit transport ([#1977](https://github.com/openlinker-project/openlinker/issues/1977)) ([ee4ba43](https://github.com/openlinker-project/openlinker/commit/ee4ba43050e09b0a192431a735a08b18fb49ec18))
* **dpd-polska,shared:** DPD Polska adopts the connection-bound rate-limit transport ([#2005](https://github.com/openlinker-project/openlinker/issues/2005)) ([2204ad1](https://github.com/openlinker-project/openlinker/commit/2204ad1df96cb58931abd3c90bd7d2fe69323188))
* **erli,shared:** Erli adopts the connection-bound rate-limit transport ([#1978](https://github.com/openlinker-project/openlinker/issues/1978)) ([fc15324](https://github.com/openlinker-project/openlinker/commit/fc153247c9f24926938505e1fdbf6c4ff8ec6874))
* **infakt,shared:** Infakt adopts the connection-bound rate-limit transport ([#1997](https://github.com/openlinker-project/openlinker/issues/1997)) ([570d396](https://github.com/openlinker-project/openlinker/commit/570d39699e495b869bbcafce90b9265aeef633f4))
* **inpost,shared:** InPost adopts the connection-bound rate-limit transport ([#1981](https://github.com/openlinker-project/openlinker/issues/1981)) ([1e143a1](https://github.com/openlinker-project/openlinker/commit/1e143a1b6bbcb06e37b282609700b5eb6ee1df94))
* **ksef,shared:** KSeF adopts the connection-bound rate-limit transport ([#2004](https://github.com/openlinker-project/openlinker/issues/2004)) ([b62c351](https://github.com/openlinker-project/openlinker/commit/b62c35165ce0e2b6046e62ba582510dd65614591))
* **orders,shipping,invoicing:** orderSummary projection for shipments/invoices lists ([#2012](https://github.com/openlinker-project/openlinker/issues/2012)) ([a90645d](https://github.com/openlinker-project/openlinker/commit/a90645dc635172e380293c78ca0248702f000022))
* **prestashop,api,web:** rate-limit observability for PrestaShop connections ([#1941](https://github.com/openlinker-project/openlinker/issues/1941)) ([93d04f8](https://github.com/openlinker-project/openlinker/commit/93d04f80aa2855b38a34bcd4df3b0efb6fa0533a))
* **subiekt,shared:** Subiekt nexo adopts the connection-bound rate-limit transport ([#2006](https://github.com/openlinker-project/openlinker/issues/2006)) ([7bfb46e](https://github.com/openlinker-project/openlinker/commit/7bfb46e6e625276b1167178162eb76bc0fb1aac1))
* **web:** add shared AccessGate primitive and gate the MCP capabilities hint ([#1994](https://github.com/openlinker-project/openlinker/issues/1994)) ([1d24560](https://github.com/openlinker-project/openlinker/commit/1d245605664c5c08b4ce0001af0f7860a6007efd))
* **woocommerce,shared:** WooCommerce adopts the connection-bound rate-limit transport ([#1980](https://github.com/openlinker-project/openlinker/issues/1980)) ([73546c0](https://github.com/openlinker-project/openlinker/commit/73546c0cb25ce40caea4fb484ed682c1a3f64ad6))


### Bug Fixes

* **api/auth:** clear stale host-only ol_refresh/ol_csrf duplicates on set/clear ([#2000](https://github.com/openlinker-project/openlinker/issues/2000)) ([18fc501](https://github.com/openlinker-project/openlinker/commit/18fc5012600bffb25dfb36eacbf122ce3806c8a1))
* **worker,core:** heartbeat running sync jobs to survive the stuck-job reclaim sweep ([#1957](https://github.com/openlinker-project/openlinker/issues/1957)) ([7a4d393](https://github.com/openlinker-project/openlinker/commit/7a4d393d2e0570cd842e1ca3f06da4fca8fef91e))

## [0.5.0](https://github.com/openlinker-project/openlinker/compare/v0.4.0...v0.5.0) (2026-08-03)


### Features

* **api,web/demo:** require session-recording consent to use the demo ([#1938](https://github.com/openlinker-project/openlinker/issues/1938)) ([#1945](https://github.com/openlinker-project/openlinker/issues/1945)) ([d081195](https://github.com/openlinker-project/openlinker/commit/d081195c7c294cf61310971c29e05d26e0977bcf))
* **core,api,web/shipments:** persist providerCode on Shipment, re-key failure triage grouping ([#1918](https://github.com/openlinker-project/openlinker/issues/1918)) ([#1925](https://github.com/openlinker-project/openlinker/issues/1925)) ([f654b22](https://github.com/openlinker-project/openlinker/commit/f654b22d2a575ef3bf3fcb42e9e39fdbc3ccad42))
* **demo:** disclose marketing-UTM tracking on /login and /register ([#1895](https://github.com/openlinker-project/openlinker/issues/1895)) ([7af84a5](https://github.com/openlinker-project/openlinker/commit/7af84a5cfeca94babd5d23823fbc50380ca83e9d))
* **demo:** PostHog analytics framework, settings panel, and full viewer-event instrumentation ([#1817](https://github.com/openlinker-project/openlinker/issues/1817)) ([a524242](https://github.com/openlinker-project/openlinker/commit/a524242c15360a7df2b9cabde8c19c21e88a75bb))
* **e2e:** apps/e2e Playwright framework + golden paths S1-S4 (unattended) and S0-S9 (attended, all 6 systems) ([#1480](https://github.com/openlinker-project/openlinker/issues/1480)) ([525dfb1](https://github.com/openlinker-project/openlinker/commit/525dfb1ea9e4098418801f8f19ff11f0cd827d83))
* **listings:** category per family and per variant in bulk offer creation ([#1930](https://github.com/openlinker-project/openlinker/issues/1930)) ([f228325](https://github.com/openlinker-project/openlinker/commit/f22832513e1c2c97442888d3c0c81638f4604543))
* **mcp:** mapping assistant tools + per-tool scope and role enforcement ([#1488](https://github.com/openlinker-project/openlinker/issues/1488)) ([#1967](https://github.com/openlinker-project/openlinker/issues/1967)) ([5a181a3](https://github.com/openlinker-project/openlinker/commit/5a181a35069af0303e1cb8fa58c960c586de650d))
* **mcp:** read-only domain tools with capability-gated dynamic tools/list ([#1931](https://github.com/openlinker-project/openlinker/issues/1931)) ([8907082](https://github.com/openlinker-project/openlinker/commit/89070821fb02e3d46e3a443ab74c0739f17493ec))
* **mcp:** Resource-Server auth via user-issued Personal Access Tokens ([#1486](https://github.com/openlinker-project/openlinker/issues/1486)) ([#1912](https://github.com/openlinker-project/openlinker/issues/1912)) ([46fea4a](https://github.com/openlinker-project/openlinker/commit/46fea4af1bfd2eb3a963d746581db388000c2372))
* **shipments:** inline retry from a failed row + carrier-message role visibility ([#1905](https://github.com/openlinker-project/openlinker/issues/1905)) ([b70b071](https://github.com/openlinker-project/openlinker/commit/b70b071ba5a35f8a583ec49e1a0275ee7e8b6e1f))
* **web/connections:** surface the MCP reconnect hint where capabilities change ([#1951](https://github.com/openlinker-project/openlinker/issues/1951)) ([0b8c130](https://github.com/openlinker-project/openlinker/commit/0b8c130308dd0d43b22471b374384cc3fc859c49)), closes [#1949](https://github.com/openlinker-project/openlinker/issues/1949)


### Bug Fixes

* **ci:** add workflow_dispatch to CD and PAT for release-please tag push ([#1894](https://github.com/openlinker-project/openlinker/issues/1894)) ([f6da62b](https://github.com/openlinker-project/openlinker/commit/f6da62bc6e37366f1df7a7b85469897458e69148))
* **core,inventory:** handle full master deletion in inventory sync ([#1903](https://github.com/openlinker-project/openlinker/issues/1903)) ([83c7ca6](https://github.com/openlinker-project/openlinker/commit/83c7ca674d04deee28f88d4b2583f7f7f3504304))
* **core,worker:** guard master staleness prunes against rival master connections ([#1914](https://github.com/openlinker-project/openlinker/issues/1914)) ([e8b4c58](https://github.com/openlinker-project/openlinker/commit/e8b4c588a7d46e85bf176f32dd4ef7f5277e32c4))
* **core/webhooks:** resolve webhook_deliveries.status by lifecycle rank on upsert ([#1919](https://github.com/openlinker-project/openlinker/issues/1919)) ([bb86874](https://github.com/openlinker-project/openlinker/commit/bb86874a95f5b185e20b0c90d853080bd63a692a)), closes [#1916](https://github.com/openlinker-project/openlinker/issues/1916)
* **infakt:** issue corrections via the documented async endpoint ([#1899](https://github.com/openlinker-project/openlinker/issues/1899)) ([8498c45](https://github.com/openlinker-project/openlinker/commit/8498c45bb3e42c07894e3dfd83ce899ebfa1799a))
* **infakt:** read the real v3 list envelope and resolve clients by an actual NIP filter ([#1927](https://github.com/openlinker-project/openlinker/issues/1927)) ([21a7722](https://github.com/openlinker-project/openlinker/commit/21a77223101f105f285ee02ae1f66d14278578b8))
* **infra:** align demo Dockerfiles/compose with SysOps container standards ([#1915](https://github.com/openlinker-project/openlinker/issues/1915)) ([3a990f8](https://github.com/openlinker-project/openlinker/commit/3a990f83aa31058ff31639074ae9a1e263a6cc2f))
* **listings:** close ten bulk-wizard preflight-vs-backend divergences ([#1939](https://github.com/openlinker-project/openlinker/issues/1939)) ([2bd07c9](https://github.com/openlinker-project/openlinker/commit/2bd07c93f8ddffa40c6df9bef96ec090dbf76668))
* **listings:** distinguish all-duplicate/partial-duplicate bulk submit outcomes ([#1935](https://github.com/openlinker-project/openlinker/issues/1935)) ([c950f8c](https://github.com/openlinker-project/openlinker/commit/c950f8c1362dc22f73c51256afef95edb96d711e))
* **listings:** stop rejecting adapter-supplied params, and mirror the category gate in the wizard ([#1963](https://github.com/openlinker-project/openlinker/issues/1963)) ([02172f7](https://github.com/openlinker-project/openlinker/commit/02172f79a94f1cee24023eba2fb300fcfb31ebcf))
* **prestashop:** hydrate the buyer e-mail on ingested orders ([#1928](https://github.com/openlinker-project/openlinker/issues/1928)) ([#1929](https://github.com/openlinker-project/openlinker/issues/1929)) ([b2cf6c5](https://github.com/openlinker-project/openlinker/commit/b2cf6c587c027fb821b98d753fde85afa81cbe71))
* **shipping,allegro:** relay a late-arriving waybill to the order source ([#1964](https://github.com/openlinker-project/openlinker/issues/1964)) ([deffd65](https://github.com/openlinker-project/openlinker/commit/deffd6554b7c49e86c617e7d98f214484c154a2e))
* **shipping:** serialise per-order dispatch and recover a lost carrier response ([#1921](https://github.com/openlinker-project/openlinker/issues/1921)) ([28ecb94](https://github.com/openlinker-project/openlinker/commit/28ecb94f38ec0df574f11c471ca86bf47db7763b))
* **web/connections:** let a disabled connection be re-enabled from the UI ([#1944](https://github.com/openlinker-project/openlinker/issues/1944)) ([97da368](https://github.com/openlinker-project/openlinker/commit/97da3681bf07e299a19078d71e3373f485bd1104))
* **web/listings:** serialize a variant's parameters with its own category schema ([#1950](https://github.com/openlinker-project/openlinker/issues/1950)) ([c3a6a6b](https://github.com/openlinker-project/openlinker/commit/c3a6a6bf541622d11ff95163d39963545269df77))


### Performance Improvements

* **test-kit,api:** cut integration-suite time - per-test truncation, shutdown sleep, cold jest cache, shared PrestaShop container ([#1920](https://github.com/openlinker-project/openlinker/issues/1920)) ([#1923](https://github.com/openlinker-project/openlinker/issues/1923)) ([8401f3f](https://github.com/openlinker-project/openlinker/commit/8401f3faaf8c9245ef5ed6f71c5b4ff62ce5c5c9))

## [0.4.0](https://github.com/openlinker-project/openlinker/compare/v0.3.0...v0.4.0) (2026-07-27)


### Features

* **api/auth:** theme-aware transactional email layout derived from app design tokens ([#1750](https://github.com/openlinker-project/openlinker/issues/1750)) ([135605c](https://github.com/openlinker-project/openlinker/commit/135605ca9ec1909af574a395f3cdb2b0e62d5dd1)), closes [#1748](https://github.com/openlinker-project/openlinker/issues/1748)
* **auth:** allow login with username or email ([#1730](https://github.com/openlinker-project/openlinker/issues/1730)) ([d20e998](https://github.com/openlinker-project/openlinker/commit/d20e99896cac7eb3375824d344914a3dca6b8f96))
* **auth:** capture analytics consent at registration, drop post-login prompt ([#1744](https://github.com/openlinker-project/openlinker/issues/1744)) ([42a161b](https://github.com/openlinker-project/openlinker/commit/42a161b120b3087e9251a69d17321ed25893f168))
* **auth:** self-service analytics consent toggle on /settings ([#1884](https://github.com/openlinker-project/openlinker/issues/1884)) ([49a5ae9](https://github.com/openlinker-project/openlinker/commit/49a5ae976d37b62e0a57c549bb4d6227bf201f0b))
* **dpd:** add ConnectionTester so 'Test connection' runs a real auth probe ([#1732](https://github.com/openlinker-project/openlinker/issues/1732)) ([#1733](https://github.com/openlinker-project/openlinker/issues/1733)) ([b2342e8](https://github.com/openlinker-project/openlinker/commit/b2342e85962acfa04117d2c53c1e56755da77ba9))
* **erli:** fulfillment routing for Erli sources + routing-split bar ([#1740](https://github.com/openlinker-project/openlinker/issues/1740)) ([6224d18](https://github.com/openlinker-project/openlinker/commit/6224d1849a71960e801ae79a12e8b63ffeff8113)), closes [#1738](https://github.com/openlinker-project/openlinker/issues/1738) [#1739](https://github.com/openlinker-project/openlinker/issues/1739)
* **erli:** implement OfferReader so listing details render for Erli ([#1735](https://github.com/openlinker-project/openlinker/issues/1735)) ([#1736](https://github.com/openlinker-project/openlinker/issues/1736)) ([2eee690](https://github.com/openlinker-project/openlinker/commit/2eee690632250d22ee7d6d6e421320e51b6c4d3f))
* **infakt:** webhook config modal - set signing secret + status ([#1770](https://github.com/openlinker-project/openlinker/issues/1770)) ([#1773](https://github.com/openlinker-project/openlinker/issues/1773)) ([aebc7cb](https://github.com/openlinker-project/openlinker/commit/aebc7cb43e069472d2454b9f3e8bcd9286761d46))
* **listings:** per-variant bulk offer config ([#1741](https://github.com/openlinker-project/openlinker/issues/1741)) ([#1757](https://github.com/openlinker-project/openlinker/issues/1757)) ([c2fc423](https://github.com/openlinker-project/openlinker/commit/c2fc42384ed71e8e66585de154a48bdcac99cf09))
* **listings:** reconcile stale terminal offer status against live Allegro publication ([#1760](https://github.com/openlinker-project/openlinker/issues/1760)) ([#1762](https://github.com/openlinker-project/openlinker/issues/1762)) ([35cfbee](https://github.com/openlinker-project/openlinker/commit/35cfbee85fc3735d1cbfb2f3bb77e7f76894eec6))
* **listings:** unify offer creation via multi-select picker + bulk wizard ([#1754](https://github.com/openlinker-project/openlinker/issues/1754)) ([#1774](https://github.com/openlinker-project/openlinker/issues/1774)) ([5fa88bb](https://github.com/openlinker-project/openlinker/commit/5fa88bbe166e3ad5c4fef91c25f9c58c0cbd8249))
* **listings:** unify publish flow + WooCommerce field completeness (epic [#1838](https://github.com/openlinker-project/openlinker/issues/1838)) ([#1870](https://github.com/openlinker-project/openlinker/issues/1870)) ([65cb8a5](https://github.com/openlinker-project/openlinker/commit/65cb8a5f2993498a4b541695c1f13c57b444609e))
* **orders:** mapping-aware delivery + non-Allegro ship-by (epic [#1776](https://github.com/openlinker-project/openlinker/issues/1776)) ([#1782](https://github.com/openlinker-project/openlinker/issues/1782)) ([a277764](https://github.com/openlinker-project/openlinker/commit/a277764ff68dd8cb1901aab8a88f2b597ddf905c))
* **products:** polish product detail page — full-width variant table, rich listing drawer, mobile layout ([#1753](https://github.com/openlinker-project/openlinker/issues/1753)) ([5dde2d4](https://github.com/openlinker-project/openlinker/commit/5dde2d4d7f75291d6beb1ab686e10e8659e37734))
* **products:** product-detail round-2 — rich variant drawer, single/multi states, master currency & attributes ([#1756](https://github.com/openlinker-project/openlinker/issues/1756)) ([8764423](https://github.com/openlinker-project/openlinker/commit/87644233abcf71ffaf6820b9b81ae72e7dfafeb7))
* **web/data-table:** frozen columns, pinned bulk-action bar, viewport-pinned accordion drawer ([#1758](https://github.com/openlinker-project/openlinker/issues/1758)) ([6e825bc](https://github.com/openlinker-project/openlinker/commit/6e825bcf9204c9bbce95107ed3f7f04650595e35))
* **web/mappings:** connection-pair strip, resolved labels, responsive layout ([#1784](https://github.com/openlinker-project/openlinker/issues/1784)) ([#1809](https://github.com/openlinker-project/openlinker/issues/1809)) ([a318ffd](https://github.com/openlinker-project/openlinker/commit/a318ffd98d7fea206eea9dbb03d575d0f3763e27))


### Bug Fixes

* **api/auth:** add OL_COOKIE_DOMAIN for split-subdomain deploys ([#1725](https://github.com/openlinker-project/openlinker/issues/1725)) ([#1726](https://github.com/openlinker-project/openlinker/issues/1726)) ([1dcf363](https://github.com/openlinker-project/openlinker/commit/1dcf36342f9fa11e9165f0e226923c513bf093dd))
* **api/integration-tests:** disable four core scheduler tasks in the harness ([#1889](https://github.com/openlinker-project/openlinker/issues/1889)) ([7281a10](https://github.com/openlinker-project/openlinker/commit/7281a107ca32ad84cc4e0e56687872453552d1a3)), closes [#1888](https://github.com/openlinker-project/openlinker/issues/1888)
* **content:** allow viewer role read-only access to content tab ([#1880](https://github.com/openlinker-project/openlinker/issues/1880)) ([3c558eb](https://github.com/openlinker-project/openlinker/commit/3c558eb152391add5fc59052ff7fdaf9b588c8e8))
* **dpd:** carrier population, rejection diagnosability, sender-postcode hint ([#1775](https://github.com/openlinker-project/openlinker/issues/1775), [#1777](https://github.com/openlinker-project/openlinker/issues/1777), [#1778](https://github.com/openlinker-project/openlinker/issues/1778)) ([#1781](https://github.com/openlinker-project/openlinker/issues/1781)) ([95bca6d](https://github.com/openlinker-project/openlinker/commit/95bca6db27f348c993fb720e85bfeba2f7d3c70b))
* **erli:** reconcile frozen-field protection to the verified frozen{} object shape ([#1759](https://github.com/openlinker-project/openlinker/issues/1759)) ([f3a4dd2](https://github.com/openlinker-project/openlinker/commit/f3a4dd254eb6ce71956547a06688d8f7642114e9))
* **inpost:** flatten nested ShipX field-errors so target_point rejections classify correctly ([#1816](https://github.com/openlinker-project/openlinker/issues/1816)) ([bafe267](https://github.com/openlinker-project/openlinker/commit/bafe267add7c7e59d838d807bf3ee0a3349b6195))
* **invoicing:** thread buyer e-mail to Infakt so send-by-email stops 422ing ([#1811](https://github.com/openlinker-project/openlinker/issues/1811)) ([e824f68](https://github.com/openlinker-project/openlinker/commit/e824f68209680a092e66274bb24901bab3bbbf3a))
* **mailer:** validate fromAddress shape and reject CRLF header injection ([#1771](https://github.com/openlinker-project/openlinker/issues/1771)) ([dfa897f](https://github.com/openlinker-project/openlinker/commit/dfa897f222f12f6821f8784109f99578f9870533)), closes [#1765](https://github.com/openlinker-project/openlinker/issues/1765)
* **web/connections:** generalize escape-hatch banner copy on advanced setup page ([#1746](https://github.com/openlinker-project/openlinker/issues/1746)) ([8792da9](https://github.com/openlinker-project/openlinker/commit/8792da933d3bc0c2d5b725283d03b14bf1a348e8)), closes [#1745](https://github.com/openlinker-project/openlinker/issues/1745)
* **web/connections:** WooCommerce setup wizard with capability selection ([#1727](https://github.com/openlinker-project/openlinker/issues/1727)) ([#1731](https://github.com/openlinker-project/openlinker/issues/1731)) ([4dd3848](https://github.com/openlinker-project/openlinker/commit/4dd3848dd724fc0c77a90be43e10d3cb3fd50a4c))
* **web/demo:** mask passwords only in PostHog session recordings ([#1877](https://github.com/openlinker-project/openlinker/issues/1877)) ([#1878](https://github.com/openlinker-project/openlinker/issues/1878)) ([7e23bfa](https://github.com/openlinker-project/openlinker/commit/7e23bfa92af07f21f012ca57cccf49589801c0cf))
* **web/mailer-settings:** accept display-name form in From address field ([#1761](https://github.com/openlinker-project/openlinker/issues/1761)) ([7469e3c](https://github.com/openlinker-project/openlinker/commit/7469e3c35ba2876b033695c21c90d793a220deeb))
* **web/orders:** match products table header alignment and density ([#1751](https://github.com/openlinker-project/openlinker/issues/1751)) ([9a23b17](https://github.com/openlinker-project/openlinker/commit/9a23b1772fe83e4510448d53da3887c7c5496894)), closes [#1747](https://github.com/openlinker-project/openlinker/issues/1747)
* **web/orders:** surface ShipX per-field validation details in the label-error Alert ([#1812](https://github.com/openlinker-project/openlinker/issues/1812)) ([328a17d](https://github.com/openlinker-project/openlinker/commit/328a17d413e389b2447afb6dc102149d6e973477))
* **worker:** cap master.product.syncAll default page size at 100 ([#1723](https://github.com/openlinker-project/openlinker/issues/1723)) ([#1724](https://github.com/openlinker-project/openlinker/issues/1724)) ([62ed30b](https://github.com/openlinker-project/openlinker/commit/62ed30bbe7eb272c0908f657e362395e035ecae8))

## [0.3.0](https://github.com/openlinker-project/openlinker/compare/v0.2.0...v0.3.0) (2026-07-17)


### Features

* **ksef:** session-lifecycle failure resilience - offline24, crash recovery, query fallback ([#1585](https://github.com/openlinker-project/openlinker/issues/1585)) ([#1711](https://github.com/openlinker-project/openlinker/issues/1711)) ([eb4305f](https://github.com/openlinker-project/openlinker/commit/eb4305f8003f1de66e162d5b62df35c1ff8e1218))
* **orders:** responsive orders-table redesign + deep links, invoicing status & empty-state actions ([#1715](https://github.com/openlinker-project/openlinker/issues/1715)) ([86a7d91](https://github.com/openlinker-project/openlinker/commit/86a7d911d353c6fea9f1dc651188468f56ec1ed6))
* **products:** remove inventory list page, redesign products as catalog cockpit ([#1722](https://github.com/openlinker-project/openlinker/issues/1722)) ([5db487a](https://github.com/openlinker-project/openlinker/commit/5db487ac012d0a4da04259cd49330d216e5fa837))
* **web/shipping:** scope COD currency to the routed carrier ([#1569](https://github.com/openlinker-project/openlinker/issues/1569)) ([#1716](https://github.com/openlinker-project/openlinker/issues/1716)) ([c2e2315](https://github.com/openlinker-project/openlinker/commit/c2e23158b370e95a5bbcad266c06c23e8ee14c0b))


### Bug Fixes

* **allegro:** allow operator/viewer to read responsible producers ([#1707](https://github.com/openlinker-project/openlinker/issues/1707)) ([#1708](https://github.com/openlinker-project/openlinker/issues/1708)) ([96b82c0](https://github.com/openlinker-project/openlinker/commit/96b82c0b0570621c4e8c2353e3c2114a19f19c9b))
* **ci:** use SSH_HOSTNAME for ssh-keyscan in deploy workflow ([#1717](https://github.com/openlinker-project/openlinker/issues/1717)) ([cbbb0a3](https://github.com/openlinker-project/openlinker/commit/cbbb0a3ccd59a247a6614ca3c92930d9dcc3e241))
* **inpost:** authenticate both documented webhook HMAC variants ([#1556](https://github.com/openlinker-project/openlinker/issues/1556)) ([#1721](https://github.com/openlinker-project/openlinker/issues/1721)) ([dc52cd5](https://github.com/openlinker-project/openlinker/commit/dc52cd52741663da88c73b5f71f8b46f69c3520f))
* **ksef:** gate numbering demo mode via useWriteAccess, keep nav open ([#1705](https://github.com/openlinker-project/openlinker/issues/1705)) ([#1712](https://github.com/openlinker-project/openlinker/issues/1712)) ([6681d7d](https://github.com/openlinker-project/openlinker/commit/6681d7d48e90e2b2c2611902d5a791d32f1f3409))
* **listings:** auto-retry bulk-wizard resolve step on transient failure ([#1710](https://github.com/openlinker-project/openlinker/issues/1710)) ([7fdf11d](https://github.com/openlinker-project/openlinker/commit/7fdf11d793b6dcdf9f545d410df8ab210125c732)), closes [#1709](https://github.com/openlinker-project/openlinker/issues/1709)
* **listings:** gate Erli/bulk offer-creation submits on listings:write ([#1704](https://github.com/openlinker-project/openlinker/issues/1704)) ([#1706](https://github.com/openlinker-project/openlinker/issues/1706)) ([deef6d7](https://github.com/openlinker-project/openlinker/commit/deef6d75558e9c1b46cb5ef04b098309009e7343))

## [0.2.0](https://github.com/openlinker-project/openlinker/compare/v0.1.0...v0.2.0) (2026-07-16)


### Features

* **analytics:** add admin-configurable PostHog settings to /settings ([#1687](https://github.com/openlinker-project/openlinker/issues/1687)) ([dca7eb7](https://github.com/openlinker-project/openlinker/commit/dca7eb7f5502712aaef4d521db9d5b4e9771bbd5))
* **api,web:** email-confirmation activation for demo signup ([9ba89ef](https://github.com/openlinker-project/openlinker/commit/9ba89efb4c0d189f7798670afb6d22c6e5574515))
* **api:** add mailer infrastructure (port + SMTP adapter) ([9ba89ef](https://github.com/openlinker-project/openlinker/commit/9ba89efb4c0d189f7798670afb6d22c6e5574515))
* **api:** DB-backed mailer/SMTP settings (entity, encrypted credentials, admin controller) ([9ba89ef](https://github.com/openlinker-project/openlinker/commit/9ba89efb4c0d189f7798670afb6d22c6e5574515))
* **auth:** grant viewer role read-only access to invoicing, customers, and shipments ([#1363](https://github.com/openlinker-project/openlinker/issues/1363)) ([d8d2d2f](https://github.com/openlinker-project/openlinker/commit/d8d2d2f7714808c1662415c68b57cf76c0e88d82))
* **auth:** rate-limit demo self-registration + scheduled cleanup of demo accounts ([#1471](https://github.com/openlinker-project/openlinker/issues/1471)) ([cb9d96f](https://github.com/openlinker-project/openlinker/commit/cb9d96fd83efc3d6f3f81a40e5f4dcf54af37a9d)), closes [#1469](https://github.com/openlinker-project/openlinker/issues/1469)
* **connections:** Erli setup wizard environment select (Production/Sandbox) ([#1437](https://github.com/openlinker-project/openlinker/issues/1437)) ([2dd3f51](https://github.com/openlinker-project/openlinker/commit/2dd3f514adfbbb8b15c227abac483284bc4702d5))
* **demo:** add proxy/TLS overlay, parametrize DB credentials, add public-domain deployment guide ([#1406](https://github.com/openlinker-project/openlinker/issues/1406)) ([76d356a](https://github.com/openlinker-project/openlinker/commit/76d356a982cca131bec98df5824bb9bb98073b62))
* **demo:** demo-only PostHog session recording via server-gated config seam ([#1412](https://github.com/openlinker-project/openlinker/issues/1412)) ([035bbed](https://github.com/openlinker-project/openlinker/commit/035bbed5d207ad7b69361b7782ecf4119b561a3f))
* **demo:** lock AI controls and admin navigation in demo mode ([#1379](https://github.com/openlinker-project/openlinker/issues/1379)) ([#1398](https://github.com/openlinker-project/openlinker/issues/1398)) ([dd25418](https://github.com/openlinker-project/openlinker/commit/dd254188cd7c9fa2e464c9bc21996aeaf1881f77))
* **demo:** one-command Docker demo environment (API/Web/Worker + PrestaShop) ([#1365](https://github.com/openlinker-project/openlinker/issues/1365)) ([0792f07](https://github.com/openlinker-project/openlinker/commit/0792f07d2d2f10361d11151951203fe7cb8cf7d3))
* **erli:** category/parameter browsing from Allegro's catalog without a required Allegro connection ([#1407](https://github.com/openlinker-project/openlinker/issues/1407)) ([87bc11a](https://github.com/openlinker-project/openlinker/commit/87bc11a82328289aa24a8bea14e9665a05dc6a4f))
* **erli:** operator-selectable delivery price list on offer create ([#1530](https://github.com/openlinker-project/openlinker/issues/1530)) ([#1532](https://github.com/openlinker-project/openlinker/issues/1532)) ([4120c33](https://github.com/openlinker-project/openlinker/commit/4120c33e581b693206edfe3bacbcb8987c0c8f90))
* **infakt:** bank-account picker with live inFakt default sync ([#1303](https://github.com/openlinker-project/openlinker/issues/1303) follow-up) ([#1310](https://github.com/openlinker-project/openlinker/issues/1310)) ([b279e17](https://github.com/openlinker-project/openlinker/commit/b279e171954a947e7e70863c573be9493bd73b15))
* **infakt:** consume invoice_marked_as_paid webhook + payment-status sync ([#1354](https://github.com/openlinker-project/openlinker/issues/1354)) ([#1361](https://github.com/openlinker-project/openlinker/issues/1361)) ([861680f](https://github.com/openlinker-project/openlinker/commit/861680f0637bc6b9a4879480ebf0df79a5bc3ef5))
* **infakt:** resend rejected invoice to KSeF from the UI ([#1356](https://github.com/openlinker-project/openlinker/issues/1356)) ([#1360](https://github.com/openlinker-project/openlinker/issues/1360)) ([8531a56](https://github.com/openlinker-project/openlinker/commit/8531a568546d71c15c905b8d721786eb3b672491))
* **infakt:** send invoice to buyer by email one-click ([#1353](https://github.com/openlinker-project/openlinker/issues/1353)) ([#1358](https://github.com/openlinker-project/openlinker/issues/1358)) ([24feddc](https://github.com/openlinker-project/openlinker/commit/24feddc630cd585e48b182b9cbaa4d6cddb4dca6))
* **inpost:** close shipping adapter feature gaps ([#1540](https://github.com/openlinker-project/openlinker/issues/1540)) ([#1545](https://github.com/openlinker-project/openlinker/issues/1545)) ([ef94b44](https://github.com/openlinker-project/openlinker/commit/ef94b4496b125a8c33614adab2529be001679b39))
* **inpost:** model locker (paczkomat) COD in the ShipX adapter ([#1693](https://github.com/openlinker-project/openlinker/issues/1693)) ([ac95491](https://github.com/openlinker-project/openlinker/commit/ac9549111e46ced7b3709bfa5a9ef3d648fd1111))
* **integrations:** validate masterCatalogConnectionId shape on WooCommerce + Erli config ([#1505](https://github.com/openlinker-project/openlinker/issues/1505)) ([c814eae](https://github.com/openlinker-project/openlinker/commit/c814eae8316ece4f034a23205e2dfb657ef39b40))
* **invoicing:** add outbound PaymentMarker capability for inFakt ([#1362](https://github.com/openlinker-project/openlinker/issues/1362)) ([#1475](https://github.com/openlinker-project/openlinker/issues/1475)) ([cff0c94](https://github.com/openlinker-project/openlinker/commit/cff0c947c204d8062f57fb0822c7cf89ddc1fbcb))
* **invoicing:** bulk-issue invoices from the list ([#1355](https://github.com/openlinker-project/openlinker/issues/1355)) ([#1359](https://github.com/openlinker-project/openlinker/issues/1359)) ([c09ae86](https://github.com/openlinker-project/openlinker/commit/c09ae8655a56c0679dfc1125f1aff9f4411cd779))
* **invoicing:** inFakt epic - invoice shipping line + label wiring + webhook integration test ([#1567](https://github.com/openlinker-project/openlinker/issues/1567)) ([0452561](https://github.com/openlinker-project/openlinker/commit/045256160ec7d5381d944035ea6ee477fb15fb46))
* **invoicing:** invoice numbering series module ([#1527](https://github.com/openlinker-project/openlinker/issues/1527)) ([#1684](https://github.com/openlinker-project/openlinker/issues/1684)) ([35f770c](https://github.com/openlinker-project/openlinker/commit/35f770c0c85c9962470b66fce47f81d69a5894ff))
* **invoicing:** invoice-numbering follow-ups - routing axes, daily/fiscal-year, oświadczenie ([#1686](https://github.com/openlinker-project/openlinker/issues/1686)) ([#1697](https://github.com/openlinker-project/openlinker/issues/1697)) ([1f51e93](https://github.com/openlinker-project/openlinker/commit/1f51e934eabeb307fccce2786bed934fefde780a))
* **ksef:** emit P_6 / P_8A / P_9A in FA(3) documents ([#1529](https://github.com/openlinker-project/openlinker/issues/1529)) ([139bab9](https://github.com/openlinker-project/openlinker/commit/139bab982d411a3273310c403bf65159edf454e5))
* **ksef:** implement Test connection via the real auth handshake ([#1448](https://github.com/openlinker-project/openlinker/issues/1448)) ([8575253](https://github.com/openlinker-project/openlinker/commit/8575253ba249dc3816f7dea7a3cb6cd455b9902a)), closes [#1447](https://github.com/openlinker-project/openlinker/issues/1447)
* **listings,allegro,erli:** default marketplace-required condition on offer creation ([#1507](https://github.com/openlinker-project/openlinker/issues/1507)) ([c4bc789](https://github.com/openlinker-project/openlinker/commit/c4bc789f51c0bbf7e5df3846f3d71bb70b53def9))
* **listings,erli,web:** operator-selectable responsible producer on offer create ([#1531](https://github.com/openlinker-project/openlinker/issues/1531)) ([#1533](https://github.com/openlinker-project/openlinker/issues/1533)) ([007a855](https://github.com/openlinker-project/openlinker/commit/007a855fad2ef6cc519d782d80edf075f25d12de))
* **listings:** expose filled parameter values and productSet linkage in MarketplaceOffer ([#1483](https://github.com/openlinker-project/openlinker/issues/1483)) ([3848e24](https://github.com/openlinker-project/openlinker/commit/3848e2462db19a3cad9c7e0b4f50600a76309cdc)), closes [#1482](https://github.com/openlinker-project/openlinker/issues/1482)
* **listings:** let a demo viewer reach step 4 (Confirm) of the bulk-create offer wizard ([9ba89ef](https://github.com/openlinker-project/openlinker/commit/9ba89efb4c0d189f7798670afb6d22c6e5574515))
* **listings:** redesign publish-to-shop dialog and make batch stock/price per-product ([#1422](https://github.com/openlinker-project/openlinker/issues/1422)) ([1901508](https://github.com/openlinker-project/openlinker/commit/19015083ce4c9f0532e2a5c56885cb06f2a28529)), closes [#1414](https://github.com/openlinker-project/openlinker/issues/1414)
* **prestashop:** implement getProductCategories on ProductMaster adapter ([#1506](https://github.com/openlinker-project/openlinker/issues/1506)) ([0b1ef42](https://github.com/openlinker-project/openlinker/commit/0b1ef42facba1c632d260969b8679de0d73326b3))
* **shipping:** distinguish InPost paczkomat (APM) from PaczkoPunkt (POP) via point type ([#1434](https://github.com/openlinker-project/openlinker/issues/1434)) ([db18cbd](https://github.com/openlinker-project/openlinker/commit/db18cbd619b62fffeca83da2c6b961e877f17490))
* **shipping:** redesign the order-detail shipment panel across all states ([#1429](https://github.com/openlinker-project/openlinker/issues/1429)) ([c81cf5f](https://github.com/openlinker-project/openlinker/commit/c81cf5fd77f20ed736f12bf4bebd3e24dc1f40c3))
* **shipping:** source COD amount from Allegro and gate cash-on-delivery on payment status ([#1436](https://github.com/openlinker-project/openlinker/issues/1436)) ([5ed108a](https://github.com/openlinker-project/openlinker/commit/5ed108af58f62c26d0b92f3bd65f37cbd9d2a259))
* **shipping:** surface carrier-rejection details in the log and 502 body ([#1431](https://github.com/openlinker-project/openlinker/issues/1431)) ([2434b7c](https://github.com/openlinker-project/openlinker/commit/2434b7cc0e4c68cbd7fb8bdf63846225bd591253))
* **users:** enforce case-insensitive unique email on registration ([9ba89ef](https://github.com/openlinker-project/openlinker/commit/9ba89efb4c0d189f7798670afb6d22c6e5574515))
* **web,api:** connection Config tab visible to demo viewers, read-only ([9ba89ef](https://github.com/openlinker-project/openlinker/commit/9ba89efb4c0d189f7798670afb6d22c6e5574515))
* **web,api:** dashboard Infrastructure panel lists every infra-bearing connection ([9ba89ef](https://github.com/openlinker-project/openlinker/commit/9ba89efb4c0d189f7798670afb6d22c6e5574515))
* **web,api:** design pass on confirm-email page + HTML confirmation email template ([9ba89ef](https://github.com/openlinker-project/openlinker/commit/9ba89efb4c0d189f7798670afb6d22c6e5574515))
* **web,api:** show a clear permission error when a demo viewer issues an invoice ([9ba89ef](https://github.com/openlinker-project/openlinker/commit/9ba89efb4c0d189f7798670afb6d22c6e5574515))
* **web,erli:** add dedicated Callback URL field to Erli's edit-connection form ([#1459](https://github.com/openlinker-project/openlinker/issues/1459)) ([49ba486](https://github.com/openlinker-project/openlinker/commit/49ba4862c1290cef534093c359f3da144876120f)), closes [#1458](https://github.com/openlinker-project/openlinker/issues/1458)
* **web/ksef:** rebuild FA(3) preview to mirror the official KSeF visualization ([#1528](https://github.com/openlinker-project/openlinker/issues/1528)) ([4f30355](https://github.com/openlinker-project/openlinker/commit/4f3035525af2d17e37ffcdabf76faab3cfe59f30))
* **web:** connection Actions tab visible to demo viewers, write submit disabled ([9ba89ef](https://github.com/openlinker-project/openlinker/commit/9ba89efb4c0d189f7798670afb6d22c6e5574515))
* **web:** mailer/SMTP settings tile + edit modal on /settings ([9ba89ef](https://github.com/openlinker-project/openlinker/commit/9ba89efb4c0d189f7798670afb6d22c6e5574515))
* **web:** orders items preview + fix page-section overflow at narrow widths ([9ba89ef](https://github.com/openlinker-project/openlinker/commit/9ba89efb4c0d189f7798670afb6d22c6e5574515))
* **web:** polish order invoice-generation panel layout ([9ba89ef](https://github.com/openlinker-project/openlinker/commit/9ba89efb4c0d189f7798670afb6d22c6e5574515))
* **web:** redesign order-detail Invoice panel to match Shipment panel ([#1484](https://github.com/openlinker-project/openlinker/issues/1484)) ([b27be04](https://github.com/openlinker-project/openlinker/commit/b27be0433a16291b0ea8709ec49de9abc80c6931)), closes [#1449](https://github.com/openlinker-project/openlinker/issues/1449)
* **web:** redesign product detail page with gallery, KPIs and inline listings ([#1537](https://github.com/openlinker-project/openlinker/issues/1537)) ([54b9277](https://github.com/openlinker-project/openlinker/commit/54b92777c007e84e8a952b7e2dc0a3526f08f6c9))
* **web:** responsive orders table with expandable rows and mobile cards ([9ba89ef](https://github.com/openlinker-project/openlinker/commit/9ba89efb4c0d189f7798670afb6d22c6e5574515))
* **web:** surface the selected carrier in orders list and detail ([9ba89ef](https://github.com/openlinker-project/openlinker/commit/9ba89efb4c0d189f7798670afb6d22c6e5574515))
* **web:** unify Invoice Detail Page with OrderInvoicePanel redesign ([#1514](https://github.com/openlinker-project/openlinker/issues/1514)) ([921c088](https://github.com/openlinker-project/openlinker/commit/921c088cf3028a0857103de2360d2f2faa1e9fb4)), closes [#1462](https://github.com/openlinker-project/openlinker/issues/1462)
* **woocommerce:** add inbound webhook decoder (InboundWebhookDecoderPort, ADR-021) ([#1696](https://github.com/openlinker-project/openlinker/issues/1696)) ([bf1d1cd](https://github.com/openlinker-project/openlinker/commit/bf1d1cdcc908ff2ae14350b27385e1f0c11fcfdc))
* **woocommerce:** propagate inventory to published products (OfferManager stock write-back) ([#1508](https://github.com/openlinker-project/openlinker/issues/1508)) ([3a896fd](https://github.com/openlinker-project/openlinker/commit/3a896fde6413feffb450c175270a5e63a4a1a76b))


### Bug Fixes

* **allegro,web:** advertise OfferManager sub-capabilities so bulk wizard shows Allegro category params ([#1370](https://github.com/openlinker-project/openlinker/issues/1370)) ([668717a](https://github.com/openlinker-project/openlinker/commit/668717acb119984e810da784fb6bbeae132c2966)), closes [#1367](https://github.com/openlinker-project/openlinker/issues/1367)
* **allegro:** detect order cancellation in getOrder (status + fulfillment.status) ([#1461](https://github.com/openlinker-project/openlinker/issues/1461)) ([2d8be18](https://github.com/openlinker-project/openlinker/commit/2d8be18629c40649c99d0088d53dd7a3a75c3ece)), closes [#1460](https://github.com/openlinker-project/openlinker/issues/1460)
* **api:** allow demo viewer to read connection diagnostics ([9ba89ef](https://github.com/openlinker-project/openlinker/commit/9ba89efb4c0d189f7798670afb6d22c6e5574515))
* **api:** let demo viewer read mapping options and configuration ([9ba89ef](https://github.com/openlinker-project/openlinker/commit/9ba89efb4c0d189f7798670afb6d22c6e5574515))
* **api:** raise default demo registration rate limit from 5 to 100 per hour ([9ba89ef](https://github.com/openlinker-project/openlinker/commit/9ba89efb4c0d189f7798670afb6d22c6e5574515))
* **auth:** scope refresh cookie to versioned /v1/auth path ([#1340](https://github.com/openlinker-project/openlinker/issues/1340)) ([5dad02c](https://github.com/openlinker-project/openlinker/commit/5dad02c300410c2771afd8ec8757192706fe6677)), closes [#1327](https://github.com/openlinker-project/openlinker/issues/1327)
* **ci:** resolve migration timestamp collision and flaky connection-form test ([#1699](https://github.com/openlinker-project/openlinker/issues/1699)) ([0121d19](https://github.com/openlinker-project/openlinker/commit/0121d1954268792378b1bf8804deedf30a64333f)), closes [#1698](https://github.com/openlinker-project/openlinker/issues/1698)
* **core:** propagate master-side product/variant deletion ([#1599](https://github.com/openlinker-project/openlinker/issues/1599)) ([#1676](https://github.com/openlinker-project/openlinker/issues/1676)) ([c2d9111](https://github.com/openlinker-project/openlinker/commit/c2d9111639597298f5a4fd06a8dfb9c43b626e26))
* **demo:** boot WooCommerce with pnpm demo:up and fix its permanently-unhealthy healthcheck ([#1397](https://github.com/openlinker-project/openlinker/issues/1397)) ([08dc88a](https://github.com/openlinker-project/openlinker/commit/08dc88a2815fe3cda35feefd9f178e1e1edc3bfe)), closes [#1395](https://github.com/openlinker-project/openlinker/issues/1395)
* **demo:** harden docker-compose port binding and add multi-instance parametrization ([#1402](https://github.com/openlinker-project/openlinker/issues/1402)) ([8b58024](https://github.com/openlinker-project/openlinker/commit/8b5802459d5b92821b5d29315db87f40455e1c97)), closes [#1400](https://github.com/openlinker-project/openlinker/issues/1400)
* **demo:** route WooCommerce through the proxy overlay with a scoped X-Forwarded-Proto trust fix ([#1421](https://github.com/openlinker-project/openlinker/issues/1421)) ([78c2d7d](https://github.com/openlinker-project/openlinker/commit/78c2d7dccef2f9d20237b3113c59ab5cc302b9f8))
* **demo:** set PRESTASHOP_BASE_URL for the dashboard health check ([#1420](https://github.com/openlinker-project/openlinker/issues/1420)) ([2c7d8b5](https://github.com/openlinker-project/openlinker/commit/2c7d8b5356c0d21b3904f5d6acdc7eea7d5bf3c4))
* **demo:** use curl instead of PHP file_get_contents for PrestaShop healthcheck ([#1393](https://github.com/openlinker-project/openlinker/issues/1393)) ([a964d8b](https://github.com/openlinker-project/openlinker/commit/a964d8bd993438cd055539d280a099767c86b886)), closes [#1392](https://github.com/openlinker-project/openlinker/issues/1392)
* **docker:** wire OL_DEMO_MODE + OL_REGISTRATION_ENABLED into the demo compose overlay ([#1504](https://github.com/openlinker-project/openlinker/issues/1504)) ([f87afc8](https://github.com/openlinker-project/openlinker/commit/f87afc8c07d3a2545a0b4fe1ac7f9efe70beb874))
* **erli,web:** reject inactive Allegro credential-reuse source, gate query on rotate panel ([#1466](https://github.com/openlinker-project/openlinker/issues/1466)) ([0664d1e](https://github.com/openlinker-project/openlinker/commit/0664d1ec35f61ba7c6b831f391a6259d3a3e3c63)), closes [#1465](https://github.com/openlinker-project/openlinker/issues/1465)
* **erli:** map buyer-selected pickup point onto neutral IncomingOrder ([#1519](https://github.com/openlinker-project/openlinker/issues/1519)) ([#1678](https://github.com/openlinker-project/openlinker/issues/1678)) ([a6e200a](https://github.com/openlinker-project/openlinker/commit/a6e200ad671b2ea936bf8e9ae54aa11a45d3f0d1))
* **erli:** sandbox auth, missing bulk category picker, and rejected dictionary attributes ([#1443](https://github.com/openlinker-project/openlinker/issues/1443)) ([a2c9442](https://github.com/openlinker-project/openlinker/commit/a2c9442c7de6446897664f42badaaa380b37626a)), closes [#1440](https://github.com/openlinker-project/openlinker/issues/1440)
* **erli:** stop the inbox poll starving on productsNeedSync events ([#1453](https://github.com/openlinker-project/openlinker/issues/1453)) ([c148ab5](https://github.com/openlinker-project/openlinker/commit/c148ab5a13bd0a301939d8ba1f9affc39a89a537)), closes [#1452](https://github.com/openlinker-project/openlinker/issues/1452)
* **infakt:** issue corrections via the dedicated corrective_invoices endpoint ([#1342](https://github.com/openlinker-project/openlinker/issues/1342)) ([b8984ed](https://github.com/openlinker-project/openlinker/commit/b8984ed33867dfb349865a4282bc07e7a2cfc0fc))
* **infakt:** parse inFakt v3 list envelope as items/pagination, not entities/metainfo ([#1374](https://github.com/openlinker-project/openlinker/issues/1374)) ([0c9ef39](https://github.com/openlinker-project/openlinker/commit/0c9ef390f1a02bd0e8fd01505dabae7cfbf5649c))
* **infra:** pass WEB_URL through to the api container in demo compose ([9ba89ef](https://github.com/openlinker-project/openlinker/commit/9ba89efb4c0d189f7798670afb6d22c6e5574515))
* **inventory:** prune stale inventory_items for variants deleted at the master ([#1495](https://github.com/openlinker-project/openlinker/issues/1495)) ([6d2ceaf](https://github.com/openlinker-project/openlinker/commit/6d2ceaf7284ce5ddb26b6761acc46069bd98eb08)), closes [#1478](https://github.com/openlinker-project/openlinker/issues/1478)
* **invoicing:** convert invoice_records timezone-naive timestamps to timestamptz ([#1389](https://github.com/openlinker-project/openlinker/issues/1389)) ([25b4a00](https://github.com/openlinker-project/openlinker/commit/25b4a0037980ae158cde9e90d1984bd79edd5e3a))
* **invoicing:** stamp a distinct KSeF document number per correction ([#1451](https://github.com/openlinker-project/openlinker/issues/1451)) ([462085f](https://github.com/openlinker-project/openlinker/commit/462085f0c1b55645249870337cef42a794e62139))
* **ksef:** normalize and validate FA(3) KodKraju + map status 450 to rejected ([#1344](https://github.com/openlinker-project/openlinker/issues/1344)) ([2f49fb7](https://github.com/openlinker-project/openlinker/commit/2f49fb7358f751e8afb8e5a91e1ead6934b13096)), closes [#1343](https://github.com/openlinker-project/openlinker/issues/1343)
* **ksef:** persist FA(3) P_2 document number on the issued InvoiceRecord ([#1341](https://github.com/openlinker-project/openlinker/issues/1341)) ([46502f6](https://github.com/openlinker-project/openlinker/commit/46502f6b88e76c79ae7cd02151d0b2b2e2345dfa))
* **listings,woocommerce:** publish carries the variant SKU ([#1485](https://github.com/openlinker-project/openlinker/issues/1485)) ([#1494](https://github.com/openlinker-project/openlinker/issues/1494)) ([f1adf81](https://github.com/openlinker-project/openlinker/commit/f1adf8170b39542a93f54b2401b754e2d6188f3e))
* **listings:** allow shop-publish master-catalog config and tolerate missing category read ([#1418](https://github.com/openlinker-project/openlinker/issues/1418)) ([e776573](https://github.com/openlinker-project/openlinker/commit/e776573d723542f1a09f2fbe231d7f36c70a3888)), closes [#1413](https://github.com/openlinker-project/openlinker/issues/1413)
* **listings:** make bulk-wizard category resolve mapping-aware ([#1522](https://github.com/openlinker-project/openlinker/issues/1522)) ([#1523](https://github.com/openlinker-project/openlinker/issues/1523)) ([454a7c6](https://github.com/openlinker-project/openlinker/commit/454a7c64607b10c35ecc9068edb44301acb95795))
* **mappings:** grant operator write access to mapping configuration ([#1691](https://github.com/openlinker-project/openlinker/issues/1691)) ([512af83](https://github.com/openlinker-project/openlinker/commit/512af8350cc2f0c2a1740e0493cacbcf5158bb53))
* **prestashop-seed:** activate the PL country in the dev/demo shop ([#1467](https://github.com/openlinker-project/openlinker/issues/1467)) ([35b23ee](https://github.com/openlinker-project/openlinker/commit/35b23eea1197f7c729a4ac6397e74788d74316a9)), closes [#1446](https://github.com/openlinker-project/openlinker/issues/1446)
* **shipping:** add locker-size field to the generate-label form ([#1424](https://github.com/openlinker-project/openlinker/issues/1424)) ([38a01e2](https://github.com/openlinker-project/openlinker/commit/38a01e217bc3fa7871105fa4389b9252cb0a1fd1)), closes [#1423](https://github.com/openlinker-project/openlinker/issues/1423)
* **shipping:** backfill the InPost tracking number from getTracking ([#1430](https://github.com/openlinker-project/openlinker/issues/1430)) ([23742ca](https://github.com/openlinker-project/openlinker/commit/23742caca5fbb03639fe2bcea9b04241d50501ff)), closes [#1426](https://github.com/openlinker-project/openlinker/issues/1426)
* **shipping:** reject generate-label requests that omit parcel/recipient ([#1518](https://github.com/openlinker-project/openlinker/issues/1518)) ([#1679](https://github.com/openlinker-project/openlinker/issues/1679)) ([3509437](https://github.com/openlinker-project/openlinker/commit/3509437add5cf329d26aff68d15631702d589633))
* **shipping:** use parcel_locker sending method for InPost paczkomat shipments ([#1432](https://github.com/openlinker-project/openlinker/issues/1432)) ([67b43c2](https://github.com/openlinker-project/openlinker/commit/67b43c246a6224b68d8f1b744392400631adee1d)), closes [#1427](https://github.com/openlinker-project/openlinker/issues/1427)
* **subiekt:** rebase [#1324](https://github.com/openlinker-project/openlinker/issues/1324) onto main; address PR review findings ([#1335](https://github.com/openlinker-project/openlinker/issues/1335)) ([c89afbf](https://github.com/openlinker-project/openlinker/commit/c89afbfb29d60b3ed4b07ea6492a62ff76868765))
* **sync:** gate platformType-scoped order-poll scheduler tasks by capability ([#1455](https://github.com/openlinker-project/openlinker/issues/1455)) ([e9ee757](https://github.com/openlinker-project/openlinker/commit/e9ee757448fc36a554abf118522f234683cd71cc)), closes [#1454](https://github.com/openlinker-project/openlinker/issues/1454)
* **web:** add spacing under section titles ([9ba89ef](https://github.com/openlinker-project/openlinker/commit/9ba89efb4c0d189f7798670afb6d22c6e5574515))
* **web:** add variant picker to WooCommerce publish-to-shop wizard ([#1391](https://github.com/openlinker-project/openlinker/issues/1391)) ([6102b24](https://github.com/openlinker-project/openlinker/commit/6102b244b7017fa28228e3687240262d9e621a3f)), closes [#1390](https://github.com/openlinker-project/openlinker/issues/1390)
* **web:** correct InPost webhook runbook URL, self-service copy, and HMAC secret step ([#1477](https://github.com/openlinker-project/openlinker/issues/1477)) ([73add2f](https://github.com/openlinker-project/openlinker/commit/73add2ff1abce605d5f3a8cec54edd1763727a4f)), closes [#1473](https://github.com/openlinker-project/openlinker/issues/1473)
* **web:** dialog overflow/blur, toast z-index, and master stock/price prefill in WooCommerce publish wizard ([#1442](https://github.com/openlinker-project/openlinker/issues/1442)) ([3981c55](https://github.com/openlinker-project/openlinker/commit/3981c553e2db6aada2cd81186df833ad0cb0e747)), closes [#1439](https://github.com/openlinker-project/openlinker/issues/1439)
* **web:** fix bulk-dispatch dialog gap caused by order-id text-wrap explosion ([9ba89ef](https://github.com/openlinker-project/openlinker/commit/9ba89efb4c0d189f7798670afb6d22c6e5574515))
* **web:** fix orders filter bar overflow on mobile widths ([9ba89ef](https://github.com/openlinker-project/openlinker/commit/9ba89efb4c0d189f7798670afb6d22c6e5574515))
* **web:** gate trigger-sync jobs by capability, add invoicing reconcile trigger ([#1476](https://github.com/openlinker-project/openlinker/issues/1476)) ([d2deab6](https://github.com/openlinker-project/openlinker/commit/d2deab63a9c6cb069af4a3f10e6c3c6382a63b68)), closes [#1474](https://github.com/openlinker-project/openlinker/issues/1474)
* **web:** hide demo-mode banner from admin/operator sessions ([#1470](https://github.com/openlinker-project/openlinker/issues/1470)) ([cac8c5e](https://github.com/openlinker-project/openlinker/commit/cac8c5eef126b4ca39ed6d0a63d7a344be6ec52c)), closes [#1468](https://github.com/openlinker-project/openlinker/issues/1468)
* **webhooks:** resolve downstream-job link to the concrete SyncJob ([#1366](https://github.com/openlinker-project/openlinker/issues/1366) ([#1378](https://github.com/openlinker-project/openlinker/issues/1378)) ([cfd0c15](https://github.com/openlinker-project/openlinker/commit/cfd0c15136c63a5d542df2fe9084314e337b892b))
* **web:** keep demo-mode banner sticky while scrolling ([9ba89ef](https://github.com/openlinker-project/openlinker/commit/9ba89efb4c0d189f7798670afb6d22c6e5574515))
* **web:** restore contrast and fix layout overflow in marketplace picker modal ([#1463](https://github.com/openlinker-project/openlinker/issues/1463)) ([51faa47](https://github.com/openlinker-project/openlinker/commit/51faa473e2d140da0324605573d43bccd4852218)), closes [#1438](https://github.com/openlinker-project/openlinker/issues/1438)
* **web:** show AI-suggest/generate-description to demo viewer, block invoke ([9ba89ef](https://github.com/openlinker-project/openlinker/commit/9ba89efb4c0d189f7798670afb6d22c6e5574515))
* **web:** show Create offer / Publish to shop to demo viewer, block only final submit ([9ba89ef](https://github.com/openlinker-project/openlinker/commit/9ba89efb4c0d189f7798670afb6d22c6e5574515))
* **web:** show New connection / Retry to demo viewer, block only writes ([9ba89ef](https://github.com/openlinker-project/openlinker/commit/9ba89efb4c0d189f7798670afb6d22c6e5574515))
* **web:** stop EditConnectionForm's Save changes from clobbering a sibling panel's just-saved config field ([#1445](https://github.com/openlinker-project/openlinker/issues/1445)) ([cc004ed](https://github.com/openlinker-project/openlinker/commit/cc004ed81b0c0eaf1ea51dc3ceb376104901c87c)), closes [#1441](https://github.com/openlinker-project/openlinker/issues/1441)
* **web:** stop mobile order cards overlapping badges with the id/copy button ([9ba89ef](https://github.com/openlinker-project/openlinker/commit/9ba89efb4c0d189f7798670afb6d22c6e5574515))

## [0.1.0]

First tracked release — the baseline snapshot of OpenLinker as a self-hosted,
API-first, pluggable e-commerce orchestration platform: sync products, inventory,
listings, and orders between your own shop and the marketplaces you sell on.

### Platform & architecture

- **Hexagonal core** (ports & adapters) organised into bounded contexts —
  products, inventory, orders, customers, listings/offers, invoicing, content,
  AI, sync, shipping — with a strict CORE ↔ integration boundary.
- **Capability ports** so a new platform is *new implementations, not core
  changes*: `ProductMasterPort`, `InventoryMasterPort`, `OrderSourcePort`,
  `OrderProcessorManagerPort`, `OfferManagerPort`, `InvoicingPort`,
  `ShippingProviderManagerPort`, each with composable sub-capabilities.
- **Plugin SDK** (`@openlinker/plugin-sdk`) — framework-neutral adapter-plugin
  contract, per-connection adapter resolution, and self-registering capability /
  connection-test / webhook-provisioning / validator registries.
- **Identifier mapping** from a single unified seed (`ol_product_*`, `ol_order_*`,
  `ol_variant_*`, …) so core logic works in internal IDs regardless of source.
- **Multi-connection per platform type** (e.g. two PrestaShop stores from one
  instance), encrypted credentials store, and PII-aware storage (full or
  hash-only).

### HTTP API

- Versioned REST API under **`/v1`** (URI versioning) with a runtime version
  surface at `GET /v1/health` reporting the product + API version.
- JWT auth with refresh-token rotation, role-based authorization
  (admin / operator / viewer), and self-service registration + admin approval.
- Inbound webhook ingestion with HMAC verification, replay protection, and
  Postgres-authoritative dedup.

### Core workflows

- **Order sync** — cursor-based ingestion from marketplaces *and* shops, unified
  order model, destination order creation with auto-provisioned guest customers,
  status lifecycle, cancellations/returns, and order-status writeback (ADR-027).
- **Inventory sync** — variant-keyed master stock propagated to marketplace
  offers, including per-combination stock for multi-variant products.
- **Listings / offers** — offer creation, quantity + field updates, category &
  attribute projection across platforms, seller-policy discovery, offer-status
  snapshots, and a bulk offer-creation flow.
- **Invoicing** — country-agnostic `InvoicingPort` (issue / clear / correct
  fiscal documents), with a browser-based invoice detail + correction surface.
- **Content + AI** — per-channel product content with draft write-through and
  provider-agnostic AI description suggestions (Anthropic, OpenAI) plus editable,
  versioned prompt templates.
- **Shipping / dispatch** — neutral delivery intent, label generation, pickup
  points, tracking, and shipment-status sync.
- **Customer identity resolution** — multi-origin identity with optional
  email-fallback and address reuse.
- **Sync-job orchestration** — scheduled + webhook-triggered jobs with retry
  classification and a status-vs-outcome split.

### Integrations

Shops:

- **PrestaShop** (`prestashop.webservice.v1`) — full shop surface (catalog +
  inventory reads, order ingestion via `date_upd`, order creation, lifecycle,
  cancellations, returns); ships the OL Dynamic Carrier module so marketplace
  buyer-paid shipping round-trips correctly.
- **WooCommerce** (`woocommerce.restapi.v3`) — source + destination + inventory.

Marketplaces:

- **Allegro** (`allegro.publicapi.v1`) — order ingestion via the event journal,
  the full `OfferManager` sub-capability set, OAuth with refresh-on-401, and
  masked-buyer-email normalization.
- **Erli** (`erli.shopapi.v1`) — offers + order source, reconciliation-first
  posture, borrowing Allegro-id taxonomy.

Invoicing:

- **Subiekt nexo** (`subiekt.invoicing.v1`) — first `InvoicingPort` adapter, via
  the Sfera bridge.
- **KSeF** (`ksef.publicapi.v2`) — Polish national e-invoicing (FA(3) issue +
  clear + KOR corrections through the async submit → poll → UPO model).
- **inFakt** (`infakt.accounting.v1`) — accounting/invoicing with KSeF
  indirection and read-back of clearance status.

Shipping:

- **InPost** (`inpost.shipx.v1`) — ShipX (paczkomat + courier), labels, webhooks.
- **DPD Polska** (`dpd.polska.rest.v1`) — REST labels + protocols, SOAP tracking.

Content:

- **AI router** (Anthropic, OpenAI) — content-suggestion completions behind a
  provider-agnostic `AiCompletionPort`.

### Frontend

- Browser-first admin SPA (React + TypeScript + Vite + TanStack Query) — an
  operator cockpit for connections, orders, products, inventory, listings,
  invoices, jobs & logs, webhooks, and cursors, with a build-time plugin registry
  for per-platform UI.

### Ops & docs

- Real integration tests against Postgres/Redis (and a real PrestaShop install)
  via Testcontainers; TypeORM migrations as the schema source of truth.
- Architecture Decision Records, per-context engineering standards, and
  per-integration setup guides.

<!-- This link goes live when the maintainer cuts the one-time v0.1.0 tag —
     see RELEASING.md § Cutting the first tag. Until then it intentionally 404s. -->
[0.1.0]: https://github.com/openlinker-project/openlinker/releases/tag/v0.1.0
