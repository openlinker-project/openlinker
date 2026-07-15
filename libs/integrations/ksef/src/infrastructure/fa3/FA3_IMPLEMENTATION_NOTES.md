# FA(3) Implementation Notes

Architecture, mapping tables, and limitations for the FA(3) XML builder
(issue #1148 / C4). All FA(3)/KSeF/NIP/VAT specifics live in this package per
[ADR-026](../../../../../docs/architecture/adrs/026-country-agnostic-invoicing-domain.md);
no PL vocabulary leaks into `libs/core`.

## Architecture

```
IssueInvoiceCommand (neutral, core)
        │
        ▼
Fa3XmlBuilderAdapter            ← neutral→PL mapping seam (this package)
   │  resolveP12()              ← tax-rate mapper
   │  resolveBuyerIdentity()    ← Podmiot2 mapper
   │  resolveKodWaluty()        ← currency mapper
   ▼
Fa3BuilderInput (fully mapped, PL)
        │
        ▼
Fa3WithValidationBuilder (IFa3XmlBuilder)
   │  buildFa3Xml()             ← PURE: object tree → serializeXml (escaped)
   │  validateFa3Xml()          ← structural / well-formedness gate
   ▼
RawFa3Xml (validated)
```

- **Pure builder** (`fa3-xml.builder.ts`): synchronous, no I/O, no `Date.now()`,
  no credentials. Trivially testable with plain fixtures.
- **DOM serialisation** (`xml-dom.builder.ts`): `fast-xml-parser` `XMLBuilder`
  auto-escapes every text/attribute value — the builder NEVER hand-concats XML.
- **Validator** (`fa3-xsd.validator.ts`): structural + well-formedness only; see
  [`schema/SCHEMA_VALIDATION_STATUS.md`](./schema/SCHEMA_VALIDATION_STATUS.md).

## Document layout

| Section | Contents |
|---|---|
| `Naglowek` | `KodFormularza` (FA), `wersjaSchemy` (1-0E), namespace |
| `Podmiot1` | Seller NIP + name + address (from injected `SellerProfile`) |
| `Podmiot2` | Buyer identification choice (see Buyer ID resolution) |
| `Fa` | `KodWaluty`, P_13/P_14/P_15 aggregates, `Adnotacje` (order ref) |
| `FaWiersz` (×N) | One per line: name, quantity, unit price gross, `P_12` |
| `Platnosc` (optional, #1311) | Connection-level payment defaults, sibling of `FaWiersz` (see Payment section below) |

## P_12 tax-rate mapping (all 10 values)

| Neutral code(s) | FA(3) `P_12` | Net band | Meaning |
|---|---|---|---|
| `23` | `23` | P_13_1 (+P_14_1) | Standard rate 23% |
| `8` | `8` | P_13_2 (+P_14_2) | Reduced rate 8% |
| `5` | `5` | P_13_3 (+P_14_3) | Reduced rate 5% |
| `0-kr` | `0 KR` | P_13_6_1 | 0% domestic |
| `0-wdt` | `0 WDT` | P_13_6_2 | 0% intra-EU supply (WDT) |
| `0-ex` | `0 EX` | P_13_6_3 | 0% export |
| `exempt`, `zw` | `zw` | P_13_7 | Exempt |
| `reverse-charge`, `oo` | `oo` | P_13_10 | Reverse charge (odwrotne obciążenie) |
| `np-i` | `np I` | P_13_8 | Outside PL territory, general |
| `np-ii` | `np II` | P_13_9 | art. 100(1)(4) services taxed in buyer's EU state |

> **NOTE:** KSeF's `TStawkaPodatku` has NO bare `np` token — it splits
> "not applicable / outside scope" into two distinct tokens (`np I`, `np II`)
> that map to two distinct net-base elements (P_13_8 vs P_13_9). Emitting a
> bare `np` is rejected by the schema.

Unknown codes throw `UnmappedTaxRateException` (no silent default).

> **ACCEPTED LIMITATION (#1290):** core never supplies a real per-line tax
> rate today — `OrderItem` has none (core is country-agnostic, ADR-026), so
> `toIssueInvoiceCommand` always emits `taxRate: ''` on every line.
> `fa3-builder-input.mapper.ts`'s `mapLine` substitutes the connection's
> `SellerProfile.defaultTaxRate` (PL standard `23`% unless the connection
> configures otherwise via `KsefSellerConfig.defaultTaxRate`) for an empty
> `taxRate` *before* calling `resolveP12` — `resolveP12` itself is unchanged
> and still throws on a genuinely unmapped non-empty code. This is a flat
> per-connection default, not a real per-line VAT rate: an order mixing
> goods at different rates (23%/8%/0%) mis-taxes every line at the connection
> default *only when the source adapter did not report per-line rates*.
>
> **UPDATE (#1586 Phase 2):** `OrderItem` / `InvoiceLine` now carry an optional
> neutral per-line `taxRate` (ADR-035), and an order-source adapter that reports
> a genuine per-line rate populates it end-to-end. **PrestaShop** does so today —
> `PrestashopOrderSourceAdapter` derives the whole-percent rate from each
> `order_details` row's tax-inclusive/exclusive unit prices and maps it to the
> neutral vocabulary. A populated mixed-rate order now produces a correctly-split
> FA(3) band breakdown. ⏸ Deferred (documented follow-ups): **WooCommerce**
> (line_items expose only a `taxes`/`tax_class` delta, not a clean per-line rate —
> left on the flat-default fallback), plus Allegro/Erli.

> **OPEN:** the canonical neutral tax-rate code set (UNCL 5305 vs OpenLinker
> custom) is being settled upstream; the keys above are provisional and must be
> reconciled before C3 submission.

## Buyer ID resolution (`Podmiot2`, mutually exclusive)

1. `pl-nip` → `<NIP>` (10 digits, `NIP_PATTERN`).
2. `eu-vat` (and EU-VAT-shaped schemes) → `<KodUE>` + `<NrVatUE>` (`EU_VAT_PATTERN`).
3. Other foreign scheme → `<KodKraju>` (ISO 3166-1 alpha-2) + `<NrID>`.
4. `taxId === null` (B2C) → `<BrakID>1</BrakID>`.

Malformed identifiers throw `InvalidBuyerIdentificationException` (carries the
neutral scheme + reason only, never the raw value).

## Currency

ISO-4217 → `KodWaluty` against an allow-list (`PLN`/`EUR`/`USD`/`GBP`/`CZK` in
the skeleton). Unsupported currency throws `UnsupportedCurrencyException`.

## Encoding & escaping

- UTF-8 with XML declaration.
- All values escaped by `fast-xml-parser` at serialisation; spec coverage
  includes `<`, `>`, `&`, `"`, `'` in names/addresses.

## Logging / PII

The adapter logs structural facts only (connectionId, orderId, lineCount) via
the shared `Logger`. It NEVER logs buyer names, tax ids, or the raw XML.

## Correction invoices (KOR — #1151 / C7)

A correcting document (`documentType` `corrected`/`credit-note` carrying a neutral
`IssueInvoiceCommand.correction`) builds a `RodzajFaktury=KOR` FA(3) through the
same pure builder + the same C5 session-send flow:

| FA(3) field | Source | Notes |
|---|---|---|
| `RodzajFaktury` | constant `KOR` | plain correction; `KOR_ZAL`/`KOR_ROZ` deferred |
| `TypKorekty` | `2` (default) | line-item correction — the return/refund case |
| `PrzyczynaKorekty` | `correction.reason` | free-text, entity-escaped |
| `DaneFaKorygowanej/DataWystFaKorygowanej` | `correction.originalIssueDate` | original issue date |
| `DaneFaKorygowanej/NrFaKorygowanej` | `correction.originalDocumentNumber` | original number |
| `DaneFaKorygowanej/NrKSeF` = `1` + `NrKSeFFaKorygowanej` | `correction.originalClearanceReference` | KSeF branch is a SEQUENCE — `NrKSeF` is a FLAG (`etd:TWybor1` = `1`), the number goes in `NrKSeFFaKorygowanej` (`tns:TNumerKSeF`). Emitted when the original was a KSeF invoice |
| `DaneFaKorygowanej/NrKSeFN` = `1` | — | when `originalClearanceReference` is `null` (non-KSeF original) |
| `Podmiot1K` / `Podmiot2K` | — (omitted) | XSD nests them in the KOR sequence under `Fa` (siblings of `DaneFaKorygowanej`), both `minOccurs=0`, required only on a party change. OL never tracks party changes → omitted |
| `FaWiersz` (before) | command top-level `lines` | each flagged `StanPrzed=1` |
| `FaWiersz` (after) | `correction.correctedLines` | corrected ("after") line state |
| `P_13_x` / `P_14_x` / `P_15` | after-aggregate **minus** before-aggregate | FA(3) `Fa` annotation mandates the tax-base / tax / total-due fields carry the **difference** (after − before), so they may be negative (`TKwotowy` permits a leading `-`) |

The neutral→FA(3) seam is `mapCorrection` in `fa3-builder-input.mapper.ts`; the
`originalClearanceReference` (the opaque authority reference) is the only linkage
to the original — no KSeF string crosses into core.

> **Reconciled against the vendored authoritative FA(3) v1-0E XSD (#1151
> round-1 review):** the KOR element names/placement (`RodzajFaktury`,
> `TypKorekty`, `DaneFaKorygowanej` with the `NrKSeF` flag + `NrKSeFFaKorygowanej`
> pair, `StanPrzed`) and the signed-difference rule for `P_13_x`/`P_14_x`/`P_15`
> are confirmed against the XSD (choice at lines ~2910-2928; `Fa` annotation at
> ~2441). `Podmiot1K`/`Podmiot2K` are omitted (optional, party-change-only).
> Validation remains *structural* (well-formedness + the hand-written rule set);
> MF example-pack compliance + live KSeF clearance stay deferred to C3+.
> `KOR_ZAL`/`KOR_ROZ` (advance/settlement corrections) are a deferred follow-up.

## Payment (`Platnosc` — #1311)

`Platnosc` is a **sibling of `FaWiersz`** under `Fa` (XSD line 3281, `minOccurs="0"`)
— NOT nested inside a line. It carries the connection's default payment method,
bank account, payment term, and early-payment discount, resolved from
`KsefConnectionConfig.payment` (`ksef-connection.types.ts`) — a plain,
manually-entered per-connection config value. Unlike inFakt (#1303/#1308), KSeF
has no live "list bank accounts" API, so there is no `BankAccountsReader`/
`BankAccountDefaultSetter` capability here — the operator types the account in
once and it is emitted as-is.

`Platnosc` is emitted **only** when at least one sub-field is configured;
otherwise it is omitted entirely (existing connections keep byte-identical
output). The **XSD-mandated child order is not payment-method-first**:

| Order | Element | Config source | Notes |
|---|---|---|---|
| 1 | `TerminPlatnosci/TerminOpis` | `payment.paymentTermDays` | `Ilosc` = days; `Jednostka` hardcoded to `'dni'`; `ZdarzeniePoczatkowe` hardcoded to `'data wystawienia faktury'` |
| 2 | `FormaPlatnosci` | `payment.formaPlatnosci` (`TFormaPlatnosci`, `'1'`–`'7'`) | Gotówka/Karta/Bon/Czek/Kredyt/Przelew/Mobilna |
| 3 | `RachunekBankowy` | `payment.bankAccount` | `NrRB` required if the sub-object is present at all; `NazwaBanku`/`SWIFT` optional |
| 4 | `Skonto` | `payment.skonto` | `WarunkiSkonta` + `WysokoscSkonta`, both free text |

Deliberately **out of scope** (schema supports them, no MVP need):
`RachunekWlasnyBanku`/`OpisRachunku` (`TRachunekBankowy` sub-fields),
`RachunekBankowyFaktora` (factoring accounts), and the per-invoice-fact fields
`Zaplacono`/`DataZaplaty`/`ZnacznikZaplatyCzesciowej`/`ZaplataCzesciowa`/
`LinkDoPlatnosci` (these describe a specific invoice's payment state — always
blank for a new invoice — not a connection default). See
[#1311](https://github.com/openlinker-project/openlinker/issues/1311) for the
full field-scope audit and design mockup.

## Verification code (QR / kod weryfikacyjny - #1579)

Since 1 Feb 2026 any structured invoice handed to a buyer **outside** KSeF
(PDF / email / on-screen copy) must carry a QR verification code so the
recipient can confirm the document against the authority. This is OpenLinker's
dominant scenario - e-commerce orders issued to consumers, no-NIP buyers,
VAT-exempt or foreign buyers - so it is not optional.

**What OL emits: KOD I (online verification code).** KOD I is purely
deterministic from **public** data and needs no signing key or certificate. It
encodes the URL:

```
https://{host}/invoice/{NIP}/{DD-MM-RRRR}/{Base64URL(SHA256(rawXmlBytes))}
```

- `host` - `ksef.mf.gov.pl` on `prod`; `qr-test.ksef.mf.gov.pl` on every
  non-prod tier (`test` / `demo`). Threaded from the connection's `config.env`.
- `NIP` - seller NIP (digits only).
- `DD-MM-RRRR` - the invoice issue date (FA(3) `P_1`, stored ISO `YYYY-MM-DD`,
  reformatted day-month-year).
- hash - SHA-256 over the **exact raw, unencrypted FA(3) XML bytes as
  submitted** (the persisted `sourceDocument` snapshot - NOT re-serialized /
  pretty-printed), **Base64URL**-encoded (URL-safe alphabet, padding stripped -
  not standard Base64).

**Where:** generated entirely in the frontend from the already-loaded source XML
(`apps/web/src/plugins/ksef/lib/ksef-verification.ts` + `shared/ui/qr-code.tsx`,
rendered by `ksef-fa3-view.tsx`). No backend/adapter change is required because
the byte-exact submitted document is the persisted `sourceDocument`
(`KsefInvoicingAdapter.toSourceDocument` base64-encodes the same `xml` string it
submits), served verbatim via `GET /invoices/:id/document?kind=source`. Encoding
that text back to UTF-8 bytes round-trips the submitted bytes exactly, so the
hash matches what KSeF computed. The KSeF number is shown as the QR caption.

**KOD II (offline certificate-signed code) is explicitly OUT OF SCOPE.** KOD II
is only required for documents issued in KSeF *offline* mode and is signed with
the seller's KSeF certificate private key. OpenLinker always issues online
(submit -> clear -> UPO), so KOD II never applies.

## Known limitations / deferred work

- ⏸ Reconcile the neutral tax-rate code set (UNCL 5305 vs OpenLinker-custom) —
  the `FA3_TAX_RATE_MAP` keys in `fa3-tax-rate.mapper.ts` are provisional and
  MUST be settled before C3 submission (see the OPEN note under P_12 mapping).
- ⏸ Authoritative XSD from crd.gov.pl + MF example-pack compliance (C3+).
- ⏸ KSeF submission + clearance status (C3+).
- ⏸ `KOR_ZAL` / `KOR_ROZ` advance/settlement-correction document types (#1151 follow-up).
- ⏸ `TypKorekty` selection — currently hard-coded to `2` (line-item correction, the
  return/refund case) in `mapCorrection`. The 1/2/3 period-shift variants
  (`1` = effects in the period of the original, `3` = on terms set by separate
  regulations) are not yet caller-selectable; the neutral `CorrectionReference`
  carries no `typKorekty` field. Deferred until a caller needs a non-default variant.
- ✅ Per-line GTU / Procedura codes (#1586 Phase 2): the neutral `InvoiceLine`
  now carries optional opaque `gtuCode` / `procedureCode`, threaded through
  `Fa3Line` and emitted as `FaWiersz/GTU` (`TGTU` enum) + `FaWiersz/Procedura`
  (`TOznaczenieProcedury`), positioned after `P_12` and before `KursWaluty`
  per the XSD, omitted when absent. ⏸ Deferred: a category→GTU
  operator-configurable mapping UI (codes must be supplied on the command today).
- ⏸ `Podmiot2` `JST` / `GV` flags are hard-coded to `2` ("no") in `buyerNode`.
  Both elements are required by the XSD, and `2` is correct for the common
  buyer — but a buyer that actually *is* a local-government (JST) subsidiary
  unit or a VAT-group member would get a false declaration on a fiscal
  document. The neutral `InvoiceParty` carries no field to express either
  status; supporting such buyers needs a neutral-contract extension plus a
  data source for the flag (PR #1317 review).
- ⚠ AES-256-CBC session-IV reuse (PR #1317): `encryptDocument` reuses the
  single session-declared IV for every document sent within one KSeF session.
  Protocol-mandated - the wire carries exactly one IV, declared at session
  open in `encryption.initializationVector`, and `SendInvoiceRequest` has no
  per-document IV field (spec citations in `ksef-session-crypto.service.ts`).
  Residual security trade-off: ciphertext is deterministic within a session -
  two identical FA(3) documents produce identical ciphertext, and a shared
  plaintext prefix is observable at CBC block granularity. Exposure is
  bounded (ciphertext travels only over TLS to MF; the FA(3) header prefix is
  public structure) and cannot be fixed client-side without breaking
  server-side decryption (the observed status-430 rejection of per-document IVs).
- ⏸ Cross-border tax-band SELECTION (#1586): an interim guard
  (`fa3-cross-border-guard.ts`) now REFUSES a sale whose buyer country differs
  from the seller's own country (throwing `KsefCrossBorderUnsupportedException`
  before build/send) unless the connection sets `allowCrossBorder`. The full
  per-order band-selection function (choose WDT / export / `np I`/`np II` / OSS
  from the buyer country + EU membership) is the deferred follow-up that
  promotes this guard into real banding.
- ⏸ Money rounding rule + decimal-place contract (to finalise with the builder).
- ⏸ Emitting OL variant attributes as explicit distinguishing parameters.
