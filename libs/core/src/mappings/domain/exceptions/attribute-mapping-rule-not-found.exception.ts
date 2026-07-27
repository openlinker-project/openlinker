/**
 * Attribute Mapping Rule Not Found Exception
 *
 * Thrown when an upsert targets a rule id that does not exist under the given
 * destination connection (#1841).
 *
 * @module libs/core/src/mappings/domain/exceptions
 */

export class AttributeMappingRuleNotFoundException extends Error {
  constructor(id: string) {
    super(`Attribute mapping rule not found: ${id}`);
    this.name = 'AttributeMappingRuleNotFoundException';
    Error.captureStackTrace(this, this.constructor);
  }
}
