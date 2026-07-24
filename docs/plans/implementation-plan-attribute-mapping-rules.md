# Implementation Plan — Operator Attribute Mapping Rules (#1841, S13 of #1838)

## Goal
Add an operator-authored, deterministic, rule-based attribute mapping layer consumed by
`AttributeProjectionService`. Three rule kinds, scoped and sequenced, serving BOTH marketplace
parameters (owns/borrows paths) and WooCommerce/shop attributes (product-publish path) because the
integration point is the shared projection layer, not any adapter.

- **fixed** - set a destination attribute/parameter to a constant.
- **copy-remap** - copy a source attribute with per-value remap (e.g. `36S -> 36`).
- **place-value** - fill from product metadata: name / variant / manufacturer / ean / sku / weight.

Scoping (AND-combined, all optional): source connection, destination category, manufacturer match
(equality), phrase match (substring of product name). Ordering by `priority` asc; later rule wins for
the same destination parameter name; rules win over the legacy `AttributeMapping` layer for the same
target name. Operator-picked offer params still win over everything downstream (offer-builder merge).

## Layer classification
CORE (mappings context: model + storage; listings context: projection integration) + Interface
(REST CRUD) + Frontend (rule editor). Deterministic, no AI.

## Backend - mappings context (`libs/core/src/mappings`)
- `domain/types/attribute-mapping-rule.types.ts` - `AttributeMappingRuleKindValues`/`Kind`,
  `PlaceValueSourceValues`/`PlaceValueSource`, `AttributeMappingRuleConfig` (discriminated union on
  `kind`), `AttributeMappingRuleInput`.
- `domain/entities/attribute-mapping-rule.entity.ts` - `AttributeMappingRule` (anemic + pure `kind`
  getter derived from `config.kind`).
- `domain/ports/attribute-mapping-rule-repository.port.ts` - `AttributeMappingRuleRepositoryPort`.
- `infrastructure/persistence/entities/attribute-mapping-rule.orm-entity.ts` - table
  `attribute_mapping_rules`; scope columns real (indexable), kind-specific data in a `config` jsonb.
- `infrastructure/persistence/repositories/attribute-mapping-rule.repository.ts`.
- `mappings.tokens.ts` - `ATTRIBUTE_MAPPING_RULE_REPOSITORY_TOKEN`.
- extend `IMappingConfigService` + `MappingConfigService`: `getAttributeMappingRules`,
  `upsertAttributeMappingRule`, `deleteAttributeMappingRule`.
- `mappings.module.ts` wiring; `index.ts` barrel exports.

## Backend - listings context (`libs/core/src/listings`)
- extend `AttributeProjectionInput` with optional `metadata` (product-derived place-value sources).
- `AttributeProjectionService`: load rules, filter by scope, sort by priority, resolve each kind,
  merge into both the owns (category-schema) and borrows/open (name-keyed) branches; copy-remap
  source keys count as "used" so they are not reported unmapped.
- `build-projection-metadata.ts` pure helper (product + variant -> metadata), used by offer-builder
  and product-publish-builder call sites.

## Interface (`apps/api/src/mappings`)
- `attribute-mapping-rules.controller.ts` under `connections/:connectionId/attribute-rules`:
  GET (list), PUT (create/update by id), DELETE. DTOs with class-validator.

## Frontend (`apps/web/src/features/mappings`)
- `use-attribute-rules` hook (list/upsert/delete), `AttributeRulesPanel` component (kind selector,
  scope fields, priority/sequence, value config), wired into the connection mappings page.

## Migration
`pnpm --filter @openlinker/api migration:generate` -> `AddAttributeMappingRules`; run + show clean.

## Tests
Projection unit tests: each kind, scope filtering (category/manufacturer/phrase), priority ordering,
rule-over-mapping precedence, place-value sources, both owns + borrows branches. Repo + service via
existing patterns. FE panel smoke test.

## Non-goals
Borrowed-taxonomy provenance reuse for rules (rules are destination-connection scoped only), AI
inference, regex/templated place-value transforms.
