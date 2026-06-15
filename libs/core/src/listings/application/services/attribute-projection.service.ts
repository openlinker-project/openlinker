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
 * @module libs/core/src/listings/application/services
 * @implements {IAttributeProjectionService}
 */

import { Injectable, Inject } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import type { OfferManagerPort, CategoryParameter } from '@openlinker/core/listings';
import { isCategoryParametersReader } from '@openlinker/core/listings';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import {
  IMappingConfigService,
  MAPPING_CONFIG_SERVICE_TOKEN,
  type AttributeMapping,
} from '@openlinker/core/mappings';
import type { IAttributeProjectionService } from '../interfaces/attribute-projection.service.interface';
import type {
  AttributeProjectionInput,
  AttributeProjectionResult,
  ResolvedParameter,
} from '../types/attribute-projection.types';

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
    const { sourceConnectionId, destinationConnectionId, destinationCategoryId, attributes } = input;

    const all = await this.mappingConfig.getAttributeMappings(destinationConnectionId);
    const applicable = this.selectApplicableMappings(
      all,
      sourceConnectionId,
      destinationCategoryId
    );

    const adapter = await this.integrationsService.getCapabilityAdapter<OfferManagerPort>(
      destinationConnectionId,
      'OfferManager'
    );

    const parameters: ResolvedParameter[] = [];
    const unresolvedRequired: AttributeProjectionResult['unresolvedRequired'] = [];
    const usedSourceKeys = new Set<string>();

    if (isCategoryParametersReader(adapter)) {
      const params = await adapter.fetchCategoryParameters({ categoryId: destinationCategoryId });
      for (const param of params) {
        const mapping = this.findMappingForParameter(applicable, param.name);
        const sourceValue = mapping ? attributes[mapping.sourceAttributeKey] : undefined;
        if (!mapping || sourceValue === undefined || sourceValue === '') {
          if (param.required) {
            unresolvedRequired.push({ id: param.id, name: param.name, section: param.section });
          }
          continue;
        }
        usedSourceKeys.add(mapping.sourceAttributeKey);
        const resolved = this.toResolvedParameter(param, this.mapValue(mapping, sourceValue));
        if (resolved) {
          parameters.push(resolved);
        } else if (param.required) {
          unresolvedRequired.push({ id: param.id, name: param.name, section: param.section });
        }
      }
    } else {
      // borrows / open — name-keyed pass-through.
      for (const mapping of applicable.values()) {
        const sourceValue = attributes[mapping.sourceAttributeKey];
        if (sourceValue === undefined || sourceValue === '') continue;
        usedSourceKeys.add(mapping.sourceAttributeKey);
        parameters.push({
          id: mapping.destinationParameterName,
          values: [this.mapValue(mapping, sourceValue)],
          section: 'offer',
        });
      }
    }

    const unmappedSourceKeys = Object.keys(attributes).filter((key) => {
      const present = attributes[key] !== undefined && attributes[key] !== '';
      if (!present || usedSourceKeys.has(key)) return false;
      this.logger.debug(
        `Unmapped source attribute "${key}" (destination=${destinationConnectionId}, category=${destinationCategoryId})`
      );
      return true;
    });

    return { parameters, unmappedSourceKeys, unresolvedRequired };
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

  private normalize(value: string): string {
    return value.trim().toLowerCase();
  }
}
