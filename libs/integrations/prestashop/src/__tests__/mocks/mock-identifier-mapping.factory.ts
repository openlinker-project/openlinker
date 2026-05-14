/**
 * Mock Identifier Mapping Factory
 *
 * Creates mocked IdentifierMappingPort for testing adapters.
 *
 * @module libs/integrations/prestashop/src/__tests__/mocks
 */
import type { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';

export function createMockIdentifierMapping(
  overrides: Partial<IdentifierMappingPort> = {}
): jest.Mocked<IdentifierMappingPort> {
  return {
    getExternalIds: jest.fn().mockResolvedValue([]),
    getOrCreateInternalId: jest.fn().mockResolvedValue('internal-id'),
    getInternalId: jest.fn().mockResolvedValue(null),
    createMapping: jest.fn().mockResolvedValue(undefined),
    batchGetOrCreateInternalIds: jest.fn().mockResolvedValue(new Map()),
    deleteMapping: jest.fn().mockResolvedValue(undefined),
    listExternalIdsByConnection: jest.fn().mockResolvedValue([]),
    ...overrides,
  } as jest.Mocked<IdentifierMappingPort>;
}
