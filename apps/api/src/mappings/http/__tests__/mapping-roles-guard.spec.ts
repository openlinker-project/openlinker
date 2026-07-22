/**
 * Mapping controllers role-guard coverage (#1652 / #1653)
 *
 * Verifies the role posture of the mapping controllers:
 * `MappingOptionsController` (class-level read relaxation, every method is a
 * read) and `MappingsController` (per-method overrides — the 5 GET handlers
 * open to admin/operator/viewer via #1652, the 6 PUT/DELETE writes open to
 * admin/operator via #1653; viewer stays denied on writes). Exercises the
 * real `RolesGuard` + `Reflector` against the actual controller prototypes so
 * the test fails if a future edit drifts the role set on any of these
 * handlers.
 *
 * @module apps/api/src/mappings/http/__tests__
 */
import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@openlinker/core/users';

import { RolesGuard } from '../../../auth/guards/roles.guard';
import { MappingOptionsController } from '../mapping-options.controller';
import { MappingsController } from '../mappings.controller';

function createContext(
  Controller: new (...args: never[]) => unknown,
  methodName: string,
  role: UserRole
): ExecutionContext {
  const handler = (Controller.prototype as unknown as Record<string, unknown>)[methodName];
  return {
    getHandler: () => handler,
    getClass: () => Controller,
    switchToHttp: () => ({
      getRequest: () => ({ user: { role } }),
    }),
  } as unknown as ExecutionContext;
}

const MAPPING_OPTIONS_READ_HANDLERS = [
  'getDestinationCarriers',
  'getDestinationOrderStatuses',
  'getDestinationPaymentMethods',
  'getSourceOrderStatuses',
  'getSourceDeliveryMethods',
  'getSourcePaymentMethods',
  'getDestinationCategories',
  'getSourceCategories',
];

const MAPPINGS_READ_HANDLERS = [
  'getStatusMappings',
  'getCarrierMappings',
  'getOrderStateMappings',
  'getPaymentMappings',
  'getCategoryMappings',
];

const MAPPINGS_WRITE_HANDLERS = [
  'upsertStatusMappings',
  'upsertCarrierMappings',
  'upsertOrderStateMappings',
  'upsertPaymentMappings',
  'upsertCategoryMapping',
  'deleteCategoryMapping',
];

describe('Mapping controllers role-guard coverage (#1652)', () => {
  let guard: RolesGuard;

  beforeEach(() => {
    guard = new RolesGuard(new Reflector());
  });

  describe('MappingOptionsController — every route is a read, class-level relaxed', () => {
    it.each(MAPPING_OPTIONS_READ_HANDLERS)('%s allows viewer', (methodName) => {
      const context = createContext(MappingOptionsController, methodName, 'viewer');
      expect(guard.canActivate(context)).toBe(true);
    });

    it.each(MAPPING_OPTIONS_READ_HANDLERS)('%s allows operator', (methodName) => {
      const context = createContext(MappingOptionsController, methodName, 'operator');
      expect(guard.canActivate(context)).toBe(true);
    });

    it.each(MAPPING_OPTIONS_READ_HANDLERS)('%s allows admin', (methodName) => {
      const context = createContext(MappingOptionsController, methodName, 'admin');
      expect(guard.canActivate(context)).toBe(true);
    });
  });

  describe('MappingsController — 5 read handlers relaxed via method-level override', () => {
    it.each(MAPPINGS_READ_HANDLERS)('%s allows viewer', (methodName) => {
      const context = createContext(MappingsController, methodName, 'viewer');
      expect(guard.canActivate(context)).toBe(true);
    });

    it.each(MAPPINGS_READ_HANDLERS)('%s allows operator', (methodName) => {
      const context = createContext(MappingsController, methodName, 'operator');
      expect(guard.canActivate(context)).toBe(true);
    });

    it.each(MAPPINGS_READ_HANDLERS)('%s allows admin', (methodName) => {
      const context = createContext(MappingsController, methodName, 'admin');
      expect(guard.canActivate(context)).toBe(true);
    });
  });

  describe('MappingsController — 6 write handlers open to admin/operator (#1653)', () => {
    it.each(MAPPINGS_WRITE_HANDLERS)('%s rejects viewer', (methodName) => {
      const context = createContext(MappingsController, methodName, 'viewer');
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it.each(MAPPINGS_WRITE_HANDLERS)('%s allows operator', (methodName) => {
      const context = createContext(MappingsController, methodName, 'operator');
      expect(guard.canActivate(context)).toBe(true);
    });

    it.each(MAPPINGS_WRITE_HANDLERS)('%s allows admin', (methodName) => {
      const context = createContext(MappingsController, methodName, 'admin');
      expect(guard.canActivate(context)).toBe(true);
    });
  });
});
