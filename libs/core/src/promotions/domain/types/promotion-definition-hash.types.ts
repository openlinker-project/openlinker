/**
 * Promotion Definition Hash (#3935)
 *
 * The canonicalisation + SHA-256 behind the save-time duplicate guard. Identity
 * is conditions + benefit + combination + limits; the name, window and list
 * position are not part of it (two identical promotions with non-overlapping
 * windows are the legitimate versioning case). Conditions are sorted (AND-ed, so
 * authoring order carries no meaning); every object's keys are sorted
 * recursively.
 *
 * @module libs/core/src/promotions/domain/types
 */
import { createHash } from 'node:crypto';

import type { PromotionBenefit } from './promotion-benefit.types';
import { readPromotionCombination, type PromotionCombination } from './promotion-combination.types';
import type { PromotionCondition } from './promotion-condition.types';
import type { PromotionLimits } from './promotion-limits.types';

export interface PromotionDefinition {
  readonly conditions: readonly PromotionCondition[];
  readonly benefit: PromotionBenefit;
  readonly combinesWith: PromotionCombination;
  readonly limits: PromotionLimits;
}

function withSortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withSortedKeys);
  if (typeof value !== 'object' || value === null) return value;
  const source = value as Record<string, unknown>;
  const ordered: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) ordered[key] = withSortedKeys(source[key]);
  return ordered;
}

export function canonicalizePromotionDefinition(definition: PromotionDefinition): string {
  const conditions = [...definition.conditions]
    .map(withSortedKeys)
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return JSON.stringify({
    conditions,
    benefit: withSortedKeys(definition.benefit),
    combinesWith: readPromotionCombination(definition.combinesWith),
    limits: withSortedKeys(definition.limits),
  });
}

export function computePromotionDefinitionHash(definition: PromotionDefinition): string {
  return createHash('sha256').update(canonicalizePromotionDefinition(definition)).digest('hex');
}
