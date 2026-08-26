/**
 * Automation Delegate Resolver (#2361)
 *
 * The ONE place an executor reaches a sibling context's shipped service.
 *
 * ## Why this is not a constructor dependency
 *
 * `OrdersModule` imports `AutomationModule` (for T5's write-site emission), so
 * an `AutomationModule.imports` entry for `OrdersModule` — or for anything that
 * imports it, such as `InvoicingModule` — closes a NestJS DI cycle. ADR-041
 * decision 2 records that there is no `forwardRef` anywhere in `libs/core`,
 * `apps/api` or `apps/worker`, and this slice does not introduce the first one.
 * `ModuleRef`'s lazy, whole-container lookup breaks the cycle: neither module's
 * `imports` array references the other.
 *
 * ## Why the `require` is lazy, and must stay lazy
 *
 * A plain top-level `import { ORDER_LIFECYCLE_RELAY_SERVICE_TOKEN } from
 * '@openlinker/core/orders'` in an executor would still close a REQUIRE cycle
 * one layer down — `orders` requires `@openlinker/core/automation` for its T5
 * emission, and this barrel would require `orders` straight back, landing on a
 * partially-populated `module.exports` where `AutomationModule` is not yet
 * assigned. NestJS's `@Module({ imports: [...] })` decorator captures that
 * `undefined` PERMANENTLY (decorator arguments evaluate once, at class-definition
 * time), crashing boot with "the module at index [n] ... is undefined". This is
 * not hypothetical: `InvoiceService.resolveFiscalRegistrationService` documents
 * hitting exactly that live during epic #2154.
 *
 * A dynamic `require()`, not `import()`, because `ModuleRef.get` needs the token
 * SYNCHRONOUSLY and by exact Symbol identity — a second `Symbol('...')` with the
 * same description would not `===` the one the owning module registers against.
 *
 * ## Why ONE resolver rather than one per executor
 *
 * Four copies would be four places to drop the `try`/`catch`, or for a later
 * tidy-up to "simplify" the lazy `require` into a top-level import. Both
 * failures are silent at review time and fatal at boot, process-wide.
 *
 * @module libs/core/src/automation/application/services
 * @implements {IAutomationDelegateResolverService}
 */
import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Logger } from '@openlinker/shared/logging';

import type {
  AutomationDelegateRef,
  IAutomationDelegateResolverService,
} from '../interfaces/automation-delegate-resolver.service.interface';

@Injectable()
export class AutomationDelegateResolverService implements IAutomationDelegateResolverService {
  private readonly logger = new Logger(AutomationDelegateResolverService.name);

  constructor(private readonly moduleRef: ModuleRef) {}

  /**
   * Resolve a sibling service, or `null` when it is not bound in this process.
   *
   * `null` is a normal, expected answer rather than an error: `MAILER_TOKEN` is
   * bound only in `apps/api` today, and automation fires from the worker. The
   * CALLER turns that into an operator-facing `failed` step naming the missing
   * binding — this resolver never decides what an absence means.
   */
  resolve<T>(ref: AutomationDelegateRef): T | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires -- lazy require breaks a CommonJS barrel-load cycle with the sibling context (see the class doc comment)
      const barrel = require(ref.barrel) as Record<string, symbol | undefined>;
      const token = barrel[ref.tokenName];
      if (typeof token !== 'symbol') {
        this.logger.warn(
          `Automation delegate ${ref.tokenName} is not an exported Symbol on ${ref.barrel}; ` +
            `treating the delegate as unavailable.`,
        );
        return null;
      }
      return this.moduleRef.get<T>(token, { strict: false });
    } catch (error) {
      // Expected whenever the owning module is not wired into this process.
      // Logged rather than swallowed: this resolver cannot distinguish
      // "not wired" from "broken" by type, and an executor that silently
      // reports every action unavailable would look like a configuration
      // choice rather than the defect it might be.
      this.logger.warn(
        `Could not resolve automation delegate ${ref.tokenName} from ${ref.barrel} ` +
          `(treating it as not wired into this process): ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }
}
