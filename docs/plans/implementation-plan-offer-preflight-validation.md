# Implementation plan — pre-submit validation in the bulk offer wizard (#2243)

## 1. Goal

Catch Allegro's rejections before we call Allegro. Two lanes, because the browser
cannot see every value that reaches the marketplace:

- **Lane A — Review step.** Values the operator authored (title, price, barcode,
  photos, hand-entered category parameters) are checked client-side and surfaced
  as a row chip that opens the existing edit modal on the offending field.
- **Lane B — core, before the adapter call.** Values assembled server-side by
  attribute mapping rules (#1841) are checked in `AttributeProjectionService`,
  which reports the field by name instead of letting Allegro answer minutes later.

Non-goals (stated in the issue, restated here): mirroring the offer-section
required-parameter gate in the FE, connection-level seller-defaults as row chips,
a `POST .../offer-preflight` endpoint, GS1 registry lookups.

## 2. Layers

| Layer | Change |
|---|---|
| CORE domain | new `parameter-restriction.types.ts` (issue codes + severity + input projection) |
| CORE application | new pure `check-parameter-restrictions.ts`; `AttributeProjectionService` reports issues instead of silently dropping a dictionary miss |
| Frontend | FE mirror of the checker; GTIN classification; Allegro row validator gains six checks; schema fan-out widened; focus-field plumbing from chip to edit modal |
| DX | `scripts/check-parameter-restriction-mirror.mjs` in `check:invariants` |

## 3. Steps

1. `libs/core/src/listings/domain/types/parameter-restriction.types.ts` — codes
   (`VALUE_TOO_SHORT`, `VALUE_TOO_LONG`, `VALUE_BELOW_MIN`, `VALUE_ABOVE_MAX`,
   `PRECISION_EXCEEDED`, `NOT_NUMERIC`, `VALUE_NOT_IN_DICTIONARY`,
   `TOO_MANY_VALUES`), `severity`, `ParameterRestrictionIssue`, input projection.
   Mirrors `required-to-sell.types.ts` verbatim in shape.
2. `libs/core/src/listings/application/services/check-parameter-restrictions.ts` —
   pure, no I/O, no bound hardcoded: every limit is read off
   `CategoryParameter.restrictions`. Beside `check-required-to-sell.ts`.
3. Barrel export from `@openlinker/core/listings`.
4. `attribute-projection.service.ts` — run the checker over every resolved value;
   return `restrictionIssues` on the result; a dictionary miss becomes a reported
   issue (the value is still dropped, but no longer silently).
5. `apps/web/src/features/listings/lib/parameter-restrictions.ts` — FE mirror,
   same codes and messages, consumed by the row validator.
6. `apps/web/src/features/listings/lib/gtin-classification.ts` — check digit,
   restricted-circulation / coupon prefixes (`02x`, `04x`, `2xx`, `98x`, `99x`),
   and the explicit ISSN/ISBN/ISMN (`977`/`978`/`979`) carve-out.
7. `allegro-title.ts` — add the minimum rule (12 characters, 3 words) on the
   sanitized title.
8. `plugin.types.ts` — widen `OfferRowValidationInput` with OPTIONAL fields only
   (category schema, operator parameters, barcode, card-link state, sibling card
   coverage, description bytes) and add `advisory?: boolean` to
   `OfferBlockerDescriptor` so a warning never gates the CTA.
9. `allegro-offer-validation.ts` — six new blockers: `param-value-invalid`,
   `title-too-short`, `no-photo`, `siblings-without-card`, plus the advisory
   `ean-unverified` and `in-store-barcode`.
10. `use-bulk-required-product-params.ts` — return the full `schemaByCategory`
    (already fetched, previously projected away) plus `failedCategoryIds`, so a
    failed fetch is visible instead of silently clearing the blocker.
11. `bulk-policy.ts` / `bulk-wizard.tsx` — widen the schema fan-out to every
    submit category, thread the new validator inputs, and make readiness ignore
    advisory ids.
12. `bulk-review-step.tsx` / `bulk-edit-modal.tsx` — a chip carries the field it
    is about; the modal focuses it via `data-focus-field`.
13. `scripts/check-parameter-restriction-mirror.mjs` + `package.json`.
14. Tests: core checker (both sides of every bound), FE mirror parity, validator
    rules, hook failure state, script self-check.
15. `docs/architecture-overview.md` — one paragraph under Listings.

## 4. Deferred, with reason

- **Per-row granularity for `enforceIdentifierRules`** (issue Wave 2.5). It is a
  backend behaviour change with its own response-DTO and FE-toast surface, fully
  independent of everything above. Left for a follow-up so this branch stays one
  reviewable change.
- **Card-link exemption inside the projection** (Wave 2.6): core has no card-link
  signal at projection time; the FE half of the exemption ships here.

## 5. Risks

- `OfferRowValidationInput` is a plugin contract: every added field is optional.
- Advisory blockers are a new concept; existing warning-toned blockers keep
  gating so nothing today changes behaviour.
- Widening the schema fan-out adds one cached fetch per previously-unseen
  category; steady state is unchanged (24 h Redis + query cache).
