# Implementation Plan — eparagony.pl connection config as form fields (#3266)

## 1. Goal

Give an eparagony.pl connection's config fields real, typed form controls on the
connection edit page, so an operator never has to hand-edit the raw **Config JSON**
textarea to set a fiscal setting.

**Layer**: Frontend (Interface). No CORE change, no Integration change, no migration.

**Non-goals**

- The guided setup wizard keeps its current shape (`environment` + `posId` + credentials).
- `taxRates` (the seven A..G slot overrides) stays raw-JSON-only — see §3.5.
- Erli's identical raw-JSON split is a sibling issue, not this one.
- No backend behaviour change. `EparagonyConnectionConfigShapeValidatorAdapter` already
  validates every field this exposes (verified — see §2).

## 2. Research findings

**The seam already exists and eparagony simply never declared it.** `EditConnectionForm`
composes a per-platform `ConnectionConfigContribution` (#1330,
`apps/web/src/shared/plugins/plugin.types.ts`) with four members —
`schemaShape` / `superRefine?` / `readConfigToForm` / `applyToConfig` — plus a
`StructuredConfigSection` render half and a `PluginEditConnectionFields`
declaration-merge block for type-safe `form.register()`.

Two shipped implementations: `plugins/ksef/` and `plugins/subiekt/`. **KSeF is the
template** — fiscal, Polish vendor vocabulary, nested config objects, a `superRefine`
pair, and a string-form-field → number-config conversion (`paymentTermDays`).

Mechanics that constrain the design:

- `syncStructuredToJson(field, value: string)` — **every form value is a string**. Type
  conversion (boolean, number) belongs in `applyToConfig`.
- `applyToConfig` receives **single-field patches** per keystroke. It must not drop
  sibling leaves, and must preserve unknown keys the operator added by hand.
- Every input must be disabled on `!configIsParseable` — the host serializer
  early-returns when the raw JSON is unparseable, so an enabled input would silently
  drop the edit.
- A dev-only `console.warn` in `syncStructuredToJson` fires for a field that is neither
  a host field nor declared in `schemaShape` — a free correctness check while building.

**Backend bounds, read from the validator** (the FE must not be stricter — #2240):

| key | backend rule |
|---|---|
| `defaultTaxRateCode` | optional; one of A..G |
| `print` | optional boolean |
| `paymentForm` | optional; one of the 10 vendor values |
| `paymentName` | optional string, **no length bound** |
| `statusPollTimeoutMs` | optional; positive finite number, **no upper bound** |
| `fiscalDeviceUniqueNumber` | optional non-empty string, **no length bound** |
| `apiBaseUrl` / `authBaseUrl` | optional; parseable URL, `https` only |

**Adapter defaults and clamps**, which the operator copy must state truthfully:

- `statusPollTimeoutMs` default `60_000`, clamped to `[5_000, 90_000]`.
- `paymentForm` default `Przelew`.
- `print` default `false`; the mapper tests `config.print === true`.

**The `defaultTaxRateCode` fallback is reachable on a default deployment.** Verified
chain, because the copy makes a claim about behaviour:

1. `EparagonyDocumentMapper.toProductLine` calls
   `resolveTaxRateCode(line.taxRate, table, config.defaultTaxRateCode)`; the third arm
   resolves a **blank** rate to the configured slot, and returns `null` (blocking the
   registration with an actionable message) when no slot is set.
2. `tax-rate.policy.ts` claims *"Arm 3 is unreachable while the #2252 gate stands"*.
3. That gate is `FiscalRegistrationService.assertEveryLineHasATaxRate`, whose first
   statement is `if (!isTaxRateEnforced(cmd.taxRateEra)) return;`.
4. `isTaxRateEnforced` = `isTaxRateStrictEnabled(env) && !isPreRolloutOrder(era)`, and
   `parseTaxRateStrictEnabled` returns true **only for the literal string `true`** —
   `OL_TAX_RATE_STRICT_ENABLED` is off by default.

So the docblock's claim holds only with strict enforcement switched on. The infotip must
not repeat its unconditional form.

## 3. Design

### 3.1 Form fields

All prefixed `eparagony*` — the KSeF precedent (`ksefEnvironment` exists "to avoid
colliding with DPD's flat `environment` key"), and `paymentName` / `print` are exactly
the kind of generic names that would collide later.

| form field | config key | control | string → config |
|---|---|---|---|
| `eparagonyPrint` | `print` | 3-state `SegmentedControl` | `'true'` → `true`; `'false'` → `false`; `''` → delete |
| `eparagonyPaymentForm` | `paymentForm` | select (10) | value; `''` → delete |
| `eparagonyPaymentName` | `paymentName` | text | trim; `''` → delete |
| `eparagonyDefaultTaxRateCode` | `defaultTaxRateCode` | select A..G | value; `''` → delete |
| `eparagonyStatusPollTimeoutMs` | `statusPollTimeoutMs` | number text | `parseInt`; `''` → delete |
| `eparagonyFiscalDeviceUniqueNumber` | `fiscalDeviceUniqueNumber` | text | trim; `''` → delete |
| `eparagonyApiBaseUrl` | `apiBaseUrl` | text | trim; `''` → delete |
| `eparagonyAuthBaseUrl` | `authBaseUrl` | text | trim; `''` → delete |

**`print` is three-state**, matching #2610's rule that an operator's explicit choice and
an unset knob are different persisted states that must round-trip apart: *Not set*
(absent) / *Print* (`true`) / *Don't print* (`false`). The copy says plainly that *Not
set* and *Don't print* produce the same receipt today — the mapper tests
`config.print === true` — and that choosing *Don't print* records it as a decision.

### 3.2 Layout — four groups, disclosure, not a packed strip

`InlineDisclosure` (`shared/ui/inline-disclosure.tsx`, native `<details>`);
`plugins/infakt/components/infakt-structured-section.tsx` is the usage precedent.

1. **Receipt** (open) — `print`, `paymentForm`, `paymentName`
2. **Tax rate fallback** (collapsed) — `defaultTaxRateCode` + hazard infotip
3. **Diagnostics and timing** (collapsed) — `statusPollTimeoutMs`, `fiscalDeviceUniqueNumber`
4. **Testing overrides** (collapsed) — `apiBaseUrl`, `authBaseUrl`

### 3.3 The `defaultTaxRateCode` hazard infotip

A local `EparagonyHazardInfotip` in the plugin, built on `shared/ui/popover` and reusing
the shipped `.section-infotip` / `.infotip-popover` / `.infotip-def*` classes.
**Click-to-open, not hover** — Radix `Tooltip` returns early on `pointerType === 'touch'`,
so a hover-only explanation never reaches a phone (the reason
`features/analytics/components/analytics-infotip.tsx` gives for the same choice).

It is a **local component, not an import from `features/analytics`**: a plugin reaching
into another feature for a presentational helper is the wrong edge, and promoting the
analytics one to `shared/ui` is a refactor this issue should not carry. Noted as the
obvious follow-up once a third consumer appears.

Copy covers four points (§2 above supplies the verified facts): what the slot is, how it
is supposed to work (fix the rate in the catalogue; empty means a rate-less line is
refused), why setting it is a hazard (a receipt reaches the buyer and the daily report
and cannot be recalled), and that it *can* fire on a default deployment.

### 3.4 Mirror guard

`apps/web` cannot import `@openlinker/integrations-eparagony` (#591), so the payment-form
vocabulary, the rate-code vocabulary and the poll clamp are copied. A drifting copy makes
the select offer a value the backend rejects, or the copy state a clamp the adapter does
not apply — the #2229 failure. `scripts/check-eparagony-config-mirror.mjs` under
`pnpm check:invariants`, following four shipped precedents.

### 3.5 Why `taxRates` is excluded

Operator decision, recorded with its cost: the table is not the product's VAT rate, it is
what each letter means on the seller's physical device, which OpenLinker cannot observe.
A seller whose device is programmed off the standard table still has to use the raw JSON
editor. Accepted to keep the form to the settings an operator actually changes.

## 4. Steps

1. `apps/web/src/plugins/eparagony/eparagony-config.constants.ts` — mirrored vocabularies,
   clamp bounds, human labels for the 10 payment forms and the 7 rate codes.
2. `apps/web/src/plugins/eparagony/eparagony-connection-config.ts` — `declare module`
   block, `schemaShape` (no stricter than the backend), `readConfigToForm`,
   `applyToConfig`.
3. `apps/web/src/plugins/eparagony/components/eparagony-hazard-infotip.tsx`.
4. `apps/web/src/plugins/eparagony/components/eparagony-structured-section.tsx` — four
   groups, every input gated on `configIsParseable`.
5. `apps/web/src/plugins/eparagony/index.ts` — register both; correct the header docblock.
6. `scripts/check-eparagony-config-mirror.mjs` + wire into `check:invariants`.
7. Tests:
   - `eparagony-connection-config.test.ts` — round-trip per field, unknown-key
     preservation, `print` three-state, number conversion, delete-on-empty.
   - `eparagony-structured-section.test.tsx` — renders, disabled on unparseable JSON,
     closed selects, three-state switch, infotip opens on click.

## 5. Validation

- **Architecture**: frontend-only; `app → pages → features → shared` respected; the
  plugin imports `shared/plugins` and `shared/ui` only, and no other feature.
- **Naming**: kebab-case files, `*.test.tsx` colocated.
- **Security**: no secrets; credentials untouched (separate panel; eparagony registers
  none). `apiBaseUrl`/`authBaseUrl` stay `https`-gated by the backend.
- **Risk**: `applyToConfig` dropping sibling leaves under per-keystroke patching.
  Covered by a test asserting an unknown operator-authored key and an untouched sibling
  both survive a single-field patch.
