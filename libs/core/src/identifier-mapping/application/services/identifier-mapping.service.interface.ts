/**
 * Identifier Mapping Service Interface
 *
 * Service interface for identifier mapping operations. Extends the
 * IdentifierMappingPort to provide application-level service contract.
 *
 * @module libs/core/src/identifier-mapping/application/services
 * @extends {IdentifierMappingPort}
 */
import { IdentifierMappingPort } from '@openlinker/core/identifier-mapping/domain/ports/identifier-mapping.port';

export interface IIdentifierMappingService extends IdentifierMappingPort {}

