/**
 * MappingsController role-metadata tests (#1653)
 *
 * Asserts the @Roles posture of every route handler after #1652 (reads opened
 * to viewer) and #1653 (writes opened to operator):
 *   - read (GET) handlers grant admin/operator/viewer
 *   - write (PUT/DELETE) handlers grant admin/operator
 *
 * Reads decorator metadata off the prototype via Reflect.getMetadata — no DI or
 * database required, mirroring write-guard-coverage.spec.ts. The class-level
 * @Roles('admin') deny-by-default default is intentionally not asserted here;
 * every handler carries its own override.
 *
 * @module apps/api/src/mappings/http/__tests__
 */
import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';

import { ROLES_KEY } from '../../../auth/decorators/roles.decorator';
import { MappingsController } from '../mappings.controller';

const METHOD_METADATA = 'method';

const WRITE_METHODS = new Set<RequestMethod>([
  RequestMethod.POST,
  RequestMethod.PUT,
  RequestMethod.PATCH,
  RequestMethod.DELETE,
]);

type HandlerRoles = { method: RequestMethod; roles: string[] };

function collectHandlers(): Record<string, HandlerRoles> {
  const proto = MappingsController.prototype as unknown as Record<string, unknown>;
  const handlers: Record<string, HandlerRoles> = {};

  for (const methodName of Object.getOwnPropertyNames(proto)) {
    if (methodName === 'constructor') continue;
    if (typeof proto[methodName] !== 'function') continue;

    const fn = proto[methodName] as object;
    const httpMethod = Reflect.getMetadata(METHOD_METADATA, fn) as RequestMethod | undefined;
    if (httpMethod === undefined) continue;

    const roles = (Reflect.getMetadata(ROLES_KEY, fn) as string[] | undefined) ?? [];
    handlers[methodName] = { method: httpMethod, roles };
  }

  return handlers;
}

describe('MappingsController role metadata (#1652 / #1653)', () => {
  const handlers = collectHandlers();

  it('exposes both read and write handlers', () => {
    const methods = Object.values(handlers).map((h) => h.method);
    expect(methods).toContain(RequestMethod.GET);
    expect(methods.some((m) => WRITE_METHODS.has(m))).toBe(true);
  });

  it('read (GET) handlers grant admin/operator/viewer', () => {
    const offenders = Object.entries(handlers)
      .filter(([, h]) => h.method === RequestMethod.GET)
      .filter(([, h]) => {
        const set = new Set(h.roles);
        return !(set.has('admin') && set.has('operator') && set.has('viewer'));
      })
      .map(([name, h]) => `${name}: [${h.roles.join(', ')}]`);

    expect(offenders).toEqual([]);
  });

  it('write (PUT/DELETE) handlers grant admin and operator', () => {
    const offenders = Object.entries(handlers)
      .filter(([, h]) => WRITE_METHODS.has(h.method))
      .filter(([, h]) => {
        const set = new Set(h.roles);
        return !(set.has('admin') && set.has('operator'));
      })
      .map(([name, h]) => `${name}: [${h.roles.join(', ')}]`);

    expect(offenders).toEqual([]);
  });

  it('does not grant viewer write access', () => {
    const viewerWrites = Object.entries(handlers)
      .filter(([, h]) => WRITE_METHODS.has(h.method))
      .filter(([, h]) => h.roles.includes('viewer'))
      .map(([name]) => name);

    expect(viewerWrites).toEqual([]);
  });
});
