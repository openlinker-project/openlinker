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
