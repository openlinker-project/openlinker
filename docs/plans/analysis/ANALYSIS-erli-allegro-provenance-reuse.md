# Pre-implement gate — ERLI provenance reuse (#1045)

**Plan:** `docs/plans/implementation-plan-erli-allegro-provenance-reuse.md`
**Gated:** 2026-06-26 · read-only, no code/plan edits

## Verdict: ✅ READY

No Critical contract breaks. Two Warnings (one required migration, one additive
entity-constructor change) — both already accounted for in the plan. Reuse audit
found zero collisions: every new symbol is genuinely absent, and the existing
surfaces the plan extends are real and shaped as assumed.

## Reuse findings

| Plan artifact | Verdict | Evidence |
|---|---|---|
| `TaxonomyOwner` / `TaxonomyOwnerValues` union | **NEW** | Absent across `libs/core`. `CategoryProvenanceValues` (`category-resolution.types.ts:34`) is `owns\|borrows\|open` — a distinct concept, confirms the review's "don't conflate" point. |
| `TaxonomyBorrower` capability + `isTaxonomyBorrower` | **NEW** | None of the 18 capability files in `listings/domain/ports/capabilities/` cover borrowed taxonomy. Pattern to mirror: `offer-creator.capability.ts`. |
| `CategoryMappingRepositoryPort.findBySourceCategoryByProvenance` | **NEW (extend)** | Port has 4 methods (`category-mapping-repository.port.ts`); none provenance-scoped. Port is module-internal (not barrel-exported) → method addition needs no barrel edit. |
| `AttributeMappingRepositoryPort.findByProvenance` | **NEW (extend)** | Port has 3 methods; no provenance lookup. Internal port. |
| `IMappingConfigService.resolveDestinationCategory(opts?)` | **PARTIAL (extend, BC)** | Current 2-arg signature at `mapping-config.service.interface.ts`. **Exactly 1 caller** (`category-resolution.service.ts:203`), positional — optional `opts` arg is backward-compatible. |
| `category_mappings.destination_taxonomy_provenance` | **ALREADY EXISTS** | Column present (`category-mapping.orm-entity.ts`), added by migration `1804000000000`. **No category migration needed** — plan correctly only migrates `attribute_mappings`. |
| `TaxonomyBorrower` on `ErliOfferManagerAdapter` | **NEW (extend)** | Implements clause at `erli-offer-manager.adapter.ts:168`; capabilities are named barrel imports from `@openlinker/core/listings` → adding one is clean. |

## Backward-compat findings

**Critical:** none.

**Warnings:**
1. **Migration required — `attribute_mappings`.** `destination_taxonomy_provenance` is NOT on `AttributeMappingOrmEntity` (only `category_mappings` has it). Plan Step 6 covers it. Newest timestamp across core + plugin dirs is **`1815000000000`** (`add-invoice-buyer-tax-id-presence`); allegro plugin tail is `1767900000000`. **Use synthetic prefix `1816000000000`** (strictly-greater rule, `docs/migrations.md` §Timestamp invariant rule 3). Table lives in core (`apps/api/src/migrations/1805000000000-add-attribute-mappings.ts`), so the new migration is core, not plugin — no `plugin-migration-dirs.json` edit.
2. **`AttributeMapping` domain entity + ORM entity gain a field.** Additive constructor param + `@Column`. Update `toDomain`/`toOrm` in the attribute-mapping repository and any fixtures. The entity is barrel-exported (`@openlinker/core/mappings`), but adding a trailing constructor param is source-compatible for existing positional callers only if appended last — append it last.

**`check:invariants` exposure:** low.
- New capability + union added to `listings/index.ts` barrel at the two confirmed insertion points — no deep-import or cross-context violation (Erli already imports listings via the top-level barrel).
- `as const` union (not enum) satisfies the union-type guard.
- Migration timestamp guard satisfied by `1816000000000`.
- `check-service-interfaces`: `MappingConfigService`/`CategoryResolutionService`/`AttributeProjectionService` already implement their `I*Service` — unaffected.

## Open questions

None blocking. Confirmed-resolved during the gate:
- Borrowed-taxonomy value source → capability (`TaxonomyBorrower`), not config (decided, plan §3).
- Category ambiguity → bounded by threading the known `sourceConnectionId`/`masterConnectionId` from `OfferBuilderService` (the single caller path); oldest-wins+warn backstop matches existing `findBySourceCategory` posture.
- ADR addendum is a required deliverable (Step 11), justified by the new plugin-contract capability.
