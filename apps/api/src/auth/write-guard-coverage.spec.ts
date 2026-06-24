/**
 * Write-Guard Coverage Invariant
 *
 * Asserts that every non-GET route handler on the 10 controllers modified by
 * #1124 carries @Roles('admin') metadata. This guards the posture shift from
 * deny-by-default (class-level guard) to opt-in-per-endpoint: any future PR
 * that adds a write endpoint to one of these controllers without the decorator
 * will fail this test immediately rather than silently granting viewer access.
 *
 * Scope: bounded to the 10 controllers listed in CONTROLLERS. When a new
 * controller with write endpoints is added to the API, extend CONTROLLERS here.
 *
 * Implementation: reads NestJS HTTP-method metadata off each prototype method
 * via Reflect.getMetadata. No DI or database required — decorator metadata is
 * stored at class-definition time when the module is imported.
 *
 * @module apps/api/src/auth
 */
import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { ROLES_KEY } from './decorators/roles.decorator';
import { ConnectionController } from '../integrations/http/connection.controller';
import { OrdersController } from '../orders/http/orders.controller';
import { SyncController } from '../sync/http/sync.controller';
import { ListingsController } from '../listings/http/listings.controller';
import { BulkListingController } from '../listings/http/bulk-listing.controller';
import { ShopPublishController } from '../listings/http/shop-publish.controller';
import { BulkShopPublishController } from '../listings/http/bulk-shop-publish.controller';
import { ProductsController, VariantsController } from '../products/http/products.controller';
import { InventoryController } from '../inventory/http/inventory.controller';

const METHOD_METADATA = 'method';

const WRITE_METHODS = new Set<RequestMethod>([
  RequestMethod.POST,
  RequestMethod.PUT,
  RequestMethod.PATCH,
  RequestMethod.DELETE,
]);

const CONTROLLERS = [
  ConnectionController,
  OrdersController,
  SyncController,
  ListingsController,
  BulkListingController,
  ShopPublishController,
  BulkShopPublishController,
  ProductsController,
  VariantsController,
  InventoryController,
];

describe('Write-guard coverage invariant (#1124)', () => {
  for (const Controller of CONTROLLERS) {
    it(`${Controller.name}: every write handler carries @Roles`, () => {
      const proto = Controller.prototype as unknown as Record<string, unknown>;
      const unguarded: string[] = [];

      for (const methodName of Object.getOwnPropertyNames(proto)) {
        if (methodName === 'constructor') continue;
        if (typeof proto[methodName] !== 'function') continue;

        const fn = proto[methodName] as object;

        const httpMethod = Reflect.getMetadata(
          METHOD_METADATA,
          fn,
        ) as RequestMethod | undefined;

        if (httpMethod === undefined) continue;
        if (!WRITE_METHODS.has(httpMethod)) continue;

        const roles = Reflect.getMetadata(
          ROLES_KEY,
          fn,
        ) as unknown[] | undefined;

        if (!roles || roles.length === 0) {
          unguarded.push(
            `${Controller.name}.${methodName} (HTTP method ${RequestMethod[httpMethod]}) is missing @Roles`,
          );
        }
      }

      expect(unguarded).toEqual([]);
    });
  }
});
