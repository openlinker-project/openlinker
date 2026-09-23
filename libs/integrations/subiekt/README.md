# @openlinker/integrations-subiekt

Subiekt GT (InsERT GT) integration for OpenLinker. This document says what the
integration does and, just as importantly, what it deliberately does not do -
read it before you connect a real installation, because several of the "does
not" items change what an operator should expect on day one.

## What it is

OpenLinker never talks to Subiekt directly. A Windows-only companion process,
the **Subiekt Bridge** (`GtBridge.exe`), runs on the same machine as Subiekt GT
and drives it two ways: through the classic **Sfera GT** COM automation API
(COM ProgID `InsERT.GT` - not the newer .NET "Sfera SDK" that targets the
unrelated Subiekt nexo product line), and, for reads that Sfera has no
call for, directly against the Subiekt SQL Server database. OpenLinker talks
to the bridge over HTTPS.

```
OpenLinker  ->  HTTPS + Bearer  ->  Subiekt Bridge  ->  Sfera GT (COM) / SQL  ->  Subiekt GT
```

The bridge must run on the Subiekt GT machine because COM automation is
apartment-bound - a Sfera object can only be called from the thread that
created it. The bridge honours this by running every Sfera call through one
dedicated STA (single-threaded apartment) worker thread with an internal work
queue, so requests are serialized rather than run concurrently. That is a
property of Sfera, not a bridge shortcut: driving Subiekt through Sfera from
several threads at once is not a supported way to use the API.

Registered capabilities: `ProductMaster`, `InventoryMaster`,
`OrderProcessorManager`, `Invoicing`, `OrderSource`.

`Fiscalization` is deliberately NOT among them. The bridge carries
fiscalization endpoints, but they have never been compiled against, or run
with, a real fiscal printer - so the capability is withheld from the manifest
rather than advertised on the strength of untested code. A capability name
enters the manifest together with the adapter that has been shown to deliver
it. See
[docs/fiscalization-not-live-verified.md](./docs/fiscalization-not-live-verified.md).

## What works

**Catalogue read** (`ProductMaster`). Symbol, name, description, unit of
measure, weight, net and gross sale price, currency, EAN/barcode, VAT rate,
product images, and the towar's group.

- VAT rate is a percent-as-string (`"23"`, `"8"`, ...), and reads `null` when
  the towar carries no rate assignment in Subiekt at all - that is genuinely
  different from a real 0% rate, and callers must not conflate the two.
- Images are read from Subiekt's own `tw_ZdjecieTw` blobs and served back by
  the bridge over HTTP, so OpenLinker never needs direct SQL or file-share
  access to the images.

**Stock read** (`InventoryMaster`), from `tw_Stan`, for one release warehouse
per towar. See the multi-warehouse note below - this is the one place where
getting the configuration wrong has a real consequence.

**Stock adjustment**, by PW (positive delta) / RW (negative delta) documents,
with an optional idempotency key so a retried adjustment does not double-move
stock.

**Order push** (`OrderProcessorManager`). A ZK (zamowienie od klienta,
customer order) is created with the buyer-paid marketplace price, the source
currency, and the buyer as a kontrahent. The OL order id is stamped onto
`dok_NrPelnyOryg` as an idempotency key, so a retried `createOrder` call
returns the original document instead of minting a second one.

**Fiscal documents** (`Invoicing`). FS (faktura) when the buyer has a Polish
tax id, PA (paragon) when they do not. Every line is linked to the real
Subiekt catalogue (`SuPozycje.Dodaj(symbol)`) whenever the product is mapped,
so a normal sale moves warehouse stock through the document itself.

**Warehouse release**. When the sales document does not itself carry the
stock movement (`dok_JestRuchMag` is false), the bridge additionally issues a
WZ (Wydanie Zewnetrzne) so stock leaves the warehouse exactly once - never
zero times, and never twice.

**Corrections**. Faktura korygujaca against an already-issued FS.

**Buyer country**. Written to `adr__Ewid.adr_IdPanstwo`, resolved from
ISO-3166-1 alpha-2 against Subiekt's own `sl_Panstwo` dictionary.

## What it deliberately does not do

Each of these is a design decision, not a gap waiting to be filled - know the
reason before you ask for the feature.

1. **Product variants.** Subiekt GT has no variant axis: every variant a
   product might have is its own separate towar with its own symbol. There is
   nothing in the Subiekt data model to map OpenLinker's product/variant split
   onto. Each towar therefore becomes one OpenLinker product with a single
   synthetic variant, and `upsertProductVariant` fails honestly rather than
   silently pretending to write a variant that has no home in Subiekt.

2. **Net-priced (VAT-exclusive) orders.** This is a core OpenLinker policy,
   not a Subiekt limitation: OpenLinker never computes tax, and per ADR-026 it
   permanently refuses to issue a fiscal document for an order whose prices
   are net. The VAT rate belongs to the product and arrives from the
   ProductMaster at import time. A sales channel that reports net prices
   cannot produce a Subiekt document through OpenLinker - that channel's
   prices need to be gross before the order reaches this integration.

3. **Writing categories back.** `assignCategories` refuses. Nothing in
   OpenLinker's category-mapping flow needs to WRITE a Subiekt group - mapping
   only needs to READ which group a towar is already in. Accepting the write
   would move a towar between the operator's own groups on the strength of a
   mapping that was authored for a marketplace's taxonomy, which is not a
   decision this integration is entitled to make on the operator's behalf.

4. **Rewriting an existing kontrahent.** `EnsureKontrahent` returns an
   existing kontrahent untouched rather than updating it. Re-saving a
   kontrahent through Sfera raises a modal confirmation dialog inside
   Subiekt's own UI, and because the bridge drives Subiekt headlessly there is
   nobody there to click it - the COM call would simply block forever. Beyond
   that mechanical reason, an integration has no business silently rewriting
   a record the operator owns. The practical consequence: address and country
   corrections only land on newly created kontrahents, never on ones that
   already existed in Subiekt before the order arrived.

5. **Inventory reservations.** Sfera GT exposes no hold primitive - there is
   no way to tell Subiekt "keep N units aside without moving them yet."
   OpenLinker does not try to invent one against this integration; it keeps
   its own advisory reservation ledger instead (ADR-061), which is the same
   mechanism used for every master that has no reservation concept of its own.

6. **Choosing a warehouse is an operator decision, not something this
   integration guesses well.** Stock is published for exactly one warehouse
   (magazyn), never summed across every magazyn the towar has a position in -
   summing would advertise units that can never actually ship from a single
   sale, since a sale only ever leaves stock from one warehouse. The
   precedence is: the connection's configured warehouse if set, otherwise a
   fallback (the lowest-numbered magazyn holding stock for that towar). That
   fallback is a guess, not something Subiekt tells the bridge a future sale
   will actually leave from, and it is logged as a guess. On an installation
   with only one magazyn the two coincide and nothing needs to be done. **On
   an installation with more than one magazyn, configure the warehouse
   explicitly** - leaving it unset means every stock figure OpenLinker
   publishes is a guess about which shelf the goods will come off. Naming a
   warehouse the towar has no stock position in is refused outright rather
   than silently publishing zero, because a zero from a master is
   authoritative elsewhere in OpenLinker and would deactivate that product's
   offers on every connected channel.

7. **Category hierarchy.** Subiekt's `sl_GrupaTw` is a flat list with no
   parent column, so a Subiekt category carries no `parentId` and no `depth`
   in OpenLinker either. That is a fact about how Subiekt stores its groups,
   not something the mapping layer left out.

8. **A document line whose product has no Subiekt mapping still gets issued -
   as a free-text line, not a real one.** When a product cannot be resolved
   to a Subiekt towar, the line is written as a free-text "usluga
   jednorazowa" (one-off service) rather than blocking the whole document.
   The document itself looks correct and is legally valid, but a free-text
   line carries no towar, so no warehouse document can release stock against
   it: the goods leave the building and the stock figure in Subiekt does not
   move. OpenLinker reports this per document so it is not a silent gap - it
   is visible as an unmapped-lines count on the invoice record and as a badge
   on the order - but the remedy is manual: map the product, then correct the
   stock in Subiekt by hand.

## Configuration

Connection config keys: `bridgeBaseUrl`, `timeoutMs`, `stockMagazynId`,
`defaultPaymentMethod`, `bankAccountId`, `defaultStanowiskoKasoweId`,
`drukarkaFiskalnaId`.

Bridge-side configuration lives in `BridgeConfig`, resolved per key with the
same precedence for every setting: an `OL_BRIDGE_*` environment variable,
then an `appsettings.json` placed next to the .exe, then a compiled-in
default - so a bridge with no `appsettings.json` at all behaves exactly as it
did before that file existed. See
[`docs/appsettings.example.json`](./docs/appsettings.example.json) for the
full key list and an env-var naming example. The keys: `SqlServer`,
`SqlDatabase`, `SqlConnectionString` (overrides the previous two entirely, for
an installation that needs SQL authentication instead of integrated
security), `SferaOperator`, `SferaPassword`, `ApiUser`, `ApiPassword`,
`InvoiceToken`, `CertificatePath`, `CertificatePassword`, `HttpsPort`,
`HttpPort`, `PublicBase`.

The shipped defaults for `ApiUser`, `ApiPassword`, and `InvoiceToken` are a
public development sandbox's own credentials. **Change all three on any
installation reachable beyond localhost** - they guard every route the bridge
exposes and are not a secret on any machine but the one they were generated
for.

## Operating notes

- The bridge sources are mirrored into this package under
  `docs/*.cs.ready` as full read-only dumps, kept here for review. They are
  **not** compiled by this repository's CI - there is no C# build here, and
  a change to a `.cs.ready` file has no effect until someone builds and
  redeploys it to the actual bridge machine by hand.

- A cold Sfera attach was measured at roughly 81 seconds - well past
  OpenLinker's 30-second HTTP timeout. That is why the bridge attaches to
  Sfera once at process startup rather than on the first incoming request:
  attaching lazily would mean the first real request after every bridge
  restart times out.

- Shipments: a label generated in OpenLinker stays in the `generated` state
  until the parcel is actually handed to the carrier. That is correct
  behaviour, not a stall - the carrier itself only reports the label as
  confirmed at that point, and relaying the waybill any earlier would tell
  the marketplace the order shipped before it did. In the meantime the order
  reads `dispatched` in OpenLinker's own rollup, because that value means
  "fulfilment is in progress," not "the parcel has left the building."

## Documentation

- **Operator tutorial** - [docs/tutorial.md](./docs/tutorial.md) - a complete
  end-to-end setup guide with screenshots.
- **Developer setup guide** - [docs/setup-guide.md](./docs/setup-guide.md)
- **Operations runbook** - [docs/runbook.md](./docs/runbook.md)
- **Warehouse release (WZ) mechanics** -
  [docs/warehouse-release-wz.md](./docs/warehouse-release-wz.md)
- **Fiscalization capability status** -
  [docs/fiscalization-not-live-verified.md](./docs/fiscalization-not-live-verified.md)
