# FA(3) Schema & Validation Status

> Read this before trusting the FA(3) builder for production use. It records
> what is validated today (C4) and what is deliberately deferred.

## Schema identity

| Field | Value |
|---|---|
| Namespace | `http://crd.gov.pl/wzor/2025/06/25/13775/` |
| Root element | `Faktura` |
| Form code (`KodFormularza`) | `FA` |
| Schema version (`wersjaSchemy`) | `1-0E` |
| Vendored file | [`schemat_fa3_v1-0e.xsd`](./schemat_fa3_v1-0e.xsd) |

## Validation gates

| Gate | Status | Notes |
|---|---|---|
| XML well-formedness | ✓ | via `fast-xml-parser` `XMLValidator` |
| Structural rule set (root + namespace, required sections, line cardinality) | ✓ | JS-based structural check derived from the real XSD; no native XSD engine |
| Authoritative XSD from crd.gov.pl | ✓ | the vendored `.xsd` is now the **authoritative MF FA(3) v1-0E schema** (provenance below) |
| MF example-pack compliance (real Ministry test vectors) | ⏸ deferred (C3+) | belongs to the KSeF submission phase |
| Live KSeF submission / clearance | ⏸ deferred (C3+) | out of scope here |

## Why no full XSD engine (libxmljs)

A native-build XSD validator (`libxmljs` / `libxmljs2`) is intentionally **not** a
dependency: it fails to build on the constrained CI used here. The validator uses
`fast-xml-parser` (already in the workspace, pure JS) for well-formedness plus a
hand-written structural rule set **derived from the vendored XSD** (root +
namespace, `Naglowek` identity attributes, `WariantFormularza`, `Podmiot1`
identification, and the `Fa` body's required children — `KodWaluty`, `P_1`,
`P_2`, `RodzajFaktury`, `Adnotacje`, and ≥1 `FaWiersz`). The vendored XSD is the
provenance/reference artifact; conformance is asserted by the rule set plus the
builder emitting XSD-valid structure.

## Re-fetch checklist (before submission)

1. Confirm the vendored [`schemat_fa3_v1-0e.xsd`](./schemat_fa3_v1-0e.xsd) still
   matches the published `crd.gov.pl` wzór `2025/06/25/13775` (schema `1-0E`).
2. Add MF example-pack fixtures and assert the builder output validates.
3. Run a full XSD-engine validation pass in an environment that can build a
   native validator (CI-external), as a one-off conformance check.

### Vendored XSD provenance

- Source: Ministry of Finance (`crd.gov.pl`), wzór `2025/06/25/13775`, schema
  version `1-0E` (FA(3)).
- SHA-256: `b646b6b525f51adf1bb2545f111fc8ca6e7aa6dd2f98948f1667d3695c06d958`
- The schema `xsd:import`s the MF shared types
  [`StrukturyDanych_v10-0E.xsd`](./StrukturyDanych_v10-0E.xsd) (the `etd:`
  namespace — `TWybor1`, `TWybor1_2`, address/identity complex types, etc.).
  That shared schema is **now vendored next to the FA(3) XSD** and the import's
  `schemaLocation` is rewritten to the local relative path
  (`StrukturyDanych_v10-0E.xsd`), so the import resolves offline — the future
  real-XSD-engine conformance pass (step 3 above) no longer needs network
  access to fetch it.

### Vendored shared-types XSD provenance (`StrukturyDanych_v10-0E.xsd`)

- Source: Ministry of Finance (`crd.gov.pl`), `xml/schematy/dziedzinowe/mf/2022/01/05/eD/DefinicjeTypy/StrukturyDanych_v10-0E.xsd`
  (the `etd:` shared definitions imported by the FA(3) schema).
- SHA-256: `1137ce6e3c11c2b9ef3f05e4e72d6dcd6b4fa94908ea558f2ba15de0259bb2aa`
- The original remote `schemaLocation` in `schemat_fa3_v1-0e.xsd` was rewritten
  from the absolute `crd.gov.pl` URL to this local relative filename so the two
  vendored schemas form a self-contained, offline-resolvable pair.

Tracking issue: #1148 (FA(3) XML builder); submission/authority follow-up: C3+.
