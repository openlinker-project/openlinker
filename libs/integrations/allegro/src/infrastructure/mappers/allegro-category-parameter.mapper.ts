/**
 * Allegro Category Parameter Mapper
 *
 * Maps Allegro's raw `/sale/categories/{id}/parameters` response shape to the
 * marketplace-neutral `CategoryParameter` contract from `@openlinker/core/listings`.
 *
 * Surfaces both Allegro dependency mechanisms separately, per #410:
 *   - parameter-level visibility — `options.dependsOnParameterId` plus the
 *     union of parent value IDs collected from the parameter's dictionary
 *     entries' `dependsOnValueIds` arrays.
 *   - dictionary-entry filtering — `dictionary[i].dependsOnValueIds` is
 *     preserved verbatim on each neutral entry so the FE renderer can filter
 *     options based on the current parent value.
 *
 * `requiredIf`, `displayedIf`, and `formerData` are dropped at this boundary —
 * they are Allegro-specific predicates that #410 intentionally does not
 * surface to CORE.
 *
 * @module libs/integrations/allegro/src/infrastructure/mappers
 */
import type {
  CategoryParameter,
  CategoryParameterDictionaryEntry,
} from '@openlinker/core/listings';
import type { AllegroCategoryParameter } from '../../domain/types/allegro-api.types';

export function toNeutralCategoryParameter(
  raw: AllegroCategoryParameter,
): CategoryParameter {
  const dependsOnParameterId = raw.options?.dependsOnParameterId;
  const visibilityValueIds = dependsOnParameterId
    ? unionEntryParentValues(raw.dictionary ?? [])
    : [];

  return {
    id: raw.id,
    name: raw.name,
    type: raw.type,
    required: raw.required,
    // #1035 — neutral multi-value roll-up. Allegro has no single `multiValue`
    // flag; multi-value is expressed either as a dictionary multi-select
    // (`multipleChoices`) or a capped value count (`allowedNumberOfValues > 1`).
    multiValue:
      raw.restrictions?.multipleChoices === true ||
      (raw.restrictions?.allowedNumberOfValues ?? 1) > 1,
    unit: raw.unit,
    dictionary: raw.dictionary?.map(toNeutralEntry),
    restrictions: {
      multipleChoices: raw.restrictions?.multipleChoices,
      range: raw.restrictions?.range,
      min: raw.restrictions?.min,
      max: raw.restrictions?.max,
      minLength: raw.restrictions?.minLength,
      maxLength: raw.restrictions?.maxLength,
      precision: raw.restrictions?.precision,
      allowedNumberOfValues: raw.restrictions?.allowedNumberOfValues,
      customValuesEnabled: raw.options?.customValuesEnabled,
    },
    dependsOn:
      dependsOnParameterId && visibilityValueIds.length > 0
        ? { parameterId: dependsOnParameterId, valueIds: visibilityValueIds }
        : undefined,
    // #415 — Allegro's `options.describesProduct: true` flags parameters
    // that must travel under `body.product.parameters[]` on POST
    // /sale/product-offers, not under `body.parameters[]`. Treat anything
    // missing or `false` as offer-section.
    section: raw.options?.describesProduct === true ? 'product' : 'offer',
  };
}

function toNeutralEntry(
  raw: NonNullable<AllegroCategoryParameter['dictionary']>[number],
): CategoryParameterDictionaryEntry {
  return {
    id: raw.id,
    value: raw.value,
    dependsOnValueIds:
      raw.dependsOnValueIds && raw.dependsOnValueIds.length > 0
        ? raw.dependsOnValueIds
        : undefined,
  };
}

function unionEntryParentValues(
  dict: ReadonlyArray<{ dependsOnValueIds?: string[] }>,
): string[] {
  const set = new Set<string>();
  for (const entry of dict) {
    for (const id of entry.dependsOnValueIds ?? []) set.add(id);
  }
  return [...set];
}
