/**
 * Attribute Projection Service
 *
 * Projects a product variant's descriptive `attributes` into a destination's
 * neutral `ResolvedParameter[]` (#1038, ADR-023 §4), provenance-aware:
 *  - **owns** (`isCategoryParametersReader`): fetch the live category schema,
 *    match each parameter to a configured attribute mapping, resolve dictionary
 *    values to their entry ids; required parameters that can't be populated are
 *    surfaced in `unresolvedRequired`.
 *  - **borrows / open** (no parameters reader): name-keyed pass-through — emit
 *    `{ id: destinationParameterName, values, section: 'offer' }` per mapped,
 *    present attribute for the adapter to interpret.
 *
 * Mappings are source-scoped; a per-category mapping overrides the
 * connection-wide default for the same source attribute key.
 *
 * **`restrictionIssues` is REPORTED-ONLY as of #2243, deliberately.** The
 * projection runs the pure `checkParameterRestrictions` over every value it
 * produces and returns what breaks a bound the destination declared, but no
 * caller gates on it yet - neither `OfferBuilderService` nor
 * `ProductPublishBuilderService` reads the field, so its only operator-visible
 * surface today is the `warn` line below. That is a first slice, not an
 * oversight: the values here come from attribute mappings and the #1841 rule
 * layer, so a block would refuse a publish over data the operator cannot see or
 * edit from the wizard, and the checker had to be observable before it could be
 * trusted to gate. Making a builder gate on it is a follow-up; until it does,
 * do not read "returned" as "enforced".
 *
 * @module libs/core/src/listings/application/services
 * @implements {IAttributeProjectionService}
 */

import { Injectable, Inject } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import type {
  OfferManagerPort,
  CategoryParameter,
  ParameterRestrictionIssue,
} from '@openlinker/core/listings';
import { isCategoryParametersReader, checkParameterRestrictions } from '@openlinker/core/listings';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import {
  IMappingConfigService,
  MAPPING_CONFIG_SERVICE_TOKEN,
  type AttributeMapping,
  type AttributeMappingRule,
  type PlaceValueSource,
} from '@openlinker/core/mappings';
import type { IAttributeProjectionService } from '../interfaces/attribute-projection.service.interface';
import type {
  AttributeProjectionInput,
  AttributeProjectionMetadata,
  AttributeProjectionResult,
  ResolvedParameter,
} from '../types/attribute-projection.types';

/** One rule-derived destination value, keyed by normalized parameter name. */
interface RuleContribution {
  name: string;
  value: string;
}

@Injectable()
export class AttributeProjectionService implements IAttributeProjectionService {
  private readonly logger = new Logger(AttributeProjectionService.name);

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(MAPPING_CONFIG_SERVICE_TOKEN)
    private readonly mappingConfig: IMappingConfigService
  ) {}

  async project(input: AttributeProjectionInput): Promise<AttributeProjectionResult> {
    const { sourceConnectionId, destinationConnectionId, destinationCategoryId, attributes } =
      input;

    const own = await this.mappingConfig.getAttributeMappings(destinationConnectionId);
    // Borrowed-taxonomy reuse (#1045): a `borrows` destination (ERLI) has no
    // attribute mappings of its own — fold in the owner's (e.g. Allegro's) rows.
    // Own-destination rows win per source attribute key (deduped by id below).
    const all = input.borrowedTaxonomy
      ? this.dedupeById(own, await this.mappingConfig.getAttributeMappingsByProvenance(input.borrowedTaxonomy))
      : own;
    const applicable = this.selectApplicableMappings(
      all,
      sourceConnectionId,
      destinationCategoryId
    );

    const adapter = await this.integrationsService.getCapabilityAdapter<OfferManagerPort>(
      destinationConnectionId,
      input.destinationCapability ?? 'OfferManager'
    );

    const parameters: ResolvedParameter[] = [];
    const unresolvedRequired: AttributeProjectionResult['unresolvedRequired'] = [];
    const restrictionIssues: ParameterRestrictionIssue[] = [];
    const usedSourceKeys = new Set<string>();

    // Operator-authored rule layer (#1841): a deterministic, sequenced overlay
    // that fills destination parameters by name. Rules win over the legacy
    // attribute-mapping layer for the same destination parameter name.
    const rules = await this.mappingConfig.getAttributeMappingRules(destinationConnectionId);
    const ruleByName = this.resolveRuleContributions(rules, input, usedSourceKeys);

    if (isCategoryParametersReader(adapter)) {
      const params = await adapter.fetchCategoryParameters({ categoryId: destinationCategoryId });
      for (const param of params) {
        const rule = ruleByName.get(this.normalize(param.name));
        const mapping = rule ? undefined : this.findMappingForParameter(applicable, param.name);
        let destinationValue: string | undefined;
        if (rule) {
          destinationValue = rule.value;
        } else if (mapping) {
          const sourceValue = attributes[mapping.sourceAttributeKey];
          if (sourceValue !== undefined && sourceValue !== '') {
            usedSourceKeys.add(mapping.sourceAttributeKey);
            destinationValue = this.mapValue(mapping, sourceValue);
          }
        }
        if (destinationValue === undefined || destinationValue === '') {
          if (param.required) {
            unresolvedRequired.push({ id: param.id, name: param.name, section: param.section });
          }
          continue;
        }
        const resolved = this.toResolvedParameter(param, destinationValue);
        if (resolved) {
          parameters.push(resolved);
          // The value never passes through any UI on this path, so this is the
          // only place a declared bound can be checked before the marketplace
          // answers (#2243). Reported, not corrected: rewriting an operator's
          // mapped value would be a worse failure than naming it.
          restrictionIssues.push(
            ...checkParameterRestrictions(param, {
              values: resolved.valuesIds,
              texts: resolved.values,
            })
          );
        } else {
          // A dictionary miss: `toResolvedParameter` drops the parameter for any
          // dictionary non-match, so an offer publishes silently MISSING the
          // value rather than visibly wrong. Whether that drop is a VIOLATION is
          // the checker's call and not this branch's - a category whose
          // parameter carries `customValuesEnabled` accepts the value, so
          // asserting it is not allowed would be a positive false claim, worse
          // than the debug line it replaces. One rule, one place.
          restrictionIssues.push(
            ...checkParameterRestrictions(param, { texts: [destinationValue] })
          );
          if (param.required) {
            unresolvedRequired.push({ id: param.id, name: param.name, section: param.section });
          }
        }
      }
    } else {
      // borrows / open — name-keyed pass-through. Collect mapping outputs first,
      // then let rules override by destination parameter name.
      const byName = new Map<string, ResolvedParameter>();
      for (const mapping of applicable.values()) {
        const sourceValue = attributes[mapping.sourceAttributeKey];
        if (sourceValue === undefined || sourceValue === '') continue;
        usedSourceKeys.add(mapping.sourceAttributeKey);
        byName.set(this.normalize(mapping.destinationParameterName), {
          id: mapping.destinationParameterName,
          values: [this.mapValue(mapping, sourceValue)],
          section: 'offer',
        });
      }
      for (const [key, contribution] of ruleByName) {
        byName.set(key, { id: contribution.name, values: [contribution.value], section: 'offer' });
      }
      for (const resolved of byName.values()) parameters.push(resolved);
    }

    const unmappedSourceKeys = Object.keys(attributes).filter((key) => {
      const present = attributes[key] !== undefined && attributes[key] !== '';
      if (!present || usedSourceKeys.has(key)) return false;
      this.logger.debug(
        `Unmapped source attribute "${key}" (destination=${destinationConnectionId}, category=${destinationCategoryId})`
      );
      return true;
    });

    if (restrictionIssues.length > 0) {
      this.logger.warn(
        `Projected ${restrictionIssues.length} parameter value(s) that break a declared bound ` +
          `(destination=${destinationConnectionId}, category=${destinationCategoryId}): ` +
          restrictionIssues.map((i) => `${i.parameterName}: ${i.code}`).join('; ')
      );
    }

    return { parameters, unmappedSourceKeys, unresolvedRequired, restrictionIssues };
  }

  /**
   * Merge `primary` (own-destination) ahead of `secondary` (borrowed-by-provenance)
   * rows, deduped by id (#1045). Own rows appear first so `selectApplicableMappings`
   * — which prefers the first seen at equal category-specificity — favours an
   * explicit own-destination row over a borrowed one. An ERLI row carrying the
   * default `'allegro'` provenance appears in both lists; dedup keeps it once.
   */
  private dedupeById(
    primary: AttributeMapping[],
    secondary: AttributeMapping[]
  ): AttributeMapping[] {
    const byId = new Map<string, AttributeMapping>();
    for (const mapping of primary) byId.set(mapping.id, mapping);
    for (const mapping of secondary) if (!byId.has(mapping.id)) byId.set(mapping.id, mapping);
    return Array.from(byId.values());
  }

  /**
   * Source-scope the mappings and collapse to one per source attribute key,
   * with a per-category mapping (`destinationCategoryId === category`) taking
   * precedence over the connection-wide default (`destinationCategoryId === null`).
   */
  private selectApplicableMappings(
    all: AttributeMapping[],
    sourceConnectionId: string,
    destinationCategoryId: string
  ): Map<string, AttributeMapping> {
    const byKey = new Map<string, AttributeMapping>();
    for (const mapping of all) {
      if (mapping.sourceConnectionId !== sourceConnectionId) continue;
      if (
        mapping.destinationCategoryId !== null &&
        mapping.destinationCategoryId !== destinationCategoryId
      ) {
        continue;
      }
      const existing = byKey.get(mapping.sourceAttributeKey);
      if (!existing) {
        byKey.set(mapping.sourceAttributeKey, mapping);
        continue;
      }
      const candidateIsSpecific = mapping.destinationCategoryId !== null;
      const existingIsSpecific = existing.destinationCategoryId !== null;
      if (candidateIsSpecific && !existingIsSpecific) {
        byKey.set(mapping.sourceAttributeKey, mapping);
      }
    }
    return byKey;
  }

  private findMappingForParameter(
    applicable: Map<string, AttributeMapping>,
    parameterName: string
  ): AttributeMapping | undefined {
    const target = this.normalize(parameterName);
    for (const mapping of applicable.values()) {
      if (this.normalize(mapping.destinationParameterName) === target) return mapping;
    }
    return undefined;
  }

  private mapValue(mapping: AttributeMapping, sourceValue: string): string {
    const target = this.normalize(sourceValue);
    const match = mapping.values.find((v) => this.normalize(v.sourceValue) === target);
    return match ? match.destinationValue : sourceValue;
  }

  private toResolvedParameter(
    param: CategoryParameter,
    destinationValue: string
  ): ResolvedParameter | null {
    if (param.type === 'dictionary') {
      const target = this.normalize(destinationValue);
      const entry = (param.dictionary ?? []).find((e) => this.normalize(e.value) === target);
      if (!entry) {
        this.logger.debug(
          `Dictionary value "${destinationValue}" not found for parameter "${param.name}" (id=${param.id})`
        );
        return null;
      }
      return { id: param.id, valuesIds: [entry.id], section: param.section };
    }
    return { id: param.id, values: [destinationValue], section: param.section };
  }

  /**
   * Apply operator-authored rules (#1841): filter by scope, order by `priority`
   * ascending, resolve each to a destination value, and collapse to one
   * contribution per destination parameter name (later rule wins). Copy-remap
   * rules that consume a source attribute add its key to `usedSourceKeys` so it
   * is not later reported unmapped.
   */
  private resolveRuleContributions(
    rules: AttributeMappingRule[],
    input: AttributeProjectionInput,
    usedSourceKeys: Set<string>
  ): Map<string, RuleContribution> {
    const contributions = new Map<string, RuleContribution>();
    const applicable = rules
      .filter((rule) => this.ruleMatches(rule, input))
      .sort((a, b) => a.priority - b.priority);
    for (const rule of applicable) {
      const value = this.computeRuleValue(rule, input, usedSourceKeys);
      if (value === undefined || value === '') continue;
      contributions.set(this.normalize(rule.destinationParameterName), {
        name: rule.destinationParameterName,
        value,
      });
    }
    return contributions;
  }

  private ruleMatches(rule: AttributeMappingRule, input: AttributeProjectionInput): boolean {
    if (rule.sourceConnectionId !== null && rule.sourceConnectionId !== input.sourceConnectionId) {
      return false;
    }
    if (
      rule.destinationCategoryId !== null &&
      rule.destinationCategoryId !== input.destinationCategoryId
    ) {
      return false;
    }
    if (rule.manufacturerMatch !== null) {
      const manufacturer = input.metadata?.manufacturer;
      if (!manufacturer || this.normalize(manufacturer) !== this.normalize(rule.manufacturerMatch)) {
        return false;
      }
    }
    if (rule.phraseMatch !== null) {
      const name = input.metadata?.productName ?? '';
      if (!this.normalize(name).includes(this.normalize(rule.phraseMatch))) {
        return false;
      }
    }
    return true;
  }

  private computeRuleValue(
    rule: AttributeMappingRule,
    input: AttributeProjectionInput,
    usedSourceKeys: Set<string>
  ): string | undefined {
    const config = rule.config;
    switch (config.kind) {
      case 'fixed':
        return config.value;
      case 'copy-remap': {
        const sourceValue = input.attributes[config.sourceAttributeKey];
        if (sourceValue === undefined || sourceValue === '') return undefined;
        usedSourceKeys.add(config.sourceAttributeKey);
        const target = this.normalize(sourceValue);
        const remap = config.valueRemap.find((v) => this.normalize(v.sourceValue) === target);
        return remap ? remap.destinationValue : sourceValue;
      }
      case 'place-value':
        return this.placeValue(config.source, input.metadata);
    }
  }

  private placeValue(
    source: PlaceValueSource,
    metadata: AttributeProjectionMetadata | undefined
  ): string | undefined {
    switch (source) {
      case 'name':
        return metadata?.productName;
      case 'variant':
        return metadata?.variantName;
      case 'manufacturer':
        return metadata?.manufacturer;
      case 'ean':
        return metadata?.ean;
      case 'sku':
        return metadata?.sku;
      case 'weight':
        return metadata?.weight;
    }
  }

  private normalize(value: string): string {
    return value.trim().toLowerCase();
  }
}
